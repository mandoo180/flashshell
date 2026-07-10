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
  const problemId = useGame((s) => s.problem?.id)

  return (
    <>
      <Terminal
        lines={lines}
        prompt={prompt}
        onSubmit={(line) => { void submit(line) }}
        completions={completions}
        disabled={status === 'solved'}
        problemId={problemId}
      />
      <HudCard />
      <RevealSheet />
    </>
  )
}
