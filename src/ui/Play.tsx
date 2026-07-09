import { useGame } from './store'
import { Terminal } from './Terminal'
import { HudCard } from './HudCard'
import { RevealSheet } from './RevealSheet'

export function Play() {
  const lines = useGame((s) => s.lines)
  const submit = useGame((s) => s.submit)
  const completions = useGame((s) => s.completions)
  const prompt = useGame((s) => s.prompt())
  const status = useGame((s) => s.status)

  return (
    <>
      <Terminal
        lines={lines}
        prompt={prompt}
        onSubmit={(line) => { void submit(line) }}
        completions={completions}
        disabled={status === 'solved'}
      />
      <HudCard />
      <RevealSheet />
    </>
  )
}
