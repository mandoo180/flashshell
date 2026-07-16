import { useGame } from './store'
import { useT } from './useT'

/** [EN|KO] 토글. 전환은 스토어 lang 만 바꾼다 — 셸 세션·워커·진행도 무접촉. */
export function LangToggle({ className }: { className?: string }) {
  const lang = useGame((s) => s.lang)
  const setLang = useGame((s) => s.setLang)
  const t = useT()
  return (
    <div className={className ? `lang-toggle ${className}` : 'lang-toggle'} role="group" aria-label={t('langGroup')}>
      <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
      <button aria-pressed={lang === 'ko'} onClick={() => setLang('ko')}>KO</button>
    </div>
  )
}
