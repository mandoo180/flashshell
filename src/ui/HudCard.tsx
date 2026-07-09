import { useState } from 'react'
import { useGame } from './store'
import { allProblems } from '../game/problems/index'

const DIFFICULTY = ['◆◇◇◇◇', '◆◆◇◇◇', '◆◆◆◇◇', '◆◆◆◆◇', '◆◆◆◆◆']

export function HudCard() {
  const problem = useGame((s) => s.problem)
  const hintsShown = useGame((s) => s.hintsShown)
  const revealHint = useGame((s) => s.revealHint)
  const backToLevels = useGame((s) => s.backToLevels)
  const solvedCount = useGame((s) => s.progress.solved.length)
  const [collapsed, setCollapsed] = useState(false)

  if (!problem) return null
  const hasMoreHints = hintsShown < problem.hints.length

  return (
    <div className={`hud${collapsed ? ' hud-collapsed' : ''}`}>
      <div className="hud-meta">
        <span className="hud-diff">{DIFFICULTY[problem.level - 1]} LEVEL {problem.level}</span>
        <span className="hud-count">{solvedCount}/{allProblems.length} SOLVED</span>
        <button
          className="hud-fold"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '문제 카드 펼치기' : '문제 카드 접기'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▼' : '▲'}
        </button>
        <button className="hud-exit" onClick={backToLevels}>← LEVELS</button>
      </div>

      {!collapsed && (
        <>
          <h2 className="hud-title">{problem.title}</h2>
          <p className="hud-prompt">{problem.prompt}</p>

          {problem.hints.slice(0, hintsShown).map((hint, i) => (
            <p key={i} className="hud-hint">▸ {hint}</p>
          ))}

          {hasMoreHints && (
            <button className="hud-hint-button" onClick={revealHint}>
              {hintsShown === 0 ? 'HINT' : `HINT ${hintsShown + 1}/${problem.hints.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
