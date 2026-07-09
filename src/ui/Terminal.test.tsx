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

  it('영 후보 Tab은 이전에 표시된 후보 목록을 지운다', async () => {
    const completions = (partial: string) => {
      if (partial === 're') return ['readme.md', 'readme.txt']
      if (partial === 'rezz') return []
      return []
    }
    render(<Terminal lines={[]} prompt="$ " onSubmit={vi.fn()} completions={completions} />)
    const input = screen.getByRole('textbox')

    // 두 개 후보 입력: "cat re" + Tab -> 후보 목록 표시됨
    await userEvent.type(input, 'cat re{Tab}')
    expect(screen.getByText((content) => content.includes('readme.md') && content.includes('readme.txt'))).toBeInTheDocument()

    // 더 입력해서 매칭 없음: "rezz" + Tab -> 후보 목록 사라짐
    await userEvent.type(input, 'zz{Tab}')
    expect(screen.queryByText((content) => content.includes('readme.md') && content.includes('readme.txt'))).not.toBeInTheDocument()
  })

  it('다중 후보 Tab은 후보 목록을 표시하고 공통 접두사만 채운다', async () => {
    const completions = (partial: string) => {
      if (partial === 'rea') return ['readme.md', 'readme.txt']
      return []
    }
    render(<Terminal lines={[]} prompt="$ " onSubmit={vi.fn()} completions={completions} />)
    const input = screen.getByRole('textbox')

    await userEvent.type(input, 'cat rea{Tab}')
    expect(input).toHaveValue('cat readme.')
    expect(screen.getByText((content) => content.includes('readme.md') && content.includes('readme.txt'))).toBeInTheDocument()
  })

  it('Ctrl+C는 현재 줄을 지운다', async () => {
    render(<Terminal lines={[]} prompt="$ " onSubmit={vi.fn()} />)
    const input = screen.getByRole('textbox')

    await userEvent.type(input, 'some command')
    expect(input).toHaveValue('some command')

    await userEvent.keyboard('{Control>}c{/Control}')
    expect(input).toHaveValue('')
  })

  it('Ctrl+L은 clear를 제출한다', async () => {
    const onSubmit = vi.fn()
    render(<Terminal lines={[]} prompt="$ " onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')

    await userEvent.type(input, 'some text')
    await userEvent.keyboard('{Control>}l{/Control}')
    expect(onSubmit).toHaveBeenCalledWith('clear')
  })

  it('히스토리 끝을 넘어 ArrowDown은 입력을 비운다', async () => {
    const onSubmit = vi.fn()
    render(<Terminal lines={[]} prompt="$ " onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')

    // 명령 하나 입력
    await userEvent.type(input, 'echo hi{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('echo hi')

    // 위 화살표로 히스토리에서 가져옴
    await userEvent.type(input, '{ArrowUp}')
    expect(input).toHaveValue('echo hi')

    // 아래 화살표로 히스토리 끝을 넘음
    await userEvent.type(input, '{ArrowDown}')
    expect(input).toHaveValue('')
  })
})
