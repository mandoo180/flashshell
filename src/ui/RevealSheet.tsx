import { useGame } from './store'

export function RevealSheet() {
  const problem = useGame((s) => s.problem)
  const status = useGame((s) => s.status)
  const nextProblem = useGame((s) => s.nextProblem)

  if (!problem || status !== 'solved') return null

  return (
    <div className="sheet" role="dialog" aria-label="해설">
      <div className="sheet-header">[ SOLVED ]</div>

      <div className="sheet-label">모범답안</div>
      <pre className="sheet-code">{problem.solution}</pre>

      <div className="sheet-label">해설</div>
      <p className="sheet-body">{problem.explanation}</p>

      <button className="sheet-next" onClick={nextProblem} autoFocus>NEXT ▸</button>
    </div>
  )
}
