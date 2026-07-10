import type { CommandFn } from '../types'
import { fail } from '../types'
import { BreakSignal, ContinueSignal } from '../errors'

/** `break [n]` / `continue [n]` 의 레벨 인자를 파싱한다. 없으면 1. 양의 정수만 유효. */
function parseLevel(arg: string | undefined): number | null {
  if (arg === undefined) return 1
  if (!/^[0-9]+$/.test(arg)) return null
  const n = parseInt(arg, 10)
  return n >= 1 ? n : null
}

/**
 * break/continue 는 제어-흐름 신호를 던져 가장 가까운 루프(runWhile)가 잡게 한다.
 * 단, 루프 밖(loopDepth < 1)에서는 bash 처럼 경고만 하고 no-op 으로 exit 0 을 준다 —
 * 신호를 던지면 리스트의 나머지가 통째로 unwind 되지만, 실제 bash 는 `break; echo x`
 * 에서 x 를 그대로 출력한다(경고 후 계속). 그래서 여기서 던지지 않고 얌전히 반환한다.
 */
function make(kind: 'break' | 'continue'): CommandFn {
  return (e) => {
    if ((e.loopDepth ?? 0) < 1) {
      // 루프 밖: 경고만 내고 no-op(exit 0). 던지지 않으므로 리스트의 나머지가 계속 돈다.
      return { stdout: '', stderr: `bash: ${kind}: only meaningful in a \`for', \`while', or \`until' loop\n`, exitCode: 0 }
    }
    const level = parseLevel(e.args[0])
    if (level === null) return fail(`bash: ${kind}: ${e.args[0]}: numeric argument required\n`, 2)
    throw kind === 'break' ? new BreakSignal(level) : new ContinueSignal(level)
  }
}

export const breakCmd = make('break')
export const continueCmd = make('continue')
