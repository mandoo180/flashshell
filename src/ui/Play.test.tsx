import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { App } from './App'
import { useGame } from './store'
import type { Progress } from '../game/progress'

const PROGRESS_KEY = 'flashshell.progress.v1'

beforeEach(() => {
  // jsdom 은 테스트 사이에 저장소를 비우지 않는다. 진행도가 누적되면
  // "잠긴 레벨" 테스트가 앞 테스트의 성공 때문에 깨진다.
  localStorage.clear()
  useGame.setState(useGame.getInitialState(), true)
})

describe('한 문제를 끝까지 푼다', () => {
  it('레벨 1을 열고, 문제를 풀고, 해설을 본다', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    expect(screen.getByText('첫 접속')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox'), 'cat readme.txt{Enter}')

    expect(await screen.findByRole('dialog', { name: '해설' })).toBeInTheDocument()
    expect(screen.getByText('[ SOLVED ]')).toBeInTheDocument()
    expect(screen.getByText('cat readme.txt')).toBeInTheDocument()
  })

  it('힌트는 요청해야 나온다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    expect(screen.queryByText(/ls 입니다/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'HINT' }))
    expect(screen.getByText(/ls 입니다/)).toBeInTheDocument()
  })

  it('잠긴 레벨은 누를 수 없다', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /LEVEL 3/ })).toBeDisabled()
  })

  it('HUD 를 접으면 지문이 사라지고 터미널이 드러난다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await userEvent.click(screen.getByRole('button', { name: '문제 카드 접기' }))
    expect(screen.queryByText('첫 접속')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '문제 카드 펼치기' }))
    expect(screen.getByText('첫 접속')).toBeInTheDocument()
  })
})

describe('빈 레벨은 진행도로 열리지 않는다', () => {
  it('레벨 1·2를 8개씩 풀어도 레벨 3은 COMING SOON으로 막혀 있다', async () => {
    // store.ts는 모듈이 처음 평가될 때 `progress: loadProgress()`를 딱 한 번
    // 호출해 이 파일 상단의 `useGame`/`App` 바인딩에 굳혀 넣는다. beforeEach에서
    // localStorage만 채워서는 이미 평가가 끝난 그 스토어 인스턴스에 반영되지
    // 않는다(정적 import는 재평가되지 않는다). 그래서 여기서는
    // localStorage를 먼저 채운 뒤 vi.resetModules()로 모듈 캐시를 비우고
    // App을 동적 import()한다 — 그 안에서 다시 import되는 store.ts가 새로
    // 평가되면서 방금 채운 값을 loadProgress()로 읽어 초기 상태에 반영한다.
    const seeded: Progress = {
      solved: [
        'l1-01', 'l1-02', 'l1-03', 'l1-04', 'l1-05', 'l1-06', 'l1-07', 'l1-08',
        'l2-01', 'l2-02', 'l2-03', 'l2-04', 'l2-05', 'l2-06', 'l2-07', 'l2-08',
      ],
      hintsUsed: [],
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(seeded))

    vi.resetModules()
    const { App: FreshApp } = await import('./App')

    render(<FreshApp />)

    const level1 = screen.getByRole('button', { name: /LEVEL 1/ })
    const level2 = screen.getByRole('button', { name: /LEVEL 2/ })
    const level3 = screen.getByRole('button', { name: /LEVEL 3/ })

    // 세팅이 실제로 반영됐는지: 레벨 1·2는 열려 있어야 한다.
    expect(level1).toBeEnabled()
    expect(level2).toBeEnabled()

    // 레벨 3은 unlock 규칙상으로는 열리지만(레벨 2를 8개 풀었으므로),
    // total === 0 가드가 없으면 플레이어가 문제 없는 레벨에 들어가 크래시한다.
    expect(level3).toBeDisabled()
    expect(within(level3).getByText('COMING SOON')).toBeInTheDocument()
  })
})
