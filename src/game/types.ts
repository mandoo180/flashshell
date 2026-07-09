import type { VFS } from '../shell/vfs'
import type { ExecResult } from '../shell/types'

export type Level = 1 | 2 | 3 | 4 | 5

export interface CheckContext {
  fs: VFS
  lastResult: ExecResult
  history: string[]
  cwd: string
}

export interface Problem {
  id: string // 'l1-01'
  level: Level
  title: string // HUD 카드 제목
  prompt: string // 지문
  setup(fs: VFS): void
  hints: string[]
  check(ctx: CheckContext): boolean
  solution: string
  wrongAnswer: string // 그럴듯하지만 틀린 답. 음성 테스트용.
  explanation: string
}
