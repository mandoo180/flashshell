import type { Lang, LocalizedText } from '../game/types'

export const LANG_STORAGE_KEY = 'flashshell.lang.v1'

/** 저장값 > 브라우저 감지 > en. 순수 함수 — 저장소·navigator 는 loadLang 이 주입한다. */
export function detectLang(stored: string | null, navLang: string | undefined): Lang {
  if (stored === 'en' || stored === 'ko') return stored
  return navLang?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function loadLang(): Lang {
  try {
    return detectLang(
      globalThis.localStorage?.getItem(LANG_STORAGE_KEY) ?? null,
      globalThis.navigator?.language,
    )
  } catch {
    // 손상된 저장소나 localStorage 부재가 게임을 막아서는 안 된다. (progress.ts 와 동일 방침)
    return 'en'
  }
}

export function saveLang(lang: Lang): void {
  try {
    globalThis.localStorage?.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // 저장 실패는 조용히 무시 — 이번 세션 동안은 스토어 상태로 유지된다.
  }
}

export function applyDocumentLang(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

/**
 * UI 크롬 사전. 문제 텍스트는 여기 넣지 않는다(문제 정의에 병기).
 * HINT/RESET/SOLVED/NEXT ▸ 등 테마 라벨은 양 언어 공통 영어라 사전 밖이다.
 */
export const STRINGS = {
  levelsSub: {
    en: 'Problems only the command line can solve. Pick a level.',
    ko: '명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.',
  },
  langGroup: { en: 'Language', ko: '언어' },
  prevProblem: { en: 'Previous problem', ko: '이전 문제' },
  nextProblem: { en: 'Next problem', ko: '다음 문제' },
  expandCard: { en: 'Expand problem card', ko: '문제 카드 펼치기' },
  collapseCard: { en: 'Collapse problem card', ko: '문제 카드 접기' },
  explanationDialog: { en: 'Explanation', ko: '해설' },
  sheetSolution: { en: 'SOLUTION', ko: '모범답안' },
  sheetExplanation: { en: 'EXPLANATION', ko: '해설' },
} satisfies Record<string, LocalizedText>

export type StringKey = keyof typeof STRINGS

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[key][lang]
}

/** LOCKED 문구는 문항 수 보간이 필요해 사전이 아니라 함수다. */
export function lockedStatus(lang: Lang, n: number): string {
  return lang === 'ko'
    ? `LOCKED — 이전 레벨 ${n}문제 필요`
    : `LOCKED — solve ${n} in the previous level`
}
