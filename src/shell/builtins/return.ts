import type { CommandFn } from '../types'
import { fail } from '../types'
import { ReturnSignal } from '../errors'

/**
 * `return [N]` 의 코드 인자를 파싱한다. 없으면 fallback(함수 본문에서 마지막으로 실행된
 * 명령의 exit code). 음수도 허용한다 — bash 는 `return -1` 을 255 로 감싼다(호출부에서
 * mod 256). 숫자가 아니면 null.
 */
function parseCode(arg: string | undefined, fallback: number): number | null {
  if (arg === undefined) return fallback
  if (!/^-?[0-9]+$/.test(arg)) return null
  return parseInt(arg, 10)
}

/** exit code 를 bash 처럼 0..255 로 감싼다 (`return 300` → 44, `return -1` → 255). */
function wrap(n: number): number {
  return ((n % 256) + 256) % 256
}

/**
 * `return [N]` 은 ReturnSignal 을 던져 가장 가까운 함수 호출(callFunction)이 잡게 한다 —
 * break/continue 가 루프까지 신호를 던지는 것과 완전히 같은 패턴이다. 인자가 없으면 함수
 * 본문에서 마지막으로 실행된 명령의 exit code(state.lastExitCode)를 코드로 쓴다.
 *
 * 함수(또는 소스된 스크립트) 밖에서는(funcDepth < 1) bash 처럼 신호를 던지지 않고 경고만
 * 내고 exit 2 로 no-op 한다 — docker 확인: `return 5; echo after` → 경고(stderr) 후
 * `after` 가 그대로 출력되고, 격리된 `return 5` 단독은 exit 2. 던졌다면 리스트의 나머지가
 * 통째로 unwind 되어 `after` 가 사라졌을 것이다(break-밖-루프와 동일한 이유).
 */
export const returnCmd: CommandFn = (e) => {
  if ((e.funcDepth ?? 0) < 1) {
    return fail(`bash: return: can only \`return' from a function or sourced script\n`, 2)
  }
  const parsed = parseCode(e.args[0], e.state.lastExitCode)
  if (parsed === null) {
    // 잘못된 숫자 인자: bash 는 에러 후 exit 2 로 함수를 벗어난다. 에러 문구는 신호에 실어
    // 나른다 — 함수 경계가 ReturnSignal 을 ExecResult(exit 2)로 바꾸며 그 stderr 를 낸다.
    const sig = new ReturnSignal(2)
    sig.stderr = `bash: return: ${e.args[0]}: numeric argument required\n`
    throw sig
  }
  throw new ReturnSignal(wrap(parsed))
}
