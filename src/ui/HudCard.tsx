import { useEffect, useState } from 'react'
import { useGame } from './store'
import { allProblems } from '../game/problems/index'
import { levelProblems, frontierIndex } from '../game/progress'

const DIFFICULTY_SLOTS = 6
const DIFFICULTY = Array.from(
  { length: DIFFICULTY_SLOTS },
  (_, i) => '◆'.repeat(i + 1) + '◇'.repeat(DIFFICULTY_SLOTS - (i + 1)),
)

export function HudCard() {
  const problem = useGame((s) => s.problem)
  const hintsShown = useGame((s) => s.hintsShown)
  const revealHint = useGame((s) => s.revealHint)
  const backToLevels = useGame((s) => s.backToLevels)
  const progress = useGame((s) => s.progress)
  const solvedCount = progress.solved.length
  const prevProblem = useGame((s) => s.prevProblem)
  const nextProblemNav = useGame((s) => s.nextProblemNav)
  const resetProblem = useGame((s) => s.resetProblem)
  const [collapsed, setCollapsed] = useState(false)
  // useRef 대신 useState 로 DOM 노드를 들고 있는다: `!problem` 이면 이 컴포넌트는
  // null 을 렌더하므로 콜백 ref 가 어느 시점에 노드를 얻고 잃는지 React 가
  // 알아서 알려줘야 한다(마운트/언마운트를 오갈 때마다 effect 를 다시 걸기
  // 위함). useRef 로는 값이 바뀌어도 리렌더/effect 재실행을 못 일으킨다.
  const [hudEl, setHudEl] = useState<HTMLDivElement | null>(null)

  // HUD 는 절대 위치(position: absolute)에 높이가 가변(힌트를 펼치면 자란다).
  // `.terminal` 은 이 높이를 CSS 변수 `--hud-height` 로 읽어서 padding-top 을
  // 맞춘다(theme.css 참고). hud 가 자랄 때마다(ResizeObserver) 실제 렌더된 위치를
  // 재서 :root 에 써준다 — .terminal 과 .hud 는 형제(둘 다 Play.tsx 아래)라 :root 에
  // 쓰면 상속으로 어디서든 보인다.
  useEffect(() => {
    if (!hudEl || typeof ResizeObserver === 'undefined') return

    const measure = () => {
      // hud 는 위치 기준 조상(.crt)에 대해 position:absolute; top:1rem.
      // offsetTop(기준 조상 안에서의 위 오프셋) + getBoundingClientRect().height
      // (border 포함 실제 렌더 높이, 소수점까지) = hud 하단의 y좌표 = .terminal 이
      // 비워야 할 padding-top 이다. offsetHeight는 정수로 반올림되는데, 하단이
      // 소수점(예: 275.296875)일 때 반올림이 내려가면 padding이 실제 하단보다
      // 작아져 다음 문제(6칸 난이도 등 폭이 조금만 바뀌어도)에서 다시 겹칠 수 있다
      // — rect.height로 소수점을 보존하고 Math.ceil로 올림해 padding이 항상 실제
      // 하단 이상이 되도록 보장한다. 실제 렌더된 픽셀을 재므로 rem·루트 글꼴
      // 크기가 바뀌어도(접근성 텍스트 확대) 자동으로 따라간다 — px 상수로
      // 보정하지 않는다.
      const height = Math.ceil(hudEl.offsetTop + hudEl.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--hud-height', `${height}px`)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(hudEl)

    return () => observer.disconnect()
  }, [hudEl])

  if (!problem) return null
  const hasMoreHints = hintsShown < problem.hints.length

  // 이전/다음 버튼의 활성 범위는 "현재 레벨 안에서의 위치"로 결정된다 —
  // 레벨을 넘나드는 이동은 스펙 밖(레벨 선택 화면에서만 가능)이라 계산도
  // levelProblems로 좁힌 리스트 안에서만 한다. 두 함수 모두 순수·저비용이라
  // 렌더마다 다시 불러도 된다(문제 목록은 정적, progress만 리렌더 트리거).
  const siblings = levelProblems(problem.level, allProblems)
  const index = siblings.findIndex((p) => p.id === problem.id)
  const frontier = frontierIndex(problem.level, progress, allProblems)
  const isSolved = progress.solved.includes(problem.id)

  return (
    <div ref={setHudEl} className={`hud${collapsed ? ' hud-collapsed' : ''}`}>
      <div className="hud-meta">
        <span className="hud-diff">{DIFFICULTY[problem.level - 1]} LEVEL {problem.level} · {index + 1}/{siblings.length}</span>
        {isSolved && <span className="hud-solved">✓ SOLVED</span>}
        <span className="hud-count">{solvedCount}/{allProblems.length} SOLVED</span>
        <button
          className="hud-nav"
          aria-label="이전 문제"
          disabled={index <= 0}
          onClick={() => { void prevProblem() }}
        >
          ◂
        </button>
        <button
          className="hud-nav"
          aria-label="다음 문제"
          disabled={index >= frontier}
          onClick={() => { void nextProblemNav() }}
        >
          ▸
        </button>
        <button className="hud-nav" onClick={() => { void resetProblem() }}>RESET</button>
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
