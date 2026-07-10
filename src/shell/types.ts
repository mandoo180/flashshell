import type { VFS } from './vfs'

export interface ExecResult { stdout: string; stderr: string; exitCode: number }

/** 셸의 변경 가능한 상태. 빌트인은 이것을 직접 고친다. */
export interface ShellState {
  cwd: string
  oldPwd: string
  env: Record<string, string>
  lastExitCode: number
  readonly home: string
}

export interface CommandEnv {
  name: string                 // argv[0]
  args: string[]               // argv[1..]
  stdin: string
  /**
   * stdin 이 `< file` 리다이렉션에서 왔는가? 파이프에서 왔으면 false.
   * GNU wc 는 이 둘을 구분해 출력 폭을 다르게 쓴다. 파이프는 크기를 미리 알 수 없다.
   */
  stdinFromFile: boolean
  fs: VFS
  state: ShellState
  /**
   * 이 명령이 다른 명령줄을 실행해야 할 때(find -exec, xargs) 쓰는 콜백.
   * 인터프리터가 주입한다. 같은 fs/state/budget 위에서 돈다.
   * exec()가 절대 reject 안 하듯 이 콜백도 ExecResult 를 resolve 한다.
   */
  runLine?: (line: string) => Promise<ExecResult>
  /**
   * 현재 몇 겹의 루프(while/until/for) 안에서 실행 중인지. break/continue 빌트인이
   * 이 값으로 "루프 안이면 신호를 던지고, 밖이면 경고만 하고 no-op" 을 가른다.
   * 인터프리터가 주입한다(없으면 0으로 취급 = 루프 밖).
   */
  loopDepth?: number
  /**
   * 현재 몇 겹의 함수 호출 안에서 실행 중인지. return 빌트인이 이 값으로 "함수 안이면
   * ReturnSignal 을 던지고, 밖이면 경고만 하고 no-op(exit 2)" 을 가른다 — break/continue
   * 가 loopDepth 로 판정하는 것과 같은 원리다. 인터프리터가 주입한다(없으면 0 = 함수 밖).
   * 서브셸/명령치환(childCtx) 안에서는 0으로 리셋된다 — bash 는 `$( )` 안의 return 을
   * "함수 밖"으로 본다(치환 셸에서 벗어날 뿐 바깥 함수를 벗어나지 않는다).
   */
  funcDepth?: number
}

export type CommandOutput = ExecResult
export type CommandFn = (e: CommandEnv) => CommandOutput | Promise<CommandOutput>

export interface Shell {
  exec(line: string): Promise<ExecResult>
  readonly fs: VFS
  readonly cwd: string
  readonly env: Record<string, string>
}

export const ok = (stdout = ''): CommandOutput => ({ stdout, stderr: '', exitCode: 0 })
export const fail = (stderr: string, exitCode = 1): CommandOutput => ({ stdout: '', stderr, exitCode })
