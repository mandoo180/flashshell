import { useGame } from './store'
import { allProblems } from '../game/problems/index'
import { isLevelUnlocked, solvedInLevel, UNLOCK_THRESHOLD } from '../game/progress'
import type { Level, LocalizedText } from '../game/types'
import { lockedStatus } from './i18n'
import { useT } from './useT'
import { LangToggle } from './LangToggle'

const LEVELS: { level: Level; name: LocalizedText; topic: LocalizedText }[] = [
  { level: 1, name: { en: 'Exploration', ko: '탐색' }, topic: { en: 'ls · cd · cat · head · tail', ko: 'ls · cd · cat · head · tail' } },
  { level: 2, name: { en: 'Manipulation', ko: '조작' }, topic: { en: 'cp · mv · mkdir · redirection', ko: 'cp · mv · mkdir · 리다이렉션' } },
  { level: 3, name: { en: 'Text Processing', ko: '텍스트 처리' }, topic: { en: 'grep · sed · awk · pipes', ko: 'grep · sed · awk · 파이프' } },
  { level: 4, name: { en: 'System', ko: '시스템' }, topic: { en: 'find · xargs · chmod', ko: 'find · xargs · chmod' } },
  { level: 5, name: { en: 'Scripting', ko: '스크립팅' }, topic: { en: 'if · for · while · functions', ko: 'if · for · while · 함수' } },
  { level: 6, name: { en: 'Automation', ko: '자동화' }, topic: { en: 'arrays · read · scripts', ko: '배열 · read · 스크립트' } },
]

export function LevelSelect() {
  const progress = useGame((s) => s.progress)
  const openLevel = useGame((s) => s.openLevel)
  const lang = useGame((s) => s.lang)
  const t = useT()

  return (
    <div className="levels">
      <LangToggle className="lang-toggle-levels" />
      <h1 className="levels-title">FLASHSHELL</h1>
      <p className="levels-sub">{t('levelsSub')}</p>

      <ul className="levels-list">
        {LEVELS.map(({ level, name, topic }) => {
          const total = allProblems.filter((p) => p.level === level).length
          const unlocked = total > 0 && isLevelUnlocked(level, progress, allProblems)
          const solved = solvedInLevel(progress, level, allProblems)

          return (
            <li key={level}>
              <button
                className={`level ${unlocked ? '' : 'level-locked'}`}
                disabled={!unlocked}
                onClick={() => openLevel(level)}
              >
                <span className="level-num">LEVEL {level}</span>
                <span className="level-name">{name[lang]}</span>
                <span className="level-topic">{topic[lang]}</span>
                <span className="level-status">
                  {total === 0
                    ? 'COMING SOON'
                    : unlocked
                      ? `${solved}/${total}`
                      : lockedStatus(lang, UNLOCK_THRESHOLD)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
