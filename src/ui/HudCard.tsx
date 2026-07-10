import { useEffect, useState } from 'react'
import { useGame } from './store'
import { allProblems } from '../game/problems/index'

const DIFFICULTY = ['◆◇◇◇◇', '◆◆◇◇◇', '◆◆◆◇◇', '◆◆◆◆◇', '◆◆◆◆◆']

// theme.css `.hud { top: 1rem; padding: 0.9rem 1.1rem; border: 1px solid ... }`와
// 짝을 이루는 상수. ResizeObserver 가 주는 contentRect 는 padding/border를 뺀
// "콘텐츠" 높이만 담고 있어서, hud가 실제로 화면에서 차지하는 하단 위치
// (top 오프셋 + 위아래 padding + 위아래 border)를 여기서 더해줘야 `.terminal`이
// 비워야 할 공간과 정확히 맞는다. theme.css 의 `.hud` 박스 모델이 바뀌면 이 값도
// 같이 맞출 것 — 접힌 상태(.hud-collapsed)는 padding-bottom이 조금 작아지지만,
// 여기서 과대추정하는 쪽(여유 공백이 조금 더 생기는 쪽)이라 안전하다.
const HUD_TOP_OFFSET_PX = 16 // top: 1rem
const HUD_VERTICAL_PADDING_PX = 2 * 0.9 * 16 // padding: 0.9rem 위 + 아래
const HUD_VERTICAL_BORDER_PX = 2 * 1 // border: 1px 위 + 아래
// 테스트(HudCard.test.tsx)가 기대값을 독립적으로 다시 손으로 계산해 값이
// 새는 것을 막기 위해 export 한다.
export const HUD_CHROME_PX = HUD_TOP_OFFSET_PX + HUD_VERTICAL_PADDING_PX + HUD_VERTICAL_BORDER_PX

export function HudCard() {
  const problem = useGame((s) => s.problem)
  const hintsShown = useGame((s) => s.hintsShown)
  const revealHint = useGame((s) => s.revealHint)
  const backToLevels = useGame((s) => s.backToLevels)
  const solvedCount = useGame((s) => s.progress.solved.length)
  const [collapsed, setCollapsed] = useState(false)
  // useRef 대신 useState 로 DOM 노드를 들고 있는다: `!problem` 이면 이 컴포넌트는
  // null 을 렌더하므로 콜백 ref 가 어느 시점에 노드를 얻고 잃는지 React 가
  // 알아서 알려줘야 한다(마운트/언마운트를 오갈 때마다 effect 를 다시 걸기
  // 위함). useRef 로는 값이 바뀌어도 리렌더/effect 재실행을 못 일으킨다.
  const [hudEl, setHudEl] = useState<HTMLDivElement | null>(null)

  // HUD 는 절대 위치(position: absolute)에 높이가 가변(힌트를 펼치면 자란다).
  // `.terminal` 은 이 높이를 CSS 변수 `--hud-height` 로 읽어서 padding-top 을
  // 맞춘다(theme.css 참고). ResizeObserver 로 hud 노드의 실제 렌더 높이를 재서
  // :root 에 써준다 — .terminal 과 .hud 는 형제(둘 다 Play.tsx 아래)라 :root 에
  // 쓰면 상속으로 어디서든 보인다.
  useEffect(() => {
    if (!hudEl || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const height = entry.contentRect.height + HUD_CHROME_PX
      document.documentElement.style.setProperty('--hud-height', `${height}px`)
    })
    observer.observe(hudEl)

    return () => observer.disconnect()
  }, [hudEl])

  if (!problem) return null
  const hasMoreHints = hintsShown < problem.hints.length

  return (
    <div ref={setHudEl} className={`hud${collapsed ? ' hud-collapsed' : ''}`}>
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
