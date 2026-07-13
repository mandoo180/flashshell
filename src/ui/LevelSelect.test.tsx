import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { App } from './App'
import { useGame, setSessionFactory } from './store'
import { LocalShellSession } from './session'

beforeEach(() => {
  // Play.test.tsx / HudCard.test.tsx 와 동일한 이유: jsdom은 테스트 사이에
  // localStorage를 비우지 않고, jsdom에는 Worker가 없어 기본 팩토리
  // (WorkerShellSession)를 그대로 두면 스토어 구동 시 new Worker(...)가 죽는다.
  localStorage.clear()
  setSessionFactory(() => new LocalShellSession())
  useGame.setState(useGame.getInitialState(), true)
})

describe('LevelSelect: 레벨 6 (자동화) — 문제가 채워졌지만 아직 잠긴 동안', () => {
  it('LEVEL 6 · 자동화 카드가 (COMING SOON 이 아니라) LOCKED 로 표시되고 눌리지 않는다', () => {
    // Task 2에서 l6-01~05가 채워지며 total > 0 이 되어, LevelSelect의 total === 0
    // 가드(COMING SOON)를 벗어난다. 진행도가 비어 레벨 5를 아직 8문제 풀지 못했으므로
    // unlock 규칙상 레벨 6은 잠겨 있고, 상태는 LOCKED 문구로 바뀐다(여전히 disabled).
    render(<App />)

    const level6 = screen.getByRole('button', { name: /LEVEL 6/ })
    expect(within(level6).getByText('자동화')).toBeInTheDocument()
    expect(within(level6).queryByText('COMING SOON')).not.toBeInTheDocument()
    expect(within(level6).getByText(/LOCKED/)).toBeInTheDocument()
    expect(level6).toBeDisabled()
  })
})
