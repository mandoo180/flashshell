import type { CommandFn } from '../types'
import { parseFlags, readSources } from './shared'

/**
 * GNU cat -n 은 "파일별 논리적 줄 목록"이 아니라 이어붙인 원문 바이트 스트림을 그대로
 * 훑으면서, 개행 문자 직후(그리고 맨 처음)에만 번호를 새로 매긴다. 그래서:
 *  - 어떤 파일이 마지막 개행 없이 끝나면 출력도 마지막 개행 없이 끝난다.
 *  - 그 파일 뒤에 또 다른 파일이 이어지면, 그 파일의 첫 줄이 앞 파일의 마지막 줄과
 *    번호 없이 그대로 이어붙는다(개행이 없으니 "새 줄의 시작"이 아니다).
 * docker debian:stable-slim bash 5.2.37 / coreutils 로 확인:
 *   printf "a\nb" > f1; printf "c\nd\n" > f2; cat -n f1 f2
 *     →  "     1\ta\n     2\tbc\n     3\td\n"
 * toLines() 로 파일마다 독립적으로 줄을 쪼개면 이 이어붙음을 재현할 수 없으므로,
 * 여기서는 원문을 그대로 이어붙인 뒤 문자 단위로 훑는다.
 */
function numberLines(combined: string): string {
  let out = ''
  let atLineStart = true
  let lineNumber = 1
  for (const ch of combined) {
    if (atLineStart) {
      out += `${String(lineNumber++).padStart(6)}\t`
      atLineStart = false
    }
    out += ch
    if (ch === '\n') atLineStart = true
  }
  return out
}

export const cat: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const { sources, stderr, failed } = readSources(e, rest)

  const combined = sources.map((s) => s.text).join('')
  const stdout = flags.has('n') ? numberLines(combined) : combined

  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
