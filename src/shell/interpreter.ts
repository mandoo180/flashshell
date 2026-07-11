import { VFS } from './vfs'
import { ExecutionLimitError, ControlSignal, LoopSignal, BreakSignal, ReturnSignal, errnoText } from './errors'
import { parse, type Command, type CommandNode, type IfNode, type WhileNode, type ForNode, type CaseNode, type FunctionDefNode, type ArithCmdNode, type SubshellNode, type ListNode, type PipelineNode } from './parser'
import { expandWord, expandToSingle, expandForCase, expandArithExpr, type ExpandCtx } from './expand'
import { matchSegment } from './glob'
import { lookupCommand, isKnownUnimplemented } from './registry'
import { evalArith } from './arith'
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
   * 어디서나 보임 — docker 확인) 이 맵은 childCtx 를 거쳐도 기본적으로 **같은 참조를
   * 공유**한다. 단, 서브셸 경계는 격리된다: `( list )` 와 `$( )` 명령치환은 둘 다 bash 에서
   * 서브셸이라 그 안에서 정의된 함수가 바깥으로 새면 안 되므로(subshell-local, docker 확인),
   * childCtx 를 `copyFunctions` 로 떠 부모 함수는 상속하되 내부 정의는 복사본에만 남긴다.
   * 남은 단순화: 파이프라인 각 단계(bash 에서도 서브셸)는 아직 맵을 공유해 그 단계 안의
   * 함수 정의는 바깥으로 샌다 — 필수 케이스에 영향이 없다.
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
 * 명령치환(runSubshell)과, 2개 이상 단계인 파이프라인의 각 단계, 그리고 shebang 스크립트
 * 실행(execScriptFile, Task 9)이 이 함수를 쓴다 — 세 경우 모두 "이 실행이 바깥 셸의
 * cwd/env 를 못 바꾼다"는 같은 규칙이다.
 *
 * positional 도 (env 처럼) 얕은 복사 배열을 새로 뜬다 — 지금은 아무도 이 배열을
 * 바꾸지 않지만, Task 7(함수 호출)이 자식 컨텍스트 안에서 positional 을 통째로
 * 교체(swap)하게 될 때 부모 배열이 오염되면 안 된다. 참조를 공유하면 자식이
 * push/splice 로 부모 배열을 직접 건드릴 여지가 생기므로, 여기서 항상 새 배열을 만든다.
 *
 * @param opts.isolateFunctions true 면 함수맵도 **새 Map**(빈 상태)으로 뜬다. 기본값
 *   false(공유)는 파이프라인 각 단계용 — 아직 맵을 공유한다(위 `functions` 필드 주석의
 *   남은 단순화 참고). 명령치환 `$( )` 은 copyFunctions 로 격리한다. shebang 스크립트(`./script.sh`)는 진짜 새
 *   프로세스라 다르다 — docker 확인: 호출자에서 정의한 함수는 스크립트 안에서 안 보이고
 *   (`outer(){ echo x; }; ./f1.sh` 안에서 `outer` 호출 → command not found), 스크립트
 *   안에서 정의한 함수도 실행이 끝나면 호출자로 안 샌다(`inscript(){...}` 를 정의·호출만
 *   하는 스크립트를 돌린 뒤 밖에서 `inscript` 호출 → command not found). 그래서
 *   execScriptFile 만 `isolateFunctions: true` 를 넘긴다.
 * @param opts.copyFunctions true 면 함수맵을 부모 맵의 **복사본**(`new Map(ctx.functions)`)
 *   으로 뜬다 — isolateFunctions(새 빈 Map, 양방향 격리)와도 기본값(같은 참조 공유, 양방향
 *   투과)과도 다른 세 번째 모드다. `( list )` 서브셸(task 3)이 필요로 하는 정확히 그
 *   반쪽짜리 격리: 시작 시점에 부모의 함수를 전부 상속해서 보되(스냅샷), 복사본이라
 *   서브셸 안에서의 등록/재정의(`ctx.functions.set`)는 이 복사본에만 반영되고 부모의
 *   원본 Map 은 안 건드린다 — docker 확인(SubshellNode 주석 참고): `f(){ echo hi; };
 *   ( f; g(){ echo g; }; g ); g` → hi, g, 마지막 `g` 는 command not found(안 샘).
 *   isolateFunctions 와 동시에 true 면 isolateFunctions 가 우선한다(새 빈 Map) — 실제로
 *   두 옵션을 함께 넘기는 호출부는 없다.
 */
function childCtx(ctx: RunCtx, opts: { isolateFunctions?: boolean; copyFunctions?: boolean } = {}): RunCtx {
  return {
    fs: ctx.fs,
    state: { ...ctx.state, env: { ...ctx.state.env } },
    budget: ctx.budget,
    positional: [...ctx.positional],
    // 서브셸/명령치환/파이프 단계는 새 루프 문맥이다 — 그 안의 break/continue 는 바깥
    // 루프를 벗어나면 안 되므로(bash 확인: `while ...; do echo $(break); done` 는 무한),
    // 루프 깊이를 0으로 리셋한다. 그러면 그 break 는 "루프 밖"으로 취급돼 경고 후 무시된다.
    loopDepth: 0,
    // 함수 맵은 기본적으로 같은 참조를 공유한다(bash 함수는 대체로 전역, 위 주석 참고).
    // isolateFunctions 가 true 면(shebang 스크립트) 새 빈 Map 을 떠 양방향 격리하고,
    // copyFunctions 가 true 면(서브셸) 복사본을 떠 상속은 하되 정의는 안 새게 한다.
    functions: opts.isolateFunctions ? new Map() : opts.copyFunctions ? new Map(ctx.functions) : ctx.functions,
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
      const child = childCtx(ctx, { copyFunctions: true })
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
    // `(( expr ))` 산술 명령(task 2).
    case 'arith': return runArith(node, ctx)
    // `( list )` 서브셸(task 3): 격리된 childCtx 에서 LIST 를 실행한다.
    case 'subshell': return runSubshellCommand(node, ctx, stdin)
  }
}

/**
 * `(( expr ))` 산술 명령(standalone, task 2). Task 1 의 evalArith 를 그대로 재사용해
 * expr 을 평가한다 — ctx.state.env 를 직접 넘기므로 대입/증감(`(( x++ ))`, `(( x = x*2 ))`)
 * 부작용이 셸 상태에 영구히 남는다(ExpandCtx 의 env 참조 공유와 같은 원리, docker 확인:
 * `x=1; (( x++ )); echo $x` → 2).
 *
 * evalArith 를 부르기 전에 expandArithExpr 로 `${...}`/`$(...)`/`$x` 를 값으로 먼저
 * 확장한다(M3 Part 2 task 1) — `$(( ))` 확장(expand.ts 의 `$((` 분기)과 같은 사전확장을
 * 이 두 번째 진입점(`(( ))` 명령)에도 적용해 `NAME=world; (( ${#NAME} == 5 ))` 같은 식이
 * 동작하게 한다. bare 식별자·대입 대상은 손대지 않고 남겨 evalArith 가 직접 env 를
 * 읽고 쓴다(대입 부작용 유지).
 *
 * exit code 는 bash 산술-명령 규약대로 "결과 ≠ 0 이면 참(exit 0), 0 이면 거짓(exit 1)" —
 * `$(( ))` 확장(값을 문자열로 돌려줌)과 정반대 극성이다. 산술 오류(0 나누기/문법 오류)뿐
 * 아니라 사전 확장 단계의 오류(예: `${x:?msg}`, 깨진 `${`)도 runSimpleCommand 의
 * 확장-오류 처리와 같은 패턴으로 stderr + exit 1 의 얌전한 ExecResult 로 바꾼다(reject
 * 하지 않음, docker 확인: `(( 1/0 ))` → stderr "division by 0", exit 1). ExecutionLimitError
 * 만은 그대로 위로 던진다 — 무한루프 방어를 삼키면 안 되기 때문이다.
 */
async function runArith(node: ArithCmdNode, ctx: RunCtx): Promise<ExecResult> {
  spend(ctx)
  try {
    const expr = await expandArithExpr(node.expr, expandCtxFor(ctx))
    const value = evalArith(expr, ctx.state)
    return { stdout: '', stderr: '', exitCode: value !== 0 ? 0 : 1 }
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    return { stdout: '', stderr: `bash: ${errnoText(e)}\n`, exitCode: 1 }
  }
}

/**
 * `( LIST )` 서브셸 명령(task 3). runSubshell(위 expandCtxFor, `$()` 명령치환용)과 같은
 * 격리 원리(childCtx: fs/budget 공유, env/cwd/loopDepth/funcDepth 격리)를 그대로 쓰되,
 * 결과를 캡처해 문자열로 바꾸지 않고 ExecResult 그대로 반환한다 — 서브셸은 표현식이
 * 아니라 문(statement)이라 그 stdout 이 파이프라인/터미널로 직접 흘러간다.
 *
 * `copyFunctions: true` 를 childCtx 에 넘겨 함수맵을 **복사본**으로 뜬다 — 서브셸은 부모의
 * 함수를 전부 상속해서 보되(시작 시점 스냅샷), 서브셸 안에서 정의/재정의한 함수는 이
 * 복사본에만 등록돼 부모로 안 샌다(SubshellNode/childCtx 주석 참고, docker 확인).
 *
 * stdin: 파이프라인에서 이 서브셸로 들어온 입력을 body 의 **첫 리스트 아이템·첫 파이프라인
 * 첫 단계**로 그대로 흘려보낸다(runList/runPipeline 의 새 initialStdin 파라미터) —
 * `echo hi | (cat)` 이 동작하려면 필요하다. if/while/for 전반의 stdin 스레딩(중간 아이템,
 * 조건절 등)은 이 태스크 범위 밖이다(Task 4 예정) — 여기서는 서브셸 본문의 첫 단계만
 * 최소로 잇는다.
 *
 * spend(ctx) 를 이 함수 자체에서 호출하지 않는다 — GroupNode('group' case)와 같은 원리로
 * 구조적 위임일 뿐이라, 실제 예산 소모는 body 안의 개별 단순 명령/산술 명령/루프 반복이
 * 각자 담당한다(그 스텝들이 이미 shared budget 을 깎으므로 `( while true; do :; done )`
 * 도 별도 처리 없이 공유 예산에 걸려 종료한다).
 */
async function runSubshellCommand(node: SubshellNode, ctx: RunCtx, stdin: string): Promise<ExecResult> {
  const child = childCtx(ctx, { copyFunctions: true })
  return runList(node.body, child, stdin)
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
 *
 * @param stdin 파이프/`< file` 에서 온 입력을 body 의 **첫 파이프라인 첫 단계**로 흘려보낸다
 *   (runList 의 initialStdin — runSubshellCommand 와 같은 최소 스레딩). `echo x | f`(f 가
 *   `cat`/`grep` 으로 stdin 을 읽음)이 동작하려면 필요하다(M3 Part 2 task 4). 본문 두 번째
 *   아이템부터의 stdin 스레딩은 Part 3 범위 밖이다(runList 주석 참고).
 */
async function callFunction(body: ListNode, argv: string[], ctx: RunCtx, stdin = ''): Promise<ExecResult> {
  const savedPositional = ctx.positional
  const savedLoop = ctx.loopDepth
  ctx.positional = argv.slice(1)
  ctx.loopDepth = 0
  ctx.funcDepth++
  try {
    return await runList(body, ctx, stdin)
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

/**
 * `source FILE [ARGS...]` / `. FILE [ARGS...]`. FILE 을 VFS 에서(cwd 기준 resolve) 읽어
 * parse() 로 파싱(멀티라인 — Task 1/5b가 이미 처리)한 뒤 **현재 ctx**(env/functions 공유)
 * 에서 실행한다. callFunction 과 달리 이 자리에 파일 내용을 그대로 붙여넣은 것에 가깝다
 * (진짜 함수 호출이 아니다) — 그래서 세 군데가 callFunction 과 다르다:
 *
 *  - **loopDepth 를 건드리지 않는다.** source 는 루프-문맥 경계가 아니다 — docker로 확인:
 *    `for i in a b c; do echo $i; source breaker.sh; done; echo end`(breaker.sh = `break`)
 *    → `a\nend`(호출자의 for 를 실제로 깬다, `continuer.sh` = `continue` 도 마찬가지로
 *    호출자의 다음 반복으로 넘어간다). loopDepth 를 그대로 두면 이 전파가 아무 특별
 *    처리 없이 자연히 일어난다(BreakSignal/ContinueSignal 을 여기서 안 잡고 그대로
 *    통과시키므로, runSimpleCommand 를 거쳐 결국 호출자의 runWhile/runFor 가 잡는다).
 *  - **positional: ARGS 가 있을 때만 바꿔치기한다.** 없으면 호출자의 positional 을 그대로
 *    둔다(함수 호출은 인자가 없어도 항상 argv.slice(1)([]) 로 바꾼다 — source 는 다르다).
 *    docker 확인: `f() { source echoer.sh; }; f callerarg` → `callerarg`(echoer.sh 의 `$1`
 *    이 호출자 f 의 $1 을 그대로 봄). ARGS 가 있으면(`source echoer.sh svcarg`) 그 동안만
 *    바꾸고 끝나면 복원한다(`svcarg` 후 `after=callerarg`, docker 확인).
 *  - **funcDepth 는 무조건 ++ 한다(호출자가 함수 안이든 최상위든 상관없이 항상 새 경계).**
 *    source 는 return 이 유효한 경계다(return 빌트인의 "함수 또는 소스된 스크립트" 문구가
 *    이를 반영). ReturnSignal 을 여기서 잡아 code→exit code, 실어온 stdout/stderr→source
 *    출력으로 쓴다. docker 로 이 경계가 **함수 경계와 별개**임을 확인했다:
 *    `f() { source deep.sh; echo afterSource=$?; return 1; }; f; echo outerExit=$?`
 *    (deep.sh = `echo insrc\nreturn 9\necho neverseen\n`) → `insrc\nafterSource=9\nouterExit=1`
 *    — deep.sh 안의 `return 9` 는 f 를 벗어나지 않고 source 만 벗어난다(f 는 계속 돌아
 *    자기 `return 1` 로 끝난다). 최상위(함수 밖)에서도 source 자체는 여전히 return
 *    경계다: `source r.sh; echo $?`(r.sh = `echo a\nreturn 3\necho b\n`) → `a\n3`(b 없음).
 *
 * 파일이 없으면 exit 1, stderr `bash: FILE: No such file or directory`(real bash 는
 * `bash: line N: FILE: ...` 이고 "source:"/"​.:" 라벨이 전혀 없다 — 브리프의 추정과
 * 달랐다, docker로 재확인: `source nope.sh` 와 `. nope.sh` 둘 다 라벨 없이 동일한 문구.
 * "line N:" 은 우리 엔진이 스크립트 줄번호를 추적하지 않아 생략한다 — 리다이렉션 open
 * 실패(`bash: ${word}: ${errnoText(e)}`)와 같은 기존 컨벤션과 일치시킨다).
 *
 * source 는 함수 호출과 같은 지점에서 디스패치되지만, 그 지점이 이제 **리다이렉션·명령앞
 * 대입·stdin 해석 뒤**로 옮겨졌다(M3 Part 2 task 4) — 그래서 `source f > log`(출력 리다이렉션),
 * `VAR=x source f`(프리픽스 대입), `data | source f`(파이프 stdin)가 함수 호출과 똑같이 동작한다.
 * 프리픽스 대입은 호출부(runSimpleCommand)가 공유 env 에 save/restore 로 적용하므로(source 는
 * env 를 공유한다) 여기서는 신경 쓰지 않는다.
 *
 * @param stdin 파이프/`< file` 입력을 파일의 **첫 파이프라인 첫 단계**로 흘려보낸다
 *   (callFunction 과 같은 최소 스레딩).
 */
async function runSource(argv: string[], ctx: RunCtx, stdin = ''): Promise<ExecResult> {
  const label = argv[0]! // 'source' 또는 '.'
  const file = argv[1]
  if (file === undefined) {
    return {
      stdout: '',
      stderr: `bash: ${label}: filename argument required\n${label}: usage: ${label} filename [arguments]\n`,
      exitCode: 2,
    }
  }

  const path = ctx.fs.resolve(file, ctx.state.cwd)
  let content: string
  try {
    content = ctx.fs.readFile(path)
  } catch (e) {
    return { stdout: '', stderr: `bash: ${file}: ${errnoText(e)}\n`, exitCode: 1 }
  }

  let ast: ListNode
  try {
    ast = parse(content)
  } catch (e) {
    return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
  }

  const savedPositional = ctx.positional
  const args = argv.slice(2)
  if (args.length > 0) ctx.positional = args
  ctx.funcDepth++
  try {
    return await runList(ast, ctx, stdin)
  } catch (e) {
    if (e instanceof ReturnSignal) {
      return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code }
    }
    throw e // ExecutionLimitError / break/continue(LoopSignal) 등은 그대로 통과시킨다.
  } finally {
    ctx.positional = savedPositional
    ctx.funcDepth--
  }
}

/**
 * 함수/source 호출에 명령앞 프리픽스 대입(`VAR=x f`)을 적용한다. 함수와 source 는 외부 명령과
 * 달리 셸의 env 를 **공유**하므로(외부 명령처럼 섀도우 env 를 주고 copy-back 하는 방식이 아니다),
 * 프리픽스 키를 실제 ctx.state.env 에 잠깐 얹어 body 가 보게 하고, 호출이 끝나면 원래 상태(있었으면
 * 원래 값, 없었으면 unset)로 되돌린다. bash 확인(docker debian:stable-slim): `VAR=hey f` 뒤에는
 * VAR 가 항상 원래대로 복원된다 — 함수가 내부에서 `VAR=changed` 로 재대입해도 마찬가지다
 * (프리픽스 시맨틱: 그 호출 한정 임시 환경). 프리픽스가 아닌 다른 변수를 함수가 설정하면
 * 그건 공유 env 라 그대로 남는다(save/restore 대상이 아니므로). cwd 도 body 가 직접 ctx.state.cwd
 * 를 바꾸면 그대로 남는다(env 만 건드리므로).
 */
async function withPrefixEnv(
  ctx: RunCtx,
  prefix: { name: string; value: string }[],
  run: () => Promise<ExecResult>,
): Promise<ExecResult> {
  if (prefix.length === 0) return run()
  const env = ctx.state.env
  const saved = prefix.map(({ name }) => ({ name, had: name in env, value: env[name] }))
  for (const { name, value } of prefix) env[name] = value
  try {
    return await run()
  } finally {
    for (const { name, had, value } of saved) {
      if (had) env[name] = value!
      else delete env[name]
    }
  }
}

/**
 * `./script.sh [ARGS...]` (경로에 `/`가 있는 임의 이름) 실행 — 셸이 자기 자신을
 * fork/exec 하는 흉내. runSource 와 정반대 결정이다: source 는 호출자의 ctx 를 공유해
 * 대입/함수정의가 새 나가지만, `./script.sh` 는 **진짜 새 프로세스**이므로 env/
 * positional/함수맵이 전부 격리된 childCtx 에서 돈다(fs 와 budget 만 공유 — 파일시스템
 * 변경은 실제 부작용이고, 스텝 예산은 무한루프 방어이므로 서브프로세스라고 새로 채워지면
 * 안 된다. docker 확인: `while true; do :; done` 스크립트를 실행해도 공유 예산이 계속
 * 깎여 결국 `run()`의 최상위 catch 가 exit 130 을 낸다 — 여기서 ExecutionLimitError 를
 * 잡지 않고 그대로 위로 던지기만 하면 된다).
 *
 * `#!` 첫 줄은 렉서(Task 1)가 토큰 시작의 `#` 를 주석으로 벗겨내므로 따로 파싱하지
 * 않는다 — 본문 전체를 그냥 parse()/runList 에 넘기면 `#!/bin/bash` 줄은 자연히
 * 무시된다. 즉 `#!` 에 뭐라고 적혀 있든 항상 우리 셸 서브셋으로 실행한다(이 게임에서는
 * 그게 맞는 동작 — 브리프 참고).
 *
 * dispatch 위치는 runSimpleCommand 의 "7. 명령을 찾는다"(lookupCommand 실패) 지점이다
 * — source/함수 호출(2.5/2.6)보다 **뒤**, 리다이렉션(4~6)/명령앞 대입(3) 해석보다
 * **뒤**라서 `./script.sh > out.txt`, `VAR=x ./script.sh` 가 자연히 지원된다: 이 함수는
 * 일반 CommandFn 처럼 CommandEnv(e)를 받아 ExecResult 를 돌려주므로, 호출부(step 8/9)의
 * 기존 출력 리다이렉션 적용/cwd·env 동기화 로직을 그대로 재사용한다(중복 없음).
 * `VAR=x ./script.sh` 가 스크립트 안에서 VAR 를 보이게 하는 것도 docker 로 확인했다
 * (`VAR=hello ./pv.sh` 안에서 `echo $VAR` → hello, 스크립트 밖에서는 다시 비어 있음) —
 * 그래서 격리된 child 의 env 를 ctx.state.env 가 아니라 e.state.env(명령앞 대입이 이미
 * 반영된 commandEnv)에서 복사해 뜬다.
 *
 * 존재하지 않으면 exit 127 `bash: ${name}: No such file or directory`, 디렉터리면 exit
 * 126 `bash: ${name}: Is a directory`, exec 비트(mode & 0o111)가 없으면 exit 126
 * `bash: ${name}: Permission denied` — 문구/exit code 모두 docker(debian:stable-slim,
 * bash 5)로 확인했다("line N:" 접두는 우리가 스크립트 줄번호를 안 추적해 생략한다 —
 * runSource 의 file-not-found 문구와 같은 기존 컨벤션). 심볼릭 링크는 lookup()(끝까지
 * 따라감)으로 실제 대상의 kind/mode 를 본다 — 링크 자체 노드는 symlink() 가 항상 0o777
 * 로 만들어서, lstat 의 mode 로 실행 가능 여부를 판정하면 늘 "실행 가능"이 되어버려
 * 의미가 없다.
 *
 * positional 은 (source 와 달리, 함수 호출과 같이) ARGS 유무와 무관하게 **항상**
 * 덮어쓴다 — docker 확인: 호출자가 `set -- callerarg` 상태에서 인자 없이 `./f3.sh` 를
 * 돌리면 스크립트 안 `$1` 은 빈 문자열이다(호출자의 `$1` 이 절대 안 샌다). source 의
 * "ARGS 없으면 호출자 걸 그대로 본다"와 정반대다.
 */
async function execScriptFile(ctx: RunCtx, e: CommandEnv): Promise<ExecResult> {
  const label = e.name // argv[0], 사용자가 쓴 그대로(예: "./deploy.sh") — 에러 메시지에 그대로 쓴다
  const path = e.fs.resolve(label, e.state.cwd)
  const node = e.fs.lookup(path) // 심볼릭 링크는 끝까지 따라간다 (existence + kind + mode 모두 대상 기준)
  if (!node) return { stdout: '', stderr: `bash: ${label}: No such file or directory\n`, exitCode: 127 }
  if (node.kind === 'dir') return { stdout: '', stderr: `bash: ${label}: Is a directory\n`, exitCode: 126 }
  if ((node.mode & 0o111) === 0) return { stdout: '', stderr: `bash: ${label}: Permission denied\n`, exitCode: 126 }

  let ast: ListNode
  try {
    ast = parse(node.content)
  } catch (err) {
    return { stdout: '', stderr: `bash: ${err instanceof Error ? err.message : String(err)}\n`, exitCode: 2 }
  }

  const child = childCtx(ctx, { isolateFunctions: true })
  child.state.env = { ...e.state.env } // 명령앞 대입(VAR=x ./script.sh)이 반영된 commandEnv 를 물려받는다
  child.positional = e.args // 스크립트명 다음 인자들. ARGS 가 없어도 항상 덮어쓴다(함수 호출과 동일)

  try {
    return await runList(ast, child)
  } catch (err) {
    if (err instanceof ExecutionLimitError) throw err // 공유 예산 소진은 그대로 위로 던져 run()이 exit 130을 낸다.
    if (err instanceof ControlSignal) return { stdout: err.stdout, stderr: err.stderr, exitCode: 0 }
    throw err // 방어적: 위 두 경우 외에는 이 childCtx(loopDepth=0, funcDepth=0)에서 실질적으로 도달하지 않는다.
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

    // 2. 명령 없는 순수 대입: 셸 상태를 영구히 바꾼다. 대입값은 **단어분리도 글롭도 하지
    //    않는다**(bash: NAME=VALUE 의 VALUE 는 tilde·파라미터·명령치환·산술확장·따옴표제거만
    //    거친다) — expandForCase 가 정확히 그 확장이다. expandWord().join(' ') 로 하면 IFS
    //    분할이 걸려, `IFS=:` 이후 `IFS=:`(값 `:`가 IFS 로 잘림→`""`)이나 `PATH=/a:/b`(→`/a /b`)
    //    가 깨진다(docker: `IFS=:; IFS=:; echo "[$IFS]"` → `[:]`, `x=a:b:c` → `[a:b:c]`).
    if (argv.length === 0) {
      for (const assignment of node.assignments) {
        ctx.state.env[assignment.name] = await expandForCase(assignment.value, expandCtx)
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    return { stdout: '', stderr: `bash: ${errnoText(e)}\n`, exitCode: 1 }
  }

  // 2.5 함수/source 호출을 **감지**한다(lookupCommand 보다 먼저 — bash 는 함수가 동명의
  //     빌트인/coreutil 을 가린다, docker: `ls() { echo faked; }; ls` → faked). 예전에는 이
  //     지점에서 곧바로 return 했지만(리다이렉션·프리픽스·stdin 해석 전이라 3갭이 생겼다),
  //     이제는 감지만 하고 실제 실행은 아래(리다이렉션·프리픽스·stdin 해석 뒤)로 미룬다
  //     (M3 Part 2 task 4). 그래야 `f > out`(출력 리다이렉션), `VAR=x f`(프리픽스 대입),
  //     `data | f`(파이프 stdin)가 외부 명령과 **같은** 경로를 타 정확히 동작한다. source 는
  //     함수보다 뒤에 봐서, 동명(`source`/`.`)의 함수를 정의했다면 함수가 먼저 채간다.
  const fnBody = ctx.functions.get(argv[0]!)
  const isSource = !fnBody && (argv[0] === 'source' || argv[0] === '.')

  // 3. 명령 앞의 대입값을 한 번만 확장해 둔다(2번과 같은 이유로 단어분리·글롭 없는
  //    expandForCase — `IFS=: cmd` 처럼 값에 IFS 문자가 있어도 안 잘린다). 외부 명령은 이
  //    값들로 섀도우 commandEnv 를 만들어 명령에만 보이게 하고(끝나면 버림), 함수/source 는
  //    env 를 공유하므로 아래 withPrefixEnv 로 공유 env 에 잠깐 얹었다 되돌린다.
  let prefixAssignments: { name: string; value: string }[]
  try {
    prefixAssignments = []
    for (const assignment of node.assignments) {
      prefixAssignments.push({ name: assignment.name, value: await expandForCase(assignment.value, expandCtx) })
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

  // 7~8. 결과 ExecResult(result)를 만든다 — 세 경로(함수 / source / 외부 명령·스크립트)가
  //    여기서 갈리지만, 모두 위에서 해석한 stdin(input)·프리픽스·리다이렉션(redirs)을 공유하고
  //    아래 9번(출력 리다이렉션)으로 result 를 **똑같이** 흘려보낸다(경로별로 리다이렉션
  //    블록을 복제하지 않는다). 함수/source 는 셸 env·cwd 를 공유하므로 섀도우 env 가 아니라
  //    withPrefixEnv 로 프리픽스만 잠깐 얹었다 되돌리고, input 을 body 첫 단계로 흘려보낸다.
  let result: ExecResult

  if (fnBody) {
    // 함수: env/cwd 공유. body 안의 대입/`cd` 는 그대로 남고(회귀 방지), 프리픽스 키만
    // withPrefixEnv 가 호출 전후로 save/restore 한다(docker: `VAR=hey f` 뒤 VAR 는 복원).
    result = await withPrefixEnv(ctx, prefixAssignments, () => callFunction(fnBody, argv, ctx, input))
  } else if (isSource) {
    // source: 함수와 같은 env-공유 프리픽스 처리. 출력/ stdin 리다이렉션은 아래 9번/ input 이 담당.
    result = await withPrefixEnv(ctx, prefixAssignments, () => runSource(argv, ctx, input))
  } else {
    // 외부 명령/스크립트: 프리픽스는 섀도우 commandEnv 에만 얹고(끝나면 버림), trap-1 로
    // 비프리픽스 키만 실제 셸 env 로 copy-back 한다.
    const commandEnv = { ...ctx.state.env }
    for (const { name, value } of prefixAssignments) commandEnv[name] = value

    // 명령을 찾는다. name 에 '/'가 있으면(`./script.sh`, `path/to/x`) — bash 가 슬래시 있는
    // 이름은 PATH 를 안 보고 그 경로를 직접 exec 하듯 — lookupCommand 실패 시 VFS 파일 실행
    // (execScriptFile, Task 9)을 시도한다. 슬래시 없는 미등록 이름은 command not found.
    const name = argv[0]!
    const fn = lookupCommand(name) ?? (name.includes('/') ? (e: CommandEnv) => execScriptFile(ctx, e) : undefined)
    if (!fn) {
      const message = isKnownUnimplemented(name)
        ? `flashshell: ${name}: 이 환경에는 없는 명령입니다\n`
        : `bash: ${name}: command not found\n`
      return { stdout: '', stderr: message, exitCode: 127 }
    }

    // 실행한다. 빌트인은 state 를 직접 고친다.
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

/**
 * @param initialStdin 이 파이프라인의 **첫 단계**로 흘려보낼 입력(기본값 `''`). 기존
 * 호출부(if/while/for 의 cond/body 등)는 인자를 안 줘서 그대로 `''`(현재 동작 불변) —
 * runSubshellCommand 만 서브셸이 받은 stdin 을 넘긴다(task 3, `echo hi | (cat)`).
 */
async function runPipeline(node: PipelineNode, ctx: RunCtx, initialStdin = ''): Promise<ExecResult> {
  // 실제 bash는 파이프라인의 모든 단계(마지막 단계 포함)를 서브셸에서 돌린다 — docker로
  // 확인: `cd /tmp; echo hi | cd /; pwd` → /tmp (안 바뀜), `X=orig; echo hi | X=1; echo
  // $X` → orig (안 바뀜). 그래서 단계가 2개 이상이면 각 단계를 독립된 자식 컨텍스트에서
  // 돌려 cwd/env 변경이 바깥으로 새지 않게 한다. 단일 명령(파이프 없음)은 클론하지 않고
  // 진짜 ctx 를 그대로 써서 `cd`/대입이 정상적으로 다음 명령에 이어지게 한다.
  const isolated = node.commands.length > 1
  let stdin = initialStdin
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

/**
 * @param initialStdin 이 리스트의 **첫 아이템의 첫 파이프라인**에만 흘려보낼 입력(기본값
 * `''`). 기존 호출부는 인자를 안 줘서 그대로 `''`(현재 동작 불변) — runSubshellCommand
 * 만 서브셸이 받은 stdin 을 넘긴다. 두 번째 아이템부터는(`;`/`&&`/`||` 뒤) 흘려보내지
 * 않는다 — bash 는 서브셸 안 파이프라인마다 독립적으로 자기 stdin 을 결정하지만(대개
 * 터미널/상속), "받은 stdin 을 본문의 첫 단계로 잇는다"는 이 태스크의 최소 범위를
 * 넘어서는 건 Task 4(if/while/for 전반의 stdin 스레딩)로 미룬다.
 */
async function runList(node: ListNode, ctx: RunCtx, initialStdin = ''): Promise<ExecResult> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  let isFirstItem = true

  for (const item of node.items) {
    if (item.op === '&&' && exitCode !== 0) continue
    if (item.op === '||' && exitCode === 0) continue

    const stdinForThisItem = isFirstItem ? initialStdin : ''
    isFirstItem = false
    let result: ExecResult
    try {
      result = await runPipeline(item.pipeline, ctx, stdinForThisItem)
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
    // state.functions 를 참조로 그대로 쓴다(새 Map 이 아님) — createShell 이 만든 state 는
    // exec() 호출을 넘어 살아남으므로, 이렇게 하면 함수 정의가 다음 exec() 에서도 보인다
    // (Task 11b: REPL 한 줄 = exec() 한 번인데, 실제 bash 는 함수가 셸 수명 동안 남는다).
    loopDepth: 0, functions: state.functions, funcDepth: 0,
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
