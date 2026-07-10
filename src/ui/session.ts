import type { Shell } from '../shell/types'
import { allProblems } from '../game/problems/index'
import { createShellForProblem, PLAYER_HOME } from '../game/harness'
import type { Problem } from '../game/types'

export interface StateSnapshot {
  cwd: string
  cwdEntries: string[] // readdir(cwd) 정렬. Tab 자동완성용.
  env: Record<string, string>
}
export interface ExecResponse {
  stdout: string
  stderr: string
  exitCode: number
  snapshot: StateSnapshot
  solved: boolean
}
/** 스토어가 셸과 대화하는 유일한 통로. 전부 비동기. */
export interface ShellSession {
  start(problemId: string): Promise<StateSnapshot> // 문제의 셸을 짓고 초기 스냅샷 반환
  exec(line: string): Promise<ExecResponse> // 실행 + check + 스냅샷
  reset(): Promise<StateSnapshot> // 현재 문제 셸 재생성
  dispose(): void
}

const EMPTY_SNAPSHOT: StateSnapshot = { cwd: PLAYER_HOME, cwdEntries: [], env: {} }

/** 인프로세스 구현. Node/jsdom 테스트와, 워커 안(Task 8)에서 공용. */
export class LocalShellSession implements ShellSession {
  private shell: Shell | null = null
  private problem: Problem | null = null
  private history: string[] = []

  async start(problemId: string): Promise<StateSnapshot> {
    this.problem = allProblems.find((p) => p.id === problemId) ?? null
    this.history = []
    this.shell = this.problem ? createShellForProblem(this.problem) : null
    return this.snapshot()
  }

  async exec(line: string): Promise<ExecResponse> {
    if (!this.shell || !this.problem) {
      return { stdout: '', stderr: '', exitCode: 0, snapshot: this.snapshot(), solved: false }
    }
    const result = await this.shell.exec(line)
    this.history.push(line)
    let solved = false
    try {
      solved = this.problem.check({ fs: this.shell.fs, lastResult: result, history: this.history, cwd: this.shell.cwd })
    } catch (error) {
      // 출제자의 버그가 플레이어의 크래시가 되어서는 안 된다.
      console.warn(`check() threw for ${this.problem.id}`, error)
    }
    return { ...result, snapshot: this.snapshot(), solved }
  }

  async reset(): Promise<StateSnapshot> {
    if (this.problem) {
      this.shell = createShellForProblem(this.problem)
      this.history = []
    }
    return this.snapshot()
  }

  dispose(): void {}

  private snapshot(): StateSnapshot {
    if (!this.shell) return EMPTY_SNAPSHOT
    let cwdEntries: string[] = []
    try {
      cwdEntries = this.shell.fs.readdir(this.shell.cwd)
    } catch {
      cwdEntries = []
    }
    return { cwd: this.shell.cwd, cwdEntries, env: { ...this.shell.env } }
  }
}
