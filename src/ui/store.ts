import { create } from 'zustand'
import type { Shell } from '../shell/types'
import { commandNames } from '../shell/index'
import { allProblems } from '../game/problems/index'
import { createShellForProblem, PLAYER_HOME } from '../game/harness'
import {
  loadProgress, saveProgress, markSolved, markHintUsed, type Progress,
} from '../game/progress'
import type { Level, Problem } from '../game/types'
import type { TermLine } from './Terminal'

export type Signal = 'idle' | 'wrong' | 'solved'

export interface GameStore {
  screen: 'levels' | 'play'
  progress: Progress
  problem: Problem | null
  shell: Shell | null
  lines: TermLine[]
  history: string[]
  status: 'playing' | 'solved'
  hintsShown: number
  signal: Signal
  signalTick: number

  openLevel(level: Level): void
  startProblem(id: string): void
  submit(line: string): Promise<void>
  revealHint(): void
  nextProblem(): void
  resetProblem(): void
  backToLevels(): void
  clearSignal(): void
  completions(partial: string): string[]
  prompt(): string
}

function toLines(text: string, tone: TermLine['tone']): TermLine[] {
  if (text === '') return []
  return text.replace(/\n$/, '').split('\n').map((t) => ({ text: t, tone }))
}

export const useGame = create<GameStore>((set, get) => ({
  screen: 'levels',
  progress: loadProgress(),
  problem: null,
  shell: null,
  lines: [],
  history: [],
  status: 'playing',
  hintsShown: 0,
  signal: 'idle',
  signalTick: 0,

  openLevel: (level) => {
    const first = allProblems.find((p) => p.level === level)
    if (first) get().startProblem(first.id)
  },

  startProblem: (id) => {
    const problem = allProblems.find((p) => p.id === id)
    if (!problem) return
    set((s) => ({
      screen: 'play',
      problem,
      shell: createShellForProblem(problem),
      lines: [],
      history: [],
      status: 'playing',
      hintsShown: 0,
      signal: 'idle',
      signalTick: s.signalTick + 1,
    }))
  },

  submit: async (line) => {
    const { shell, problem, status, prompt } = get()
    if (!shell || !problem) return

    const trimmed = line.trim()
    if (trimmed === 'clear') { set({ lines: [] }); return }
    if (trimmed === 'reset') { get().resetProblem(); return }

    const echoed: TermLine = { text: `${prompt()}${line}`, tone: 'dim' }
    if (trimmed === '') { set((s) => ({ lines: [...s.lines, echoed] })); return }

    const result = await shell.exec(trimmed)
    const history = [...get().history, trimmed]

    set((s) => ({
      lines: [...s.lines, echoed, ...toLines(result.stdout, 'green'), ...toLines(result.stderr, 'amber')],
      history,
    }))

    // 이미 풀었으면 다시 판정하지 않는다. 사용자가 계속 놀 수 있게 둔다.
    if (status === 'solved') return

    let solved = false
    try {
      solved = problem.check({ fs: shell.fs, lastResult: result, history, cwd: shell.cwd })
    } catch (error) {
      // 출제자의 버그가 플레이어의 크래시가 되어서는 안 된다.
      console.warn(`check() threw for ${problem.id}`, error)
    }

    if (solved) {
      const progress = markSolved(get().progress, problem.id)
      saveProgress(progress)
      set((s) => ({ status: 'solved', signal: 'solved', progress, signalTick: s.signalTick + 1 }))
      return
    }

    set((s) => ({ signal: result.exitCode === 0 ? 'idle' : 'wrong', signalTick: s.signalTick + 1 }))
  },

  revealHint: () => {
    const { problem, hintsShown, progress } = get()
    if (!problem || hintsShown >= problem.hints.length) return
    const next = markHintUsed(progress, problem.id)
    saveProgress(next)
    set({ hintsShown: hintsShown + 1, progress: next })
  },

  nextProblem: () => {
    const { problem } = get()
    if (!problem) return
    const siblings = allProblems.filter((p) => p.level === problem.level)
    const index = siblings.findIndex((p) => p.id === problem.id)
    const next = siblings[index + 1]
    if (next) get().startProblem(next.id)
    else get().backToLevels()
  },

  resetProblem: () => {
    const { problem } = get()
    if (!problem) return
    set((s) => ({
      shell: createShellForProblem(problem),
      lines: [],
      history: [],
      status: 'playing',
      signal: 'idle',
      signalTick: s.signalTick + 1,
    }))
  },

  backToLevels: () => set({ screen: 'levels', problem: null, shell: null, lines: [] }),

  clearSignal: () => set((s) => (s.signal === 'wrong' ? { signal: 'idle', signalTick: s.signalTick + 1 } : s)),

  completions: (partial) => {
    const { shell } = get()
    if (!shell) return []
    // 첫 단어인지 아닌지는 Terminal 이 잘라서 준 partial 만으로는 알 수 없다.
    // 명령 이름과 파일 이름을 모두 후보로 내고, 사용자가 고르게 한다.
    const names = commandNames().filter((n) => n.startsWith(partial))
    let files: string[] = []
    try { files = shell.fs.readdir(shell.cwd).filter((n) => n.startsWith(partial)) } catch { files = [] }
    return [...new Set([...names, ...files])].sort()
  },

  prompt: () => {
    const { shell } = get()
    if (!shell) return '$ '
    const cwd = shell.cwd === PLAYER_HOME
      ? '~'
      : shell.cwd.startsWith(`${PLAYER_HOME}/`)
        ? `~${shell.cwd.slice(PLAYER_HOME.length)}`
        : shell.cwd
    return `player@flashshell:${cwd}$ `
  },
}))
