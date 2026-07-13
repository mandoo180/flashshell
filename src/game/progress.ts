import type { Level, Problem } from './types'

export interface Progress {
  solved: string[]
  hintsUsed: string[]
}

export const UNLOCK_THRESHOLD = 8
const STORAGE_KEY = 'flashshell.progress.v1'

export function emptyProgress(): Progress {
  return { solved: [], hintsUsed: [] }
}

/**
 * 배열이면서 모든 요소가 문자열인지 검증.
 * 요소가 하나라도 문자가 아니면 전체 배열을 버린다.
 */
function validateStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : []
}

export function loadProgress(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return emptyProgress()
    const parsed = JSON.parse(raw) as Partial<Progress>
    return {
      solved: validateStringArray(parsed.solved),
      hintsUsed: validateStringArray(parsed.hintsUsed),
    }
  } catch {
    // 손상된 저장소나 localStorage 부재가 게임을 막아서는 안 된다.
    return emptyProgress()
  }
}

export function saveProgress(progress: Progress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // 사파리 프라이빗 모드 등 setItem이 던지는 환경. 진행도가 안 남을 뿐 게임은 계속된다.
  }
}

function addUnique(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id]
}

export function markSolved(progress: Progress, id: string): Progress {
  return { ...progress, solved: addUnique(progress.solved, id) }
}

export function markHintUsed(progress: Progress, id: string): Progress {
  return { ...progress, hintsUsed: addUnique(progress.hintsUsed, id) }
}

export function solvedInLevel(progress: Progress, level: Level, problems: Problem[]): number {
  const ids = new Set(problems.filter((p) => p.level === level).map((p) => p.id))
  return progress.solved.filter((id) => ids.has(id)).length
}

/**
 * 순차 해제: 레벨 N은 레벨 N-1이 해제되어 있고, 그 레벨에서 UNLOCK_THRESHOLD개 이상
 * 풀었을 때만 열린다. 재귀 없이 "직전 레벨 해결 수"만 보면, 저장소를 조작해 레벨 1은
 * 건너뛰고 레벨 2만 8개 푼 상태에서 레벨 3이 열려버린다. level===1이 재귀의 기저
 * 조건이라 재귀는 최대 4단(레벨 5→1)에서 끝난다.
 */
export function isLevelUnlocked(level: Level, progress: Progress, problems: Problem[]): boolean {
  if (level === 1) return true
  const previous = (level - 1) as Level
  if (!isLevelUnlocked(previous, progress, problems)) return false
  return solvedInLevel(progress, previous, problems) >= UNLOCK_THRESHOLD
}

/**
 * 레벨에 속한 문제만 배열 순서 그대로 반환.
 */
export function levelProblems(level: Level, problems: Problem[]): Problem[] {
  return problems.filter((p) => p.level === level)
}

/**
 * 레벨 내 이동 가능 인덱스 상한 = 첫 미해결 문제의 인덱스.
 * 전부 해결했다면 이동 범위는 레벨 전체이므로 마지막 인덱스를 반환한다.
 * solved가 접두 구간이 아니어도(예: l1-01, l1-03만 풀림) "첫 미해결"을 그대로 찾는다.
 */
export function frontierIndex(level: Level, progress: Progress, problems: Problem[]): number {
  const list = levelProblems(level, problems)
  const solved = new Set(progress.solved)
  const index = list.findIndex((p) => !solved.has(p.id))
  return index === -1 ? Math.max(list.length - 1, 0) : index
}

/**
 * 착지할 문제 = 첫 미해결 문제. 전부 해결했다면 처음부터 복습하도록 레벨의 첫
 * 문제로 착지한다 — frontierIndex의 "마지막 인덱스"와 의도적으로 다른 값이다
 * (착지는 처음부터 복습, 이동 범위는 레벨 전체라는 스펙 결정).
 * 레벨이 비어 있지 않음은 호출자가 보장한다(openLevel의 find + 가드와 동일 관례).
 */
export function frontierProblem(level: Level, progress: Progress, problems: Problem[]): Problem {
  const list = levelProblems(level, problems)
  const solved = new Set(progress.solved)
  return list.find((p) => !solved.has(p.id)) ?? list[0]! // 레벨이 비어 있지 않음을 호출자가 보장
}
