import { VFS } from './vfs'
import { ExecutionLimitError, ControlSignal, LoopSignal, BreakSignal, ReturnSignal, errnoText } from './errors'
import { parse, type Command, type CommandNode, type IfNode, type WhileNode, type ForNode, type CaseNode, type FunctionDefNode, type ListNode, type PipelineNode } from './parser'
import { expandWord, expandToSingle, expandForCase, type ExpandCtx } from './expand'
import { matchSegment } from './glob'
import { lookupCommand, isKnownUnimplemented } from './registry'
import type { CommandEnv, ExecResult, ShellState } from './types'
import type { Word } from './lexer'

/**
 * 리다이렉션 대상 단어를 확장 전 원문 그대로 이어붙인다 (따옴표 문자 자체는 복원하지
 * 않는다). expandToSingle 이 "0개 또는 2개 이상으로 펼쳐졌다"며 실패했을 때, bash는
 * 펼쳐진 결과가 아니라 사용자가 쓴 단어 그대로를 메시지에 보여준다 — docker로 확인:
 * `echo hi > *.txt`(a.txt,b.txt 매치) → "*.txt"(펼쳐진 "a.txt b.txt"가 아님),
 * `X="a b"; echo hi > $X` → "$X"(펼쳐진 "a b"가 아님).
 */
function wordSourceText(word: Word): string {
  return word.map((part) => part.text).join('')
}

/** 한 번의 exec 동안만 사는 실행 컨텍스트. */
interface RunCtx {
  fs: VFS
  state: ShellState
  budget: { remaining: number }
  /**
   * $1..$9 / $@ / $* / $# 의 재료 (인덱스 0 = $1). state(cwd/env)와 달리 ShellState에
   * 두지 않고 RunCtx에 둔다 — 함수 호출(Task 7)마다 통째로 교체되는 실행-국소적
   * 값이라 cwd/env처럼 "셸에 영구히 남는 상태"와 성격이 다르다.
   */
  positional: string[]
  /**
   * 현재 몇 겹의 루프(while/until/for) 안에서 실행 중인지. runWhile/runFor 가 본문 실행
   * 동안 ++/-- 한다. break/continue 빌트인은 이 값(>0 이면 루프 안)으로 신호를 던질지
   * 말지를 정한다 — 루프 밖에서는 던지지 않고 경고만 낸다(bash 동작). 서브셸 경계
   * (childCtx)에서는 0으로 리셋된다 — break/continue 는 서브셸/명령치환 밖으로 새지 않는다.
   */
  loopDepth: number
  /**
   * 정의된 셸 함수(이름 → body ListNode). bash 에서 함수는 대체로 전역이라(정의 시점 이후
   * 어디서나 보임, 함수 안에서 정의해도 바깥으로 남음 — docker 확인) 이 맵은 childCtx 를
   * 거쳐도 **같은 참조를 공유**한다. 단순화: bash 는 `$( )` 서브셸 안에서 정의된 함수를
   * 바깥으로 흘리지 않지만(subshell-local), 우리는 맵을 공유해 그 비-누수를 재현하지
   * 않는다 — 필수 케이스에 영향이 없고 훨씬 단순하다(설계 메모 참고).
   */
  functions: Map<string, ListNode>
  /**
   * 현재 몇 겹의 함수 호출 안에서 실행 중인지. callFunction 이 body 실행 동안 ++/-- 한다.
   * return 빌트인은 이 값(>0 이면 함수 안)으로 ReturnSignal 을 던질지 말지를 정한다 —
   * loopDepth/break 와 완전히 같은 원리다. childCtx(서브셸/명령치환)에서는 0으로 리셋된다:
   * bash 는 `$( )` 안의 return 을 "치환 셸을 벗어날 뿐, 바깥 함수는 안 벗어남" 으로 본다.
   */
  funcDepth: number
}

function spend(ctx: RunCtx): void {
  if (--ctx.budget.remaining < 0) throw new ExecutionLimitError()
}

/**
 * ctx 의 상태(cwd/env)만 독립된 복사본으로 뜬 자식 컨텍스트를 만든다. fs 와 budget 은
 * 그대로 공유한다 — 파일시스템 변경은 실제 부작용이라 서브프로세스도 공유해야 하고,
 * 스텝 예산은 무한루프 방어이므로 서브셸이라고 새로 채워지면 안 된다.
 * 명령치환(runSubshell)과, 2개 이상 단계인 파이프라인의 각 단계가 이 함수를 쓴다 —
 * 두 경우 모두 "이 실행이 바깥 셸의 cwd/env 를 못 바꾼다"는 같은 규칙이다.
 *
 * positional 도 (env 처럼) 얕은 복사 배열을 새로 뜬다 — 지금은 아무도 이 배열을
 * 바꾸지 않지만, Task 7(함수 호출)이 자식 컨텍스트 안에서 positional 을 통째로
 * 교체(swap)하게 될 때 부모 배열이 오염되면 안 된다. 참조를 공유하면 자식이
 * push/splice 로 부모 배열을 직접 건드릴 여지가 생기므로, 여기서 항상 새 배열을 만든다.
 */
function childCtx(ctx: RunCtx): RunCtx {
  return {
    fs: ctx.fs,
    state: { ...ctx.state, env: { ...ctx.state.env } },
    budget: ctx.budget,
    positional: [...ctx.positional],
    // 서브셸/명령치환/파이프 단계는 새 루프 문맥이다 — 그 안의 break/continue 는 바깥
    // 루프를 벗어나면 안 되므로(bash 확인: `while ...; do echo $(break); done` 는 무한),
    // 루프 깊이를 0으로 리셋한다. 그러면 그 break 는 "루프 밖"으로 취급돼 경고 후 무시된다.
    loopDepth: 0,
    // 함수 맵은 같은 참조를 공유한다(bash 함수는 대체로 전역, 위 주석 참고).
    functions: ctx.functions,
    // 함수 깊이도 0으로 리셋한다 — `$( )` 안의 return 은 치환 셸만 벗어나고 바깥 함수는
    // 안 벗어난다(bash 동작). 그래서 서브셸 안 return 은 "함수 밖"으로 취급돼 no-op 된다.
    funcDepth: 0,
  }
}

function expandCtxFor(ctx: RunCtx): ExpandCtx {
  return {
    env: ctx.state.env,
    cwd: ctx.state.cwd,
    home: ctx.state.home,
    fs: ctx.fs,
    lastExitCode: ctx.state.lastExitCode,
    positional: ctx.positional,
    // 서브셸은 같은 VFS와 예산을 공유하되, cwd/env 변경은 밖으로 새지 않는다.
    runSubshell: async (script) => {
      const child = childCtx(ctx)
      // 서브셸 안의 문법 오류가 exec 전체를 리젝트시켜서는 안 된다.
      // 다만 실행 한도 초과는 바깥까지 전파되어야 한다.
      try {
        return await runList(parse(script), child)
      } catch (e) {
        if (e instanceof ExecutionLimitError) throw e
        // break/continue/return 은 명령치환(서브셸) 밖으로 새지 않는다. child 의
        // loopDepth/funcDepth 가 0으로 리셋돼 대개 여기까지 오지도 않지만(신호를 아예
        // 안 던짐), 도달하면 no-op 으로 흘려보낸다(실어온 부분 출력은 그대로 낸다).
        if (e instanceof ControlSignal) return { stdout: e.stdout, stderr: e.stderr, exitCode: 0 }
        return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
      }
    },
  }
}

interface ResolvedRedir { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; path: string; word: string }

/**
 * 파이프라인 한 단계를 실행하는 진입점. node.kind 로 단순/복합 명령을 가른다.
 * 'command' 는 예전 그대로(runSimpleCommand). if/while 은 stdin 을 쓰지 않는다 —
 * 본문/조건은 runList 로 돌고, 그 결과 ExecResult 를 파이프라인이 이어받는다.
 */
async function runCommand(node: Command, ctx: RunCtx, stdin: string): Promise<ExecResult> {
  switch (node.kind) {
    case 'command': return runSimpleCommand(node, ctx, stdin)
    case 'if': return runIf(node, ctx)
    case 'while': return runWhile(node, ctx)
    case 'for': return runFor(node, ctx)
    case 'case': return runCase(node, ctx)
    // 함수 정의: body 를 돌리지 않고 이름→body 를 등록만 한다(exit 0).
    case 'funcdef': return runFuncDef(node, ctx)
    // 브레이스 그룹: 서브셸이 아니라 현재 ctx 에서 LIST 를 실행한다(env 공유).
    case 'group': return runList(node.body, ctx)
  }
}

/** `NAME() { ... }` — 정의를 functions 맵에 등록한다. 이미 있으면 덮어쓴다. exit 0. */
function runFuncDef(node: FunctionDefNode, ctx: RunCtx): ExecResult {
  ctx.functions.set(node.name, node.body)
  return { stdout: '', stderr: '', exitCode: 0 }
}

/**
 * 셸 함수를 호출한다. 서브셸이 아니라 **현재 ctx** 에서 body 를 돌린다 — env 를 공유하므로
 * 함수 안의 `x=5` 가 호출자에게 그대로 남는다(우리는 아직 `local` 이 없다, M3). positional
 * ($1..)만 인자로 바꿔치기하고 finally 에서 되돌린다. $0 은 건드리지 않는다(bash 는 함수
 * 안에서도 $0 을 스크립트/셸 이름 그대로 둔다). funcDepth 를 ++ 해 body 안의 return 이
 * ReturnSignal 을 던질 수 있게 하고, ReturnSignal 을 여기서 잡아 그 code 를 함수의 exit
 * code 로, 실어온 부분 출력을 함수의 출력으로 쓴다(`echo x; return 3` → x 출력 + exit 3).
 *
 * ExecutionLimitError 는 잡지 않고 그대로 위로 던진다 — 그래서 무한 재귀(`f(){ f; }; f`)는
 * 매 호출마다 runSimpleCommand 의 spend(ctx) 로 예산을 깎다가 결국 예산 초과로 exit 130 이
 * 되지, JS 스택 오버플로로 크래시하지 않는다(await 경계마다 콜스택이 풀리므로).
 *
 * loopDepth 를 0 으로 리셋한다 — 함수 호출은 **루프-문맥 경계**다(childCtx 가 서브셸에서
 * 하는 것과 같은 이유). bash 에서 함수 안의 break/continue 는 호출자의 루프에 닿을 수
 * 없다(docker 확인): 호출자의 for 안에서 부른 함수의 bare `break` 는 loopDepth===0 을 봐
 * 경고+no-op 하고, 함수 자신의 루프 안 `break`/`break N` 은 0 부터 세므로 그 루프에만
 * 갇힌다. finally 에서 원래 값으로 복원한다.
 */
async function callFunction(body: ListNode, argv: string[], ctx: RunCtx): Promise<ExecResult> {
  const savedPositional = ctx.positional
  const savedLoop = ctx.loopDepth
  ctx.positional = argv.slice(1)
  ctx.loopDepth = 0
  ctx.funcDepth++
  try {
    return await runList(body, ctx)
  } catch (e) {
    if (e instanceof ReturnSignal) {
      return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code }
    }
    throw e // ExecutionLimitError / LoopSignal 등은 함수 경계를 그대로 통과한다.
  } finally {
    ctx.positional = savedPositional
    ctx.loopDepth = savedLoop
    ctx.funcDepth--
  }
}

async function runSimpleCommand(node: CommandNode, ctx: RunCtx, stdin: string): Promise<ExecResult> {
  spend(ctx)
  const expandCtx = expandCtxFor(ctx)

  // 1. 단어와 대입값을 확장한다. 확장 자체가 던질 수 있는 예외(글롭이 VFS를 건드리다
  //    실패하는 경우 등)는 여기서 잡아 얌전한 ExecResult로 바꾼다 — exec()는 절대
  //    reject 하면 안 된다. ExecutionLimitError만은 그대로 위로 던져서 exec 전체를
  //    끝내야 한다 (무한루프 방어이므로).
  let argv: string[]
  try {
    argv = []
    for (const word of node.words) argv.push(...(await expandWord(word, expandCtx)))

    // 2. 명령 없는 순수 대입: 셸 상태를 영구히 바꾼다.
    if (argv.length === 0) {
      for (const assignment of node.assignments) {
        ctx.state.env[assignment.name] = (await expandWord(assignment.value, expandCtx)).join(' ')
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    return { stdout: '', stderr: `bash: ${errnoText(e)}\n`, exitCode: 1 }
  }

  // 2.5 함수 호출 분기. lookupCommand(빌트인/coreutil)보다 **먼저** 본다 — bash 는 함수가
  //     동명의 빌트인/coreutil 을 가린다(docker 확인: `ls() { echo faked; }; ls` → faked).
  //     함수는 현재 ctx 에서(env 공유) 돌리고 positional 만 인자로 바꾼다. 리다이렉션/명령앞
  //     대입은 함수 호출에는 적용하지 않는다(드묾, 이 태스크 범위 밖 — 설계 메모 참고).
  {
    const fnBody = ctx.functions.get(argv[0]!)
    if (fnBody) return callFunction(fnBody, argv, ctx)
  }

  // 3. 명령 앞의 대입은 이 명령의 환경에만 적용되고 사라진다.
  const commandEnv = { ...ctx.state.env }
  try {
    for (const assignment of node.assignments) {
      commandEnv[assignment.name] = (await expandWord(assignment.value, expandCtx)).join(' ')
    }
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    return { stdout: '', stderr: `bash: ${errnoText(e)}\n`, exitCode: 1 }
  }

  // 4~6. 리다이렉션을 텍스트에 나온 순서 그대로 왼쪽에서 오른쪽으로 "연다". 실제 bash가
  //    그렇게 하기 때문이다 — 대상 확장(ambiguous 여부)과 open()류 부작용(> 는 즉시 비우고,
  //    >> 는 없으면 만들고, < 는 열 수 있는지만 확인한다)이 리다이렉션마다 함께 일어난다.
  //    뒤의 리다이렉션이 실패해도 앞의 리다이렉션이 이미 만든 부작용(예: 파일 비움)은
  //    되돌리지 않는다 — docker로 확인: `> out < gone` 은 out 을 비운 뒤에 실패하고,
  //    `< gone > out` 은 out 을 건드리기도 전에 실패한다. 같은 fd 로 두 번 리다이렉션되면
  //    (`> a > b`) 전부 비워지지만 실제 내용은 마지막 것만 받는다 — 그래서 여기서는
  //    "비우기/만들기"만 하고, 실제 출력 내용 쓰기는 명령 실행 후 9번 단계에서 fd 별 마지막
  //    리다이렉션에만 한다.
  //
  //    < 는 특히 "열기"와 "읽기"를 분리해야 한다: 커널이 그렇게 하듯, 여기서는 열 수
  //    있는지(존재하고 읽을 수 있는지)만 확인하고 아직 내용을 읽지 않는다. 실제 내용은
  //    루프가 전부 끝난 뒤(= 이 명령에 걸린 모든 리다이렉션의 open() 부작용이 다 반영된
  //    뒤)에 읽는다. 그래야 `cat < f > f` 처럼 뒤에 나온 `>` 가 같은 파일을 비운 게
  //    stdin에도 반영된다 — docker로 확인: `printf alpha > a; cat < a > a; echo [$(cat a)]`
  //    → `[]` (a가 비어 있다). 왼→오로 즉시 읽어버리면 이 케이스에서 alpha가 그대로
  //    살아남는 버그가 난다.
  const redirs: ResolvedRedir[] = []
  let input = stdin
  let inputFromFile = false
  let stdinRedir: ResolvedRedir | null = null // 마지막 < 리다이렉션. 내용은 루프 종료 후 읽는다.

  for (const redir of node.redirs) {
    let word: string
    try {
      word = await expandToSingle(redir.target, expandCtx)
    } catch (e) {
      if (e instanceof ExecutionLimitError) throw e
      // ambiguous redirect는 "펼쳐진 결과"가 아니라 사용자가 쓴 단어 원문을 보여준다.
      return { stdout: '', stderr: `bash: ${wordSourceText(redir.target)}: ambiguous redirect\n`, exitCode: 1 }
    }
    const path = ctx.fs.resolve(word, ctx.state.cwd)
    const resolved: ResolvedRedir = { fd: redir.fd, op: redir.op, path, word }

    try {
      if (redir.op === '<') {
        // 열 수 있는지만 확인한다 (없으면 ENOENT, 디렉터리면 EISDIR 등으로 여기서 던짐).
        // 내용은 버리고, 진짜 읽기는 루프가 끝난 뒤에 한다.
        ctx.fs.readFile(path)
      } else if (redir.op === '>') {
        ctx.fs.writeFile(path, '')
      } else {
        // '>>' — 이어쓰기는 기존 내용을 비우지 않지만, 없던 파일은 즉시 만든다
        // (open(..., O_APPEND|O_CREAT) 이 하는 일과 같다).
        if (!ctx.fs.exists(path)) ctx.fs.writeFile(path, '')
      }
    } catch (e) {
      // 해석된 절대경로가 아니라 사용자가 쓴(확장까지는 된) 단어로 에러를 낸다 —
      // docker로 확인: `cat < nope.txt` → "bash: nope.txt: ...", "/home/player/nope.txt"가 아님.
      return { stdout: '', stderr: `bash: ${word}: ${errnoText(e)}\n`, exitCode: 1 }
    }

    redirs.push(resolved)
    if (redir.op === '<') { inputFromFile = true; stdinRedir = resolved }
  }

  // 모든 리다이렉션의 open() 부작용이 끝난 뒤에야 실제 stdin 내용을 읽는다 (위 주석 참고).
  if (stdinRedir) {
    try {
      input = ctx.fs.readFile(stdinRedir.path)
    } catch (e) {
      // 루프 중 열기 확인을 통과했으므로 사실상 도달하지 않지만, 방어적으로 같은 형식을 지킨다.
      return { stdout: '', stderr: `bash: ${stdinRedir.word}: ${errnoText(e)}\n`, exitCode: 1 }
    }
  }

  // 7. 명령을 찾는다.
  const name = argv[0]!
  const fn = lookupCommand(name)
  if (!fn) {
    const message = isKnownUnimplemented(name)
      ? `flashshell: ${name}: 이 환경에는 없는 명령입니다\n`
      : `bash: ${name}: command not found\n`
    return { stdout: '', stderr: message, exitCode: 127 }
  }

  // 8. 실행한다. 빌트인은 state 를 직접 고친다.
  const cmdEnv: CommandEnv = {
    name,
    args: argv.slice(1),
    stdin: input,
    stdinFromFile: inputFromFile,
    fs: ctx.fs,
    state: { ...ctx.state, env: commandEnv } as ShellState,
    // find -exec / xargs 가 다른 명령줄을 실행할 때 쓴다. 같은 ctx(fs/state/budget 공유) 위에서
    // 파싱·실행하되, 서브셸(runSubshell)과 달리 cwd/env 를 격리하지 않는다 — find -exec 는
    // 부모 셸 상태에서 돈다. 각 호출도 runCommand→spend(ctx) 를 타므로 무한루프 방어에 포함된다.
    runLine: async (line: string): Promise<ExecResult> => {
      try { return await runList(parse(line), ctx) }
      catch (e) {
        if (e instanceof ExecutionLimitError) throw e
        // break/continue/return 은 이 하위 실행 경계 밖으로 새지 않는다 (no-op 취급).
        if (e instanceof ControlSignal) return { stdout: e.stdout, stderr: e.stderr, exitCode: 0 }
        return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
      }
    },
    loopDepth: ctx.loopDepth,
    funcDepth: ctx.funcDepth,
  }
  let result: ExecResult
  try {
    result = await fn(cmdEnv)
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    // break/continue/return 신호는 얌전한 ExecResult 로 바꾸지 않고 그대로 위로 던져서
    // 가장 가까운 경계(runWhile/runFor/callFunction)가 잡게 한다 (ExecutionLimitError 와
    // 같은 특별 취급).
    if (e instanceof ControlSignal) throw e
    return { stdout: '', stderr: `${name}: ${errnoText(e)}\n`, exitCode: 1 }
  }

  // 빌트인이 바꾼 cwd/oldPwd 를 진짜 상태로 되돌려 받는다.
  ctx.state.cwd = cmdEnv.state.cwd
  ctx.state.oldPwd = cmdEnv.state.oldPwd
  // 명령 앞 대입으로 오염된 키는 셸 상태에 절대 손대지 않는다 — 복사도, 삭제도 하지
  // 않는다. 그래야 그 키가 명령 도중 어떻게 되었든(그대로, 값이 바뀜, 심지어 unset
  // 으로 지워짐) 명령이 끝나면 원래 있던 값(혹은 원래 없었음)으로 조용히 남는다.
  // docker로 확인: FOO=x; FOO=y unset FOO; echo $FOO → x (프리픽스 대입은 명령의
  // 섀도우 환경일 뿐이고, 명령이 끝나면 그 섀도우를 통째로 버린다).
  const isTemporary = (key: string) => node.assignments.some((a) => a.name === key)
  for (const [key, value] of Object.entries(cmdEnv.state.env)) {
    if (!isTemporary(key)) ctx.state.env[key] = value
  }
  for (const key of Object.keys(ctx.state.env)) {
    if (isTemporary(key)) continue
    if (!(key in cmdEnv.state.env)) delete ctx.state.env[key]
  }

  // 9. 출력 리다이렉션을 적용한다. 같은 fd 로 두 번 이상 리다이렉션됐다면 실제 내용은
  //    그 fd 의 마지막 리다이렉션만 받는다 — 앞선 것들은 4~6단계에서 이미 비워졌을
  //    뿐, 진짜 내용은 못 받는다 (docker로 확인: `echo hi > a > b` → a=[](비워짐),
  //    b=[hi]).
  let stdout = result.stdout
  let stderr = result.stderr
  const lastIndexForFd = new Map<1 | 2, number>()
  redirs.forEach((r, i) => { if (r.fd !== 0) lastIndexForFd.set(r.fd, i) })

  for (let i = 0; i < redirs.length; i++) {
    const redir = redirs[i]!
    if (redir.fd === 0) continue
    if (lastIndexForFd.get(redir.fd) !== i) continue
    const text = redir.fd === 1 ? stdout : stderr
    try {
      if (redir.op === '>') ctx.fs.writeFile(redir.path, text)
      else ctx.fs.appendFile(redir.path, text)
    } catch (e) {
      // 여기도 해석된 절대경로가 아니라 사용자가 쓴 단어로 에러를 낸다 (finding 2와 동일 원칙).
      return { stdout: '', stderr: `bash: ${redir.word}: ${errnoText(e)}\n`, exitCode: 1 }
    }
    if (redir.fd === 1) stdout = ''
    else stderr = ''
  }

  return { stdout, stderr, exitCode: result.exitCode }
}

/**
 * if/elif/else. 조건(ListNode)을 runList 로 돌려 exitCode===0 이면 그 가지의 then 을
 * 실행하고 반환한다. 참인 가지가 없고 else 도 없으면 exit 0 (bash 확인). 평가한 조건의
 * 출력(stdout/stderr)은 모두 이어붙여 낸다 — bash 는 `if echo cond; then ...` 에서 cond
 * 를 그대로 출력한다. then 안의 $? 는 조건의 exit code 를 본다 — runList(cond) 가
 * lastExitCode 를 갱신한 뒤에 then 이 돌기 때문에 자연히 맞다.
 */
async function runIf(node: IfNode, ctx: RunCtx): Promise<ExecResult> {
  let stdout = ''
  let stderr = ''
  const branches = [{ cond: node.cond, then: node.then }, ...node.elifs]

  for (const branch of branches) {
    const c = await runList(branch.cond, ctx)
    stdout += c.stdout
    stderr += c.stderr
    if (c.exitCode === 0) {
      const b = await runList(branch.then, ctx)
      return { stdout: stdout + b.stdout, stderr: stderr + b.stderr, exitCode: b.exitCode }
    }
  }

  if (node.else) {
    const e = await runList(node.else, ctx)
    return { stdout: stdout + e.stdout, stderr: stderr + e.stderr, exitCode: e.exitCode }
  }
  // 참인 가지도 else 도 없음 → exit 0. 바깥 runList 가 lastExitCode 를 이 0 으로 갱신한다.
  return { stdout, stderr, exitCode: 0 }
}

/**
 * while/until. 각 반복 상단에서 spend(ctx) 로 예산을 1 소모한다 — no-op 본문(`while
 * true; do :; done`)도 무한루프 방어에 걸리게 하기 위함이다. 조건을 돌려(until 이면
 * 반전) 참인 동안 본문을 실행한다. 본문에서 올라온 break/continue 신호를 여기서 잡는다.
 * 반복 0회면 exit 0, 그 외엔 마지막으로 정상 완료된 본문의 exitCode (bash 확인).
 */
async function runWhile(node: WhileNode, ctx: RunCtx): Promise<ExecResult> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  ctx.loopDepth++
  try {
    for (;;) {
      spend(ctx)
      const c = await runList(node.cond, ctx)
      stdout += c.stdout
      stderr += c.stderr
      const proceed = node.until ? c.exitCode !== 0 : c.exitCode === 0
      if (!proceed) break

      try {
        const b = await runList(node.body, ctx)
        stdout += b.stdout
        stderr += b.stderr
        exitCode = b.exitCode
      } catch (e) {
        if (!(e instanceof LoopSignal)) throw e
        // 신호가 실어온 부분 출력(break 직전의 echo 등)을 회수한다.
        stdout += e.stdout
        stderr += e.stderr
        // count>1 이면 바깥 루프로 전달한다. 단 이 루프가 가장 바깥(loopDepth===1)이면
        // 더 벗어날 루프가 없으므로 bash 처럼 여기서 클램프해 소비한다.
        if (e.count > 1 && ctx.loopDepth > 1) {
          e.count -= 1
          e.stdout = stdout
          e.stderr = stderr
          throw e
        }
        if (e instanceof BreakSignal) break
        continue // ContinueSignal → 다음 반복
      }
    }
  } finally {
    ctx.loopDepth--
  }

  return { stdout, stderr, exitCode }
}

/**
 * `for NAME in WORDS; do BODY; done`. words 를 (명령의 인자와 똑같이) expandWord 로
 * 한꺼번에 펼친다 — 단어분리(`for i in $x`)와 글롭(`for f in *.txt`)이 그 안에서 공짜로
 * 딸려 온다, 여기서 따로 구현하지 않는다. 펼쳐진 값을 순서대로 var 에 대입하며 body 를
 * 돈다. 반복 상단에서 spend(ctx) — for 자체는 유한 목록이라 무한루프가 될 수는 없지만,
 * while 과 예산 소모 방식을 일관되게 맞춘다(빈 본문 반복도 예산을 쓴다). break/continue
 * catch 는 runWhile 과 완전히 같은 패턴(부분 출력 회수, count>1 이면 바깥 루프로 전달) —
 * 그래서 for/while 이 섞여 중첩돼도 break N 이 겹수만큼 정확히 올라간다.
 * 목록이 비면(`for x in;`) body 를 한 번도 안 돌고 exit 0, var 도 건드리지 않는다(bash
 * 확인: 빈 for 는 변수를 아예 set 하지 않는다). 반복 후엔 var 가 마지막 값으로 남는다
 * (bash 확인: `for x in a b; do :; done; echo $x` → b) — 여기서 값을 되돌리지 않으므로
 * 자연히 그렇게 된다.
 */
async function runFor(node: ForNode, ctx: RunCtx): Promise<ExecResult> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  const expandCtx = expandCtxFor(ctx)
  let values: string[]
  try {
    values = []
    for (const word of node.words) values.push(...(await expandWord(word, expandCtx)))
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    return { stdout: '', stderr: `bash: ${errnoText(e)}\n`, exitCode: 1 }
  }

  ctx.loopDepth++
  try {
    for (const value of values) {
      spend(ctx)
      ctx.state.env[node.var] = value

      try {
        const b = await runList(node.body, ctx)
        stdout += b.stdout
        stderr += b.stderr
        exitCode = b.exitCode
      } catch (e) {
        if (!(e instanceof LoopSignal)) throw e
        // 신호가 실어온 부분 출력(break/continue 직전의 echo 등)을 회수한다.
        stdout += e.stdout
        stderr += e.stderr
        // count>1 이면 바깥 루프로 전달한다(runWhile 과 동일 규칙 — 가장 바깥이면 클램프).
        if (e.count > 1 && ctx.loopDepth > 1) {
          e.count -= 1
          e.stdout = stdout
          e.stderr = stderr
          throw e
        }
        if (e instanceof BreakSignal) break
        continue // ContinueSignal → 다음 값
      }
    }
  } finally {
    ctx.loopDepth--
  }

  return { stdout, stderr, exitCode }
}

/**
 * `case WORD in PATTERN) BODY;; ... esac`. WORD 와 각 patterns 는 case 전용 확장
 * (expandForCase — 단어분리·글롭 없음, expand.ts 참고)으로 문자열 하나씩으로 편다.
 * branch 를 순서대로 보며, 그 branch 의 patterns 중 하나라도 matchSegment 로 subject 에
 * 맞으면(최초 매치) 그 body 를 runList 로 실행하고 **그 자리에서 멈춘다** — bash 의
 * `;;` 는 fallthrough 가 없다(`;&`/`;;&` 는 구현하지 않는다). 매치되는 branch 가
 * 하나도 없으면 exit 0, 출력 없음(bash 확인).
 *
 * dotglob:true 로 matchSegment 를 호출한다 — case 패턴은 순수 fnmatch 라 경로명 글롭의
 * "선행 점은 `*`/`?` 에 안 걸린다" 보호가 없다(docker 확인: `case .x in *) echo star;;
 * esac` → star). find.ts 가 `-name` 에 이미 쓰는 것과 같은 옵션을 재사용한다.
 *
 * break/continue(LoopSignal)를 여기서 따로 안 잡는다 — runIf 와 같은 설계다: case 안의
 * break 가 runList(branch.body, ctx) 를 뚫고 그대로 위로 새어나가면, 이 case 를 감싼
 * runWhile/runFor 의 catch 가 (몇 겹을 거치든) 자연히 잡는다.
 */
async function runCase(node: CaseNode, ctx: RunCtx): Promise<ExecResult> {
  const expandCtx = expandCtxFor(ctx)
  let subject: string
  try {
    subject = await expandForCase(node.word, expandCtx)
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    return { stdout: '', stderr: `bash: ${errnoText(e)}\n`, exitCode: 1 }
  }

  for (const branch of node.branches) {
    let matched = false
    for (const patternWord of branch.patterns) {
      let pattern: string
      try {
        pattern = await expandForCase(patternWord, expandCtx)
      } catch (e) {
        if (e instanceof ExecutionLimitError) throw e
        return { stdout: '', stderr: `bash: ${errnoText(e)}\n`, exitCode: 1 }
      }
      if (matchSegment(pattern, subject, { dotglob: true })) { matched = true; break }
    }
    if (matched) return runList(branch.body, ctx)
  }

  return { stdout: '', stderr: '', exitCode: 0 }
}

async function runPipeline(node: PipelineNode, ctx: RunCtx): Promise<ExecResult> {
  // 실제 bash는 파이프라인의 모든 단계(마지막 단계 포함)를 서브셸에서 돌린다 — docker로
  // 확인: `cd /tmp; echo hi | cd /; pwd` → /tmp (안 바뀜), `X=orig; echo hi | X=1; echo
  // $X` → orig (안 바뀜). 그래서 단계가 2개 이상이면 각 단계를 독립된 자식 컨텍스트에서
  // 돌려 cwd/env 변경이 바깥으로 새지 않게 한다. 단일 명령(파이프 없음)은 클론하지 않고
  // 진짜 ctx 를 그대로 써서 `cd`/대입이 정상적으로 다음 명령에 이어지게 한다.
  const isolated = node.commands.length > 1
  let stdin = ''
  let stderr = ''
  let last: ExecResult = { stdout: '', stderr: '', exitCode: 0 }

  for (const command of node.commands) {
    const stageCtx = isolated ? childCtx(ctx) : ctx
    last = await runCommand(command, stageCtx, stdin)
    // stderr 는 파이프를 타지 않는다. 모아서 한꺼번에 밖으로 낸다.
    stderr += last.stderr
    stdin = last.stdout
  }

  return { stdout: last.stdout, stderr, exitCode: last.exitCode }
}

async function runList(node: ListNode, ctx: RunCtx): Promise<ExecResult> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const item of node.items) {
    if (item.op === '&&' && exitCode !== 0) continue
    if (item.op === '||' && exitCode === 0) continue

    let result: ExecResult
    try {
      result = await runPipeline(item.pipeline, ctx)
    } catch (e) {
      // break/continue/return 신호가 이 리스트를 뚫고 올라간다. 지금까지 이 리스트가 낸
      // 출력을 신호에 실어 경계(runWhile/runFor/callFunction)가 회수하게 한다 — 안 그러면
      // 우리는 출력을 반환값으로만 넘기므로(스트리밍 아님) 중간에 던진 지점 이전의 출력이
      // 통째로 유실된다.
      if (e instanceof ControlSignal) {
        e.stdout = stdout + e.stdout
        e.stderr = stderr + e.stderr
      }
      throw e
    }
    stdout += result.stdout
    stderr += result.stderr
    exitCode = result.exitCode
    ctx.state.lastExitCode = exitCode
  }

  return { stdout, stderr, exitCode }
}

export async function run(
  line: string,
  fs: VFS,
  state: ShellState,
  stepBudget: number,
  positional: string[] = [],
): Promise<ExecResult> {
  const ctx: RunCtx = {
    fs, state, budget: { remaining: stepBudget }, positional,
    loopDepth: 0, functions: new Map(), funcDepth: 0,
  }
  let ast: ListNode
  try {
    ast = parse(line)
  } catch (e) {
    return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
  }
  if (ast.items.length === 0) return { stdout: '', stderr: '', exitCode: 0 }

  try {
    return await runList(ast, ctx)
  } catch (e) {
    if (e instanceof ExecutionLimitError) {
      return { stdout: '', stderr: '^C  flashshell: 실행 한도 초과 — 무한 루프인가요?\n', exitCode: 130 }
    }
    // 경계 밖으로 새어 나온 break/continue/return (loopDepth/funcDepth 추적 때문에 대개
    // 도달하지 않지만, break N 이 중첩 수를 초과하는 등의 경우 방어). bash 처럼 무해한
    // no-op(exit 0)으로 처리하되, 신호가 실어온 출력은 그대로 낸다.
    if (e instanceof ControlSignal) {
      return { stdout: e.stdout, stderr: e.stderr, exitCode: 0 }
    }
    // 위에서 예상 가능한 실패 지점은 전부 자체적으로 ExecResult 로 바꾸지만, exec()는
    // 어떤 경우에도 reject 하면 안 된다는 계약을 지키기 위한 마지막 방어선이다.
    const message = e instanceof Error ? e.message : String(e)
    return { stdout: '', stderr: `flashshell: 알 수 없는 오류: ${message}\n`, exitCode: 1 }
  }
}
