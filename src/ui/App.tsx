import { useState } from 'react'
import { Crt } from './Crt'
import { Terminal, type TermLine } from './Terminal'

export function App() {
  const [lines, setLines] = useState<TermLine[]>([
    { text: 'FlashShell v0 — 아직 셸이 없습니다. 입력을 되뱉습니다.', tone: 'dim' },
  ])

  function handleSubmit(line: string) {
    setLines((prev) => [
      ...prev,
      { text: `player@flashshell:~$ ${line}`, tone: 'dim' },
      { text: line, tone: 'green' },
    ])
  }

  return (
    <Crt>
      <Terminal lines={lines} prompt="player@flashshell:~$ " onSubmit={handleSubmit} />
    </Crt>
  )
}
