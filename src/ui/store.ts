import { create } from 'zustand'
import { commandNames } from '../shell/registry'
import { allProblems } from '../game/problems/index'
import { PLAYER_HOME } from '../game/harness'
import {
  loadProgress, saveProgress, markSolved, markHintUsed, type Progress,
} from '../game/progress'
import type { Level, Problem } from '../game/types'
import type { TermLine } from './Terminal'
import type { ShellSession } from './session'
import { WorkerShellSession } from './worker-session'

export type Signal = 'idle' | 'wrong' | 'solved'

let sessionFactory: () => ShellSession = () => new WorkerShellSession()
/** 테스트가 인프로세스 세션을 주입한다. */
export function setSessionFactory(make: () => ShellSession): void { sessionFactory = make }

export interface GameStore {
  screen: 'levels' | 'play'
  progress: Progress
  problem: Problem | null
  session: ShellSession | null
  // shell.fs/shell.cwd 를 동기로 읽던 자리를 대신하는 미러 — 세션의 마지막
  // 응답(start/exec/reset)의 snapshot 으로 갱신된다. 세션은 비동기라 completions/
  // prompt 처럼 렌더 중에 동기로 불려야 하는 셀렉터는 이 미러만 읽는다.
  cwd: string
  cwdEntries: string[]
  env: Record<string, string>
  lines: TermLine[]
  history: string[]
  status: 'playing' | 'solved'
  hintsShown: number
  signal: Signal
  signalTick: number

  openLevel(level: Level): void
  startProblem(id: string): Promise<void>
  submit(line: string): Promise<void>
  revealHint(): void
  nextProblem(): Promise<void>
  resetProblem(): Promise<void>
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
  session: null,
  cwd: PLAYER_HOME,
  cwdEntries: [],
  env: {},
  lines: [],
  history: [],
  status: 'playing',
  hintsShown: 0,
  signal: 'idle',
  signalTick: 0,

  openLevel: (level) => {
    const first = allProblems.find((p) => p.level === level)
    if (first) void get().startProblem(first.id)
  },

  startProblem: async (id) => {
    const problem = allProblems.find((p) => p.id === id)
    if (!problem) return

    // 세션은 스토어 수명 동안 하나만 만들어 재사용한다(브라우저에서는 워커
    // 하나를 계속 쓴다는 뜻) — 문제가 바뀔 때마다 새로 만드는 건 session.start()
    // 가 알아서 한다.
    let { session } = get()
    if (!session) {
      session = sessionFactory()
      set({ session })
    }

    const snapshot = await session.start(id)
    set((s) => ({
      screen: 'play',
      problem,
      cwd: snapshot.cwd,
      cwdEntries: snapshot.cwdEntries,
      env: snapshot.env,
      lines: [],
      history: [],
      status: 'playing',
      hintsShown: 0,
      signal: 'idle',
      signalTick: s.signalTick + 1,
    }))
  },

  submit: async (line) => {
    const { session, problem, status, prompt } = get()
    if (!session || !problem) return

    const trimmed = line.trim()
    if (trimmed === 'clear') { set({ lines: [] }); return }
    if (trimmed === 'reset') { await get().resetProblem(); return }

    const echoed: TermLine = { text: `${prompt()}${line}`, tone: 'dim' }
    if (trimmed === '') { set((s) => ({ lines: [...s.lines, echoed] })); return }

    const response = await session.exec(trimmed)
    const history = [...get().history, trimmed]

    set((s) => ({
      lines: [...s.lines, echoed, ...toLines(response.stdout, 'green'), ...toLines(response.stderr, 'amber')],
      history,
      cwd: response.snapshot.cwd,
      cwdEntries: response.snapshot.cwdEntries,
      env: response.snapshot.env,
    }))

    // 이미 풀었으면 다시 판정하지 않는다. 사용자가 계속 놀 수 있게 둔다.
    if (status === 'solved') return

    if (response.solved) {
      const progress = markSolved(get().progress, problem.id)
      saveProgress(progress)
      set((s) => ({ status: 'solved', signal: 'solved', progress, signalTick: s.signalTick + 1 }))
      return
    }

    set((s) => ({ signal: response.exitCode === 0 ? 'idle' : 'wrong', signalTick: s.signalTick + 1 }))
  },

  revealHint: () => {
    const { problem, hintsShown, progress } = get()
    if (!problem || hintsShown >= problem.hints.length) return
    const next = markHintUsed(progress, problem.id)
    saveProgress(next)
    set({ hintsShown: hintsShown + 1, progress: next })
  },

  nextProblem: async () => {
    const { problem } = get()
    if (!problem) return
    const siblings = allProblems.filter((p) => p.level === problem.level)
    const index = siblings.findIndex((p) => p.id === problem.id)
    const next = siblings[index + 1]
    if (next) await get().startProblem(next.id)
    else get().backToLevels()
  },

  resetProblem: async () => {
    const { session, problem } = get()
    if (!session || !problem) return
    const snapshot = await session.reset()
    set((s) => ({
      cwd: snapshot.cwd,
      cwdEntries: snapshot.cwdEntries,
      env: snapshot.env,
      lines: [],
      history: [],
      status: 'playing',
      signal: 'idle',
      signalTick: s.signalTick + 1,
    }))
  },

  backToLevels: () => set({ screen: 'levels', problem: null, lines: [] }),

  clearSignal: () => set((s) => (s.signal === 'wrong' ? { signal: 'idle', signalTick: s.signalTick + 1 } : s)),

  completions: (partial) => {
    const names = commandNames().filter((n) => n.startsWith(partial))
    const files = get().cwdEntries.filter((n) => n.startsWith(partial))
    return [...new Set([...names, ...files])].sort()
  },

  prompt: () => {
    const cwd = get().cwd
    const shown = cwd === PLAYER_HOME
      ? '~'
      : cwd.startsWith(`${PLAYER_HOME}/`)
        ? `~${cwd.slice(PLAYER_HOME.length)}`
        : cwd
    return `player@flashshell:${shown}$ `
  },
}))
