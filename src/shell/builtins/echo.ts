import type { CommandFn } from '../types'
import { ok } from '../types'

/**
 * `\n`, `\t`, `\\` 를 해석한다. 세 개의 개별 .replace() 를 순서대로 체이닝하면
 * 안 된다: 어느 쪽을 먼저 해도 `\\n` 처럼 겹치는 입력에서 틀린 답이 나온다
 * (예: 원문 `a\\nb` — 백슬래시 두 개 다음 n — 은 bash에서 `\\` 를 백슬래시 하나로
 * 줄인 뒤 남은 `n`을 그냥 문자로 취급해 "a\nb"(리터럴 백슬래시)를 낸다. `\n`을
 * 먼저 치환하면 두 백슬래시 중 하나가 `n`과 잘못 묶여 개행이 되어버린다).
 * 대신 하나의 정규식으로 왼쪽에서 오른쪽으로 한 번만 훑으면서, 각 위치에서
 * `\\` 를 `\n`/`\t` 보다 먼저 시도한다 — 매치된 문자는 소비되어 다음 매치와
 * 겹치지 않으므로 순서 문제가 근본적으로 사라진다.
 */
function unescape(text: string): string {
  return text.replace(/\\\\|\\n|\\t/g, (m) => {
    if (m === '\\\\') return '\\'
    if (m === '\\n') return '\n'
    return '\t'
  })
}

/**
 * bash의 echo 빌트인은 `-n`/`-e`/`-ne`/`-en`처럼 n과 e로만 이루어진 결합 플래그도
 * 받는다 (`-nx` 처럼 다른 문자가 섞이면 플래그가 아니라 그냥 데이터다). `-` 하나만
 * 있으면 플래그가 아니라 데이터다.
 */
function isFlagWord(arg: string | undefined): arg is string {
  if (arg === undefined || arg.length < 2 || arg[0] !== '-') return false
  return [...arg.slice(1)].every((c) => c === 'n' || c === 'e')
}

export const echo: CommandFn = ({ args }) => {
  let noNewline = false
  let interpret = false
  let i = 0
  // 플래그는 맨 앞에 연속으로 있을 때만 플래그다. 데이터가 한 번 나오면 그 뒤의
  // `-n`은 더 이상 옵션으로 취급하지 않는다 (bash도 그렇다).
  while (isFlagWord(args[i])) {
    for (const c of args[i]!.slice(1)) {
      if (c === 'n') noNewline = true
      else interpret = true
    }
    i++
  }
  const body = args.slice(i).join(' ')
  const text = interpret ? unescape(body) : body
  return ok(noNewline ? text : `${text}\n`)
}
