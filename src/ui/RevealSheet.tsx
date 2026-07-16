import { useGame } from './store'
import { useT } from './useT'

export function RevealSheet() {
  const problem = useGame((s) => s.problem)
  const status = useGame((s) => s.status)
  const nextProblem = useGame((s) => s.nextProblem)
  const lang = useGame((s) => s.lang)
  const t = useT()

  if (!problem || status !== 'solved') return null

  return (
    <div className="sheet" role="dialog" aria-label={t('explanationDialog')}>
      <div className="sheet-header">[ SOLVED ]</div>

      <div className="sheet-label">{t('sheetSolution')}</div>
      <pre className="sheet-code">{problem.solution}</pre>

      <div className="sheet-label">{t('sheetExplanation')}</div>
      <p className="sheet-body">{problem.explanation[lang]}</p>

      <button className="sheet-next" onClick={nextProblem} autoFocus>NEXT ▸</button>
    </div>
  )
}
