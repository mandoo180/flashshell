import { VFS } from './vfs'
import { run } from './interpreter'
import type { ExecResult, Shell, ShellState } from './types'

export interface CreateShellOptions {
  fs?: VFS
  cwd?: string
  home?: string
  env?: Record<string, string>
  /** 한 번의 exec 안에서 실행 가능한 최대 명령 수. 무한루프 방어. 기본 100000. */
  stepBudget?: number
}

export function createShell(opts: CreateShellOptions = {}): Shell {
  const fs = opts.fs ?? new VFS()
  const home = opts.home ?? '/home/player'
  const cwd = opts.cwd ?? home
  const stepBudget = opts.stepBudget ?? 100_000

  const state: ShellState = {
    cwd,
    oldPwd: cwd,
    env: { HOME: home, PWD: cwd, USER: 'player', SHELL: '/bin/bash', ...opts.env },
    lastExitCode: 0,
    home,
    functions: new Map(),
  }

  return {
    exec: (line: string): Promise<ExecResult> => run(line, fs, state, stepBudget),
    fs,
    get cwd() { return state.cwd },
    get env() { return state.env },
  }
}

export { VFS } from './vfs'
export { VfsError, ExecutionLimitError } from './errors'
export { commandNames } from './registry'
export type { Shell, ExecResult, CommandEnv, CommandOutput, CommandFn, ShellState } from './types'
