import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  emptyProgress,
  loadProgress,
  saveProgress,
  markSolved,
  markHintUsed,
  isLevelUnlocked,
  solvedInLevel,
  UNLOCK_THRESHOLD,
} from './progress'
import type { Problem, Level } from './types'

function fakeProblems(): Problem[] {
  const make = (level: Level, n: number): Problem => ({
    id: `l${level}-${String(n).padStart(2, '0')}`,
    level, title: '', prompt: '', setup: () => {}, hints: [],
    check: () => false, solution: '', wrongAnswer: '', explanation: '',
  })
  return [1, 2, 3, 4, 5].flatMap((level) =>
    Array.from({ length: 10 }, (_, i) => make(level as Level, i + 1)),
  )
}

const problems = fakeProblems()

describe('레벨 해제', () => {
  it('레벨 1은 항상 열려 있다', () => {
    expect(isLevelUnlocked(1, emptyProgress(), problems)).toBe(true)
  })

  it('7문제로는 다음 레벨이 열리지 않는다', () => {
    let p = emptyProgress()
    for (let i = 1; i <= 7; i++) p = markSolved(p, `l1-0${i}`)
    expect(isLevelUnlocked(2, p, problems)).toBe(false)
  })

  it(`${UNLOCK_THRESHOLD}문제를 풀면 다음 레벨이 열린다`, () => {
    let p = emptyProgress()
    for (let i = 1; i <= UNLOCK_THRESHOLD; i++) p = markSolved(p, `l1-0${i}`)
    expect(isLevelUnlocked(2, p, problems)).toBe(true)
  })

  it('레벨 2를 건너뛰고 3이 열리지는 않는다', () => {
    let p = emptyProgress()
    for (let i = 1; i <= 10; i++) p = markSolved(p, `l1-${String(i).padStart(2, '0')}`)
    expect(isLevelUnlocked(2, p, problems)).toBe(true)
    expect(isLevelUnlocked(3, p, problems)).toBe(false)
  })

  it('solvedInLevel 은 해당 레벨만 센다', () => {
    let p = emptyProgress()
    p = markSolved(p, 'l1-01')
    p = markSolved(p, 'l2-01')
    expect(solvedInLevel(p, 1, problems)).toBe(1)
  })

  it('같은 문제를 두 번 풀어도 한 번만 센다', () => {
    let p = emptyProgress()
    p = markSolved(p, 'l1-01')
    p = markSolved(p, 'l1-01')
    expect(solvedInLevel(p, 1, problems)).toBe(1)
  })

  it('markSolved 는 원본을 변경하지 않는다', () => {
    const p = emptyProgress()
    markSolved(p, 'l1-01')
    expect(p.solved).toEqual([])
  })

  it('레벨 1을 건드리지 않고 레벨 2만 (저장소 조작으로) 8개 풀어도 레벨 2, 3 모두 잠긴다', () => {
    // isLevelUnlocked 는 재귀로 "직전 레벨이 해제됐는가"까지 확인해야 한다.
    // solvedInLevel(previous) >= THRESHOLD 만 보면 레벨 1을 건너뛰고도 레벨 2가 열려버린다.
    let p = emptyProgress()
    for (let i = 1; i <= UNLOCK_THRESHOLD; i++) p = markSolved(p, `l2-0${i}`)
    expect(isLevelUnlocked(2, p, problems)).toBe(false)
    expect(isLevelUnlocked(3, p, problems)).toBe(false)
  })

  it('markHintUsed 도 순수 함수이고 같은 id 중복 기록하지 않는다', () => {
    const p0 = emptyProgress()
    const p1 = markHintUsed(p0, 'l1-01')
    const p2 = markHintUsed(p1, 'l1-01')
    expect(p0.hintsUsed).toEqual([])
    expect(p1.hintsUsed).toEqual(['l1-01'])
    expect(p2.hintsUsed).toEqual(['l1-01'])
  })

  it('problems 목록에 없는 id 가 solved 에 있어도 카운트되지 않는다', () => {
    let p = emptyProgress()
    p = markSolved(p, 'l1-01')
    p = markSolved(p, 'l1-does-not-exist')
    expect(solvedInLevel(p, 1, problems)).toBe(1)
  })
})

// 테스트(node) 환경에는 애초에 localStorage 가 없다 — globalThis.localStorage 는 undefined.
// 아래 describe 는 그 기본 상태(없음)와, vi.stubGlobal 로 흉내 낸 "있지만 고장난" 상태를
// 모두 검증한다. 실제 저장소 없이도, 있는데 던지는 경우에도 게임이 죽지 않아야 한다.
describe('진행도 저장소 방어 (localStorage 없음/손상/예외)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('localStorage가 없는 노드 테스트 환경 그 자체를 전제로 한다', () => {
    expect(globalThis.localStorage).toBeUndefined()
  })

  it('localStorage가 없으면 loadProgress는 죽지 않고 빈 진행도를 돌려준다', () => {
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('localStorage가 없으면 saveProgress는 죽지 않는다', () => {
    expect(() => saveProgress(markSolved(emptyProgress(), 'l1-01'))).not.toThrow()
  })

  it('손상된 JSON이면 빈 진행도를 돌려준다', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not valid json' })
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('저장된 값이 JSON null 로 파싱되면 빈 진행도를 돌려준다', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'null' })
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('저장된 값이 JSON 숫자로 파싱되면 빈 진행도를 돌려준다', () => {
    vi.stubGlobal('localStorage', { getItem: () => '42' })
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('solved 가 배열이 아니면 빈 진행도를 돌려준다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ solved: 'not-an-array', hintsUsed: [] }),
    })
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('getItem 자체가 던져도 loadProgress는 죽지 않고 빈 진행도를 돌려준다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('boom')
      },
    })
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('setItem 이 던져도(사파리 프라이빗 모드 등) saveProgress는 예외를 전파하지 않는다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError')
      },
    })
    expect(() => saveProgress(markSolved(emptyProgress(), 'l1-01'))).not.toThrow()
  })

  it('정상 동작하는 storage 에서는 저장한 그대로 읽힌다', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    })
    const p = markSolved(emptyProgress(), 'l1-01')
    saveProgress(p)
    expect(loadProgress()).toEqual(p)
  })

  it('배열이지만 요소가 숫자면 solved는 빈 배열이다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ solved: [1, 2, 3], hintsUsed: [] }),
    })
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('배열에 문자와 숫자가 섞여 있으면 전체 배열을 버린다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ solved: ['l1-01', 42], hintsUsed: [] }),
    })
    expect(loadProgress()).toEqual(emptyProgress())
  })

  it('solved는 문자 배열이고 hintsUsed는 객체를 포함하면 hintsUsed는 버려진다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ solved: ['l1-01'], hintsUsed: [{}] }),
    })
    expect(loadProgress()).toEqual({ solved: ['l1-01'], hintsUsed: [] })
  })
})
