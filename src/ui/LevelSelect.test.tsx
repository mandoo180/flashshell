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

describe('LevelSelect: 레벨 6 (자동화) — 문제가 아직 없는 동안', () => {
  it('LEVEL 6 · 자동화 카드가 COMING SOON으로 표시되고 눌리지 않는다', () => {
    render(<App />)

    const level6 = screen.getByRole('button', { name: /LEVEL 6/ })
    expect(within(level6).getByText('자동화')).toBeInTheDocument()
    expect(within(level6).getByText('COMING SOON')).toBeInTheDocument()
    expect(level6).toBeDisabled()
  })
})
