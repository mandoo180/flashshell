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
