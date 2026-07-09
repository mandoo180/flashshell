import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

/**
 * `-n` 의 정렬 키는 줄 맨 앞의 숫자만 읽는다 — 줄 전체가 숫자여야 하는 게 아니다.
 * 숫자로 시작하지 않으면 0 취급한다. `Number(line)` 은 전체 문자열이 숫자가
 * 아니면 무조건 NaN 을 주기 때문에("3abc" 도 NaN) 못 쓴다. `parseFloat` 는
 * 앞쪽만 파싱하고 나머지는 무시하므로("3abc" -> 3) GNU의 동작과 맞는다. docker
 * debian:stable-slim coreutils 9.7 로 실측:
 *   `sort -n` on "3abc\nabc3\n2xyz\n" -> "abc3\n2xyz\n3abc" (abc3 은 0)
 *   `sort -n` on "-5\nabc\n3\n-1\n"   -> "-5\n-1\nabc\n3"    (abc 는 0, -1 과 3 사이)
 * 숫자값이 같으면(둘 다 0 인 경우 포함) 바이트 순으로 동점을 가른다 — 입력 순서를
 * 보존하는 안정 정렬이 아니다: "xyz\nabc\n5"와 "abc\nxyz\n5" 둘 다 -n 정렬하면
 * abc 가 xyz 보다 앞선다(입력에서의 순서와 무관).
 */
function numericKey(line: string): number {
  const n = parseFloat(line)
  return Number.isNaN(n) ? 0 : n
}

const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export const sort: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const { sources, stderr, failed } = readSources(e, rest)

  let lines = sources.flatMap((source) => toLines(source.text))

  lines.sort((a, b) => (flags.has('n') ? numericKey(a) - numericKey(b) || byteOrder(a, b) : byteOrder(a, b)))
  if (flags.has('r')) lines.reverse()
  if (flags.has('u')) lines = lines.filter((line, i) => i === 0 || line !== lines[i - 1])

  return { stdout: lines.map((l) => `${l}\n`).join(''), stderr, exitCode: failed ? 2 : 0 }
}
