import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface TermLine { text: string; tone: 'green' | 'amber' | 'dim' }

export interface TerminalProps {
  lines: TermLine[]
  prompt: string
  onSubmit(line: string): void
  completions?(partial: string): string[]
  disabled?: boolean
  /**
   * 현재 문제의 id. NEXT로 다음 문제로 넘어가는 것은 스토어만 바꿀 뿐
   * Terminal을 리마운트하지 않으므로(autoFocus는 마운트 시 한 번만 발화),
   * 이 값이 바뀔 때마다 아래 useEffect가 입력에 포커스를 되돌린다.
   */
  problemId?: string
}

function commonPrefix(items: string[]): string {
  if (items.length === 0) return ''
  let prefix = items[0]!
  for (const item of items.slice(1)) {
    while (!item.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return prefix
}

export function Terminal({ lines, prompt, onSubmit, completions, disabled, problemId }: TerminalProps) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState(-1) // -1 = 히스토리 바깥, 편집 중
  const [extra, setExtra] = useState<TermLine[]>([]) // Tab이 뿌린 후보 목록
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView() }, [lines, extra])

  // NEXT로 다음 문제를 불러오는 것은 스토어 상태만 바꾸고 Terminal을
  // 리마운트하지 않는다 — autoFocus는 최초 마운트 때 한 번만 발화하므로
  // 그 뒤로는 이 useEffect가 문제 id가 바뀔 때마다 포커스를 되돌린다.
  // startProblem은 status: 'playing'과 새 problem.id를 같은 set() 호출로
  // 반영하므로, 이 effect가 실행되는 시점엔 input의 disabled가 이미
  // 풀려 있다(비활성 상태에서 focus()를 부르면 조용히 no-op이 된다).
  useEffect(() => { inputRef.current?.focus() }, [problemId])

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const line = value
      setHistory((h) => (line.trim() ? [...h, line] : h))
      setCursor(-1)
      setValue('')
      setExtra([])
      onSubmit(line)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const next = cursor === -1 ? history.length - 1 : Math.max(0, cursor - 1)
      setCursor(next)
      setValue(history[next]!)
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (cursor === -1) return
      const next = cursor + 1
      if (next >= history.length) { setCursor(-1); setValue('') }
      else { setCursor(next); setValue(history[next]!) }
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (!completions) return
      const lastSpace = value.lastIndexOf(' ')
      const head = value.slice(0, lastSpace + 1)
      const partial = value.slice(lastSpace + 1)
      const candidates = completions(partial)
      if (candidates.length === 0) { setExtra([]); return }
      const filled = commonPrefix(candidates)
      setValue(head + filled)
      setExtra(candidates.length > 1 ? [{ text: candidates.join('  '), tone: 'dim' }] : [])
      return
    }

    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault()
      setValue('')
      setCursor(-1)
      setExtra([])
      return
    }

    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      onSubmit('clear')
      return
    }
  }

  return (
    <div className="terminal" onClick={() => inputRef.current?.focus()}>
      {lines.map((l, i) => (
        <div key={i} className={`term-line tone-${l.tone}`}>{l.text}</div>
      ))}
      {extra.map((l, i) => (
        <div key={`x${i}`} className={`term-line tone-${l.tone}`}>{l.text}</div>
      ))}
      <div className="term-inputline">
        <span className="term-prompt">{prompt}</span>
        <input
          ref={inputRef}
          className="term-input"
          role="textbox"
          value={value}
          disabled={disabled}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
        />
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
