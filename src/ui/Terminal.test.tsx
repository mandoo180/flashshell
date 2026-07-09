import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Terminal } from './Terminal'

describe('Terminal', () => {
  it('엔터를 치면 입력한 줄로 onSubmit을 부른다', async () => {
    const onSubmit = vi.fn()
    render(<Terminal lines={[]} prompt="$ " onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('textbox'), 'ls -a{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('ls -a')
  })

  it('위 화살표로 직전 명령을 되살린다', async () => {
    const onSubmit = vi.fn()
    render(<Terminal lines={[]} prompt="$ " onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'echo hi{Enter}')
    await userEvent.type(input, '{ArrowUp}')
    expect(input).toHaveValue('echo hi')
  })

  it('Tab을 누르면 유일한 후보로 완성한다', async () => {
    render(<Terminal lines={[]} prompt="$ " onSubmit={vi.fn()} completions={() => ['readme.md']} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'cat rea{Tab}')
    expect(input).toHaveValue('cat readme.md')
  })

  it('출력 줄을 tone에 따라 다른 클래스로 그린다', () => {
    render(<Terminal lines={[{ text: 'oops', tone: 'amber' }]} prompt="$ " onSubmit={vi.fn()} />)
    expect(screen.getByText('oops')).toHaveClass('tone-amber')
  })
})
