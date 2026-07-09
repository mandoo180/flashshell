import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { App } from './App'
import { useGame } from './store'

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
