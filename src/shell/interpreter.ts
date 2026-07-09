import { VFS } from './vfs'
import { ExecutionLimitError, errnoText } from './errors'
import { parse, type CommandNode, type ListNode, type PipelineNode } from './parser'
import { expandWord, expandToSingle, type ExpandCtx } from './expand'
import { lookupCommand, isKnownUnimplemented } from './registry'
import type { CommandEnv, ExecResult, ShellState } from './types'

/** 한 번의 exec 동안만 사는 실행 컨텍스트. */
interface RunCtx {
  fs: VFS
  state: ShellState
  budget: { remaining: number }
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
 */
function childCtx(ctx: RunCtx): RunCtx {
  return { fs: ctx.fs, state: { ...ctx.state, env: { ...ctx.state.env } }, budget: ctx.budget }
}

function expandCtxFor(ctx: RunCtx): ExpandCtx {
  return {
    env: ctx.state.env,
    cwd: ctx.state.cwd,
    home: ctx.state.home,
    fs: ctx.fs,
    lastExitCode: ctx.state.lastExitCode,
    // 서브셸은 같은 VFS와 예산을 공유하되, cwd/env 변경은 밖으로 새지 않는다.
    runSubshell: async (script) => {
      const child = childCtx(ctx)
      // 서브셸 안의 문법 오류가 exec 전체를 리젝트시켜서는 안 된다.
      // 다만 실행 한도 초과는 바깥까지 전파되어야 한다.
      try {
        return await runList(parse(script), child)
      } catch (e) {
        if (e instanceof ExecutionLimitError) throw e
        return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
      }
    },
  }
}

interface ResolvedRedir { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; path: string }

async function runCommand(node: CommandNode, ctx: RunCtx, stdin: string): Promise<ExecResult> {
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

  // 4~6. 리다이렉션을 텍스트에 나온 순서 그대로 왼쪽에서 오른쪽으로 처리한다. 실제 bash가
  //    그렇게 하기 때문이다 — 대상 확장(ambiguous 여부)과 open()류 부작용(> 는 즉시 비우고,
  //    < 는 즉시 읽고, >> 는 없으면 만듦)이 리다이렉션마다 함께 일어난다. 뒤의 리다이렉션이
  //    실패해도 앞의 리다이렉션이 이미 만든 부작용(예: 파일 비움)은 되돌리지 않는다 —
  //    docker로 확인: `> out < gone` 은 out 을 비운 뒤에 실패하고, `< gone > out` 은
  //    out 을 건드리기도 전에 실패한다. 같은 fd 로 두 번 리다이렉션되면(`> a > b`) 전부
  //    비워지지만 실제 내용은 마지막 것만 받는다 — 그래서 여기서는 "비우기/만들기"만 하고,
  //    실제 출력 내용 쓰기는 명령 실행 후 9번 단계에서 fd 별 마지막 리다이렉션에만 한다.
  const redirs: ResolvedRedir[] = []
  let input = stdin
  let inputFromFile = false

  for (const redir of node.redirs) {
    let word: string
    try {
      word = await expandToSingle(redir.target, expandCtx)
    } catch (e) {
      if (e instanceof ExecutionLimitError) throw e
      return { stdout: '', stderr: `bash: ambiguous redirect\n`, exitCode: 1 }
    }
    const path = ctx.fs.resolve(word, ctx.state.cwd)

    try {
      if (redir.op === '<') {
        input = ctx.fs.readFile(path)
        inputFromFile = true
      } else if (redir.op === '>') {
        ctx.fs.writeFile(path, '')
      } else {
        // '>>' — 이어쓰기는 기존 내용을 비우지 않지만, 없던 파일은 즉시 만든다
        // (open(..., O_APPEND|O_CREAT) 이 하는 일과 같다).
        if (!ctx.fs.exists(path)) ctx.fs.writeFile(path, '')
      }
    } catch (e) {
      return { stdout: '', stderr: `bash: ${path}: ${errnoText(e)}\n`, exitCode: 1 }
    }

    redirs.push({ fd: redir.fd, op: redir.op, path })
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
  }
  let result: ExecResult
  try {
    result = await fn(cmdEnv)
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
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
      return { stdout: '', stderr: `bash: ${redir.path}: ${errnoText(e)}\n`, exitCode: 1 }
    }
    if (redir.fd === 1) stdout = ''
    else stderr = ''
  }

  return { stdout, stderr, exitCode: result.exitCode }
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

    const result = await runPipeline(item.pipeline, ctx)
    stdout += result.stdout
    stderr += result.stderr
    exitCode = result.exitCode
    ctx.state.lastExitCode = exitCode
  }

  return { stdout, stderr, exitCode }
}

export async function run(line: string, fs: VFS, state: ShellState, stepBudget: number): Promise<ExecResult> {
  const ctx: RunCtx = { fs, state, budget: { remaining: stepBudget } }
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
    // 위에서 예상 가능한 실패 지점은 전부 자체적으로 ExecResult 로 바꾸지만, exec()는
    // 어떤 경우에도 reject 하면 안 된다는 계약을 지키기 위한 마지막 방어선이다.
    const message = e instanceof Error ? e.message : String(e)
    return { stdout: '', stderr: `flashshell: 알 수 없는 오류: ${message}\n`, exitCode: 1 }
  }
}
