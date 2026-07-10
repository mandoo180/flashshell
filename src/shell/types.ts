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
