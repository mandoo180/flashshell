import { useGame } from './store'
import { allProblems } from '../game/problems/index'
import { isLevelUnlocked, solvedInLevel, UNLOCK_THRESHOLD } from '../game/progress'
import type { Level } from '../game/types'

const LEVELS: { level: Level; name: string; topic: string }[] = [
  { level: 1, name: '탐색', topic: 'ls · cd · cat · head · tail' },
  { level: 2, name: '조작', topic: 'cp · mv · mkdir · 리다이렉션' },
  { level: 3, name: '텍스트 처리', topic: 'grep · sed · awk · 파이프' },
  { level: 4, name: '시스템', topic: 'find · xargs · chmod' },
  { level: 5, name: '스크립팅', topic: 'if · for · while · 함수' },
  { level: 6, name: '자동화', topic: '배열 · read · 스크립트' },
]

export function LevelSelect() {
  const progress = useGame((s) => s.progress)
  const openLevel = useGame((s) => s.openLevel)

  return (
    <div className="levels">
      <h1 className="levels-title">FLASHSHELL</h1>
      <p className="levels-sub">명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.</p>

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
                <span className="level-name">{name}</span>
                <span className="level-topic">{topic}</span>
                <span className="level-status">
                  {total === 0
                    ? 'COMING SOON'
                    : unlocked
                      ? `${solved}/${total}`
                      : `LOCKED — 이전 레벨 ${UNLOCK_THRESHOLD}문제 필요`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
