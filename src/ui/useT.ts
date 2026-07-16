import { useGame } from './store'
import { t, type StringKey } from './i18n'

/**
 * UI 크롬 문자열용 훅. 스토어의 lang 을 구독하므로 토글 시 사용처가 리렌더된다.
 * i18n.ts 는 스토어를 모른다(순수) — 순환 import 를 피하려고 훅만 분리했다.
 * 문제 텍스트는 이 훅이 아니라 `problem.title[lang]` 처럼 직접 인덱싱한다.
 */
export function useT(): (key: StringKey) => string {
  const lang = useGame((s) => s.lang)
  return (key) => t(lang, key)
}
