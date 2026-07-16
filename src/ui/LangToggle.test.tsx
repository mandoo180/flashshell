import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelSelect } from './LevelSelect'
import { useGame } from './store'

beforeEach(() => {
  localStorage.clear()
  useGame.setState({ lang: 'ko' })
})

describe('LangToggle: EN/KO 전환', () => {
  it('EN 클릭 → 크롬이 영어로 바뀌고, 저장·<html lang> 이 갱신된다', async () => {
    render(<LevelSelect />)
    expect(screen.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'EN' }))

    expect(screen.getByText('Problems only the command line can solve. Pick a level.')).toBeInTheDocument()
    expect(screen.getByText('Exploration')).toBeInTheDocument()
    expect(screen.getAllByText('LOCKED — solve 8 in the previous level').length).toBeGreaterThan(0)
    expect(localStorage.getItem('flashshell.lang.v1')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('KO 로 되돌리면 한국어 크롬으로 복귀한다', async () => {
    render(<LevelSelect />)
    await userEvent.click(screen.getByRole('button', { name: 'EN' }))
    await userEvent.click(screen.getByRole('button', { name: 'KO' }))
    expect(screen.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeInTheDocument()
    expect(screen.getByText('탐색')).toBeInTheDocument()
    expect(localStorage.getItem('flashshell.lang.v1')).toBe('ko')
  })
})
