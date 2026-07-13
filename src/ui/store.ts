import { create } from 'zustand'
import { commandNames } from '../shell/registry'
import { allProblems } from '../game/problems/index'
import { PLAYER_HOME } from '../game/harness'
import {
  loadProgress, saveProgress, markSolved, markHintUsed,
  levelProblems, frontierIndex, frontierProblem, type Progress,
} from '../game/progress'
import type { Level, Problem } from '../game/types'
import type { TermLine } from './Terminal'
import type { ShellSession } from './session'
import { WorkerShellSession } from './worker-session'

export type Signal = 'idle' | 'wrong' | 'solved'

let sessionFactory: () => ShellSession = () => new WorkerShellSession()
/** 테스트가 인프로세스 세션을 주입한다. */
export function setSessionFactory(make: () => ShellSession): void { sessionFactory = make }

// 세션 요청 직렬화용 큐. 워커는 요청을 한 번에 하나만 처리하고 스스로 직렬화하지
// 않으므로(WorkerShellSession 의 단일-인플라이트 가정), 스토어가 exec/reset/start 를
// 이 체인에 실어 순서대로·겹치지 않게 보낸다. 폭주 명령이 2초 데드라인을 기다리는
// 동안 들어온 명령은 드롭하지 않고 그 뒤에 이어서 실행한다(복구된 워커를 상대로) —
// 겹쳐 보내면 recover 가 레이스한다. 새 세션을 만들 때 초기화한다.
let sessionQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = sessionQueue.then(work, work) // 앞 작업의 성패와 무관하게 이어 실행
  sessionQueue = run.then(() => undefined, () => undefined) // 체인이 rejection 으로 끊기지 않게 흡수
  return run
}

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
  prevProblem(): Promise<void>
  nextProblemNav(): Promise<void>
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
    // frontierProblem은 레벨이 비어 있지 않음을 호출자가 보장하는 관례(list[0]!)라,
    // 여기서 먼저 레벨에 문제가 있는지 확인한다 — 없으면 오늘과 동일하게 조용히 no-op.
    if (levelProblems(level, allProblems).length === 0) return
    const target = frontierProblem(level, get().progress, allProblems)
    void get().startProblem(target.id)
  },

  startProblem: async (id) => {
    const problem = allProblems.find((p) => p.id === id)
    if (!problem) return

    // 세션은 스토어 수명 동안 하나만 만들어 재사용한다(브라우저에서는 워커
    // 하나를 계속 쓴다는 뜻) — 문제가 바뀔 때마다 새로 만드는 건 session.start()
    // 가 알아서 한다.
    let { session } = get()
    if (!session) {
      // 세션은 여기서 딱 한 번 만들어지고 이후 절대 null 로 되돌리지 않는다
      // (backToLevels 도 세션을 유지한다). 그래서 이 큐 리셋은 진행 중인 직렬화
      // 작업이 없는 최초 1회에만 실행돼 안전하다. 나중에 세션 teardown/재생성 경로를
      // 추가한다면, 이 `!session` 분기가 in-flight 중에 다시 참이 되어 큐에 쌓인
      // 작업을 버릴 수 있으니 그 불변식을 반드시 함께 지켜야 한다.
      session = sessionFactory()
      sessionQueue = Promise.resolve() // 새 세션 → 직렬화 큐 초기화
      set({ session })
    }
    const active = session // 클로저에서 non-null 로 안정 참조

    // start 도 큐에 실어, 로딩(워커에서는 데드라인이 걸린 start)이 앞선/뒤따르는
    // 요청과 겹치지 않게 한다.
    await serialize(async () => {
      const snapshot = await active.start(id)
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
    })
  },

  submit: async (line) => {
    const { session, problem, prompt } = get()
    if (!session || !problem) return

    const trimmed = line.trim()
    if (trimmed === 'clear') { set({ lines: [] }); return }
    if (trimmed === 'reset') { await get().resetProblem(); return }

    const echoed: TermLine = { text: `${prompt()}${line}`, tone: 'dim' }
    if (trimmed === '') { set((s) => ({ lines: [...s.lines, echoed] })); return }

    // exec 를 큐에 실어, 앞선 요청(예: 데드라인을 기다리는 폭주 명령)이 끝난 뒤
    // 순서대로 보낸다 — 겹쳐 보내면 워커가 recover 를 레이스한다.
    await serialize(async () => {
      // status/problem 은 앞선 큐 작업이 바꿨을 수 있으니 실행 시점에 다시 읽는다.
      const { status, problem: current } = get()
      if (!current) return
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
        const progress = markSolved(get().progress, current.id)
        saveProgress(progress)
        set((s) => ({ status: 'solved', signal: 'solved', progress, signalTick: s.signalTick + 1 }))
        return
      }

      set((s) => ({ signal: response.exitCode === 0 ? 'idle' : 'wrong', signalTick: s.signalTick + 1 }))
    })
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
    const siblings = levelProblems(problem.level, allProblems)
    const index = siblings.findIndex((p) => p.id === problem.id)
    const next = siblings[index + 1]
    if (next) await get().startProblem(next.id)
    else get().backToLevels()
  },

  prevProblem: async () => {
    const { problem } = get()
    if (!problem) return
    const siblings = levelProblems(problem.level, allProblems)
    const index = siblings.findIndex((p) => p.id === problem.id)
    if (index <= 0) return // 레벨의 첫 문제 — no-op
    const target = siblings[index - 1]!
    await get().startProblem(target.id)
  },

  nextProblemNav: async () => {
    const { problem, progress } = get()
    if (!problem) return
    const siblings = levelProblems(problem.level, allProblems)
    const index = siblings.findIndex((p) => p.id === problem.id)
    if (index >= frontierIndex(problem.level, progress, allProblems)) return // 프런티어 캡 — no-op
    const target = siblings[index + 1]
    if (!target) return
    await get().startProblem(target.id)
  },

  resetProblem: async () => {
    const { session, problem } = get()
    if (!session || !problem) return
    await serialize(async () => {
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
    })
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
