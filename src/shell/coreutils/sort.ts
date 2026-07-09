import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines, isDirectoryError, errnoText } from './shared'

/**
 * `-n` 의 정렬 키는 줄 맨 앞의 숫자만 읽는다 — 줄 전체가 숫자여야 하는 게 아니다.
 * 숫자로 시작하지 않으면 0 취급한다. `Number(line)` 은 전체 문자열이 숫자가
 * 아니면 무조건 NaN 을 주기 때문에("3abc" 도 NaN) 못 쓴다.
 *
 * `parseFloat` 는 한때 여기 쓰였지만 GNU 보다 너그럽다 — 앞에 `+` 를 허용하고
 * 지수표기(`1e3`)도 숫자로 읽는다. GNU sort -n 은 둘 다 안 받는다(task-10 finding 2).
 * docker debian:stable-slim coreutils 9.7 실측:
 *   `printf -- "-3\n+2\nx5\n.5\n1e3\n5x\n10\n" | LC_ALL=C sort -n`
 *     -> "-3\n+2\nx5\n.5\n1e3\n5x\n10\n" (이미 오름차순이었다: -3, 0, 0, 0.5, 1, 5, 10)
 *   parseFloat 였다면 "+2"→2, "1e3"→1000 으로 읽혀 순서가 "-3 x5 .5 +2 5x 10 1e3"
 *   가 된다 — 실측과 다르다.
 * 그래서 키는 정규식으로 직접 뽑는다: 맨 앞 `-` 하나(선택), 그다음 숫자 형태
 * (정수, 소수, 또는 `.5` 처럼 정수부 없는 소수) — `+` 나 `e` 는 문법에 아예 없으므로
 * 매칭 대상이 아니다. 매칭에 실패하면(예: "+2", "x5") 0 취급한다.
 *   `sort -n` on "3abc\nabc3\n2xyz\n" -> "abc3\n2xyz\n3abc" (abc3 은 0)
 *   `sort -n` on "-5\nabc\n3\n-1\n"   -> "-5\n-1\nabc\n3"    (abc 는 0, -1 과 3 사이)
 * 숫자값이 같으면(둘 다 0 인 경우 포함) 바이트 순으로 동점을 가른다(localeCompare
 * 금지) — 입력 순서를 보존하는 안정 정렬이 아니다: "xyz\nabc\n5"와 "abc\nxyz\n5"
 * 둘 다 -n 정렬하면 abc 가 xyz 보다 앞선다(입력에서의 순서와 무관).
 */
const NUMERIC_KEY_RE = /^-?(?:\d+\.\d+|\.\d+|\d+)/

function numericKey(line: string): number {
  const m = NUMERIC_KEY_RE.exec(line)
  if (!m) return 0
  const n = Number(m[0])
  return Number.isNaN(n) ? 0 : n
}

const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * task-10 finding 1: sort 의 "없는 파일" 문구도 cat/wc/grep 과 다르고, exit 코드도
 * 다르다(2, 1이 아님). docker debian:stable-slim coreutils 9.7 실측:
 *   `sort missing.txt` -> "sort: cannot read: missing.txt: No such file or directory" exit=2
 *   `sort /somedir`    -> "sort: read failed: /somedir: Is a directory" exit=2 (문구 틀이 다르다)
 */
function formatSortError(name: string): (file: string, err: unknown) => string {
  return (file, err) =>
    isDirectoryError(err)
      ? `${name}: read failed: ${file}: ${errnoText(err)}`
      : `${name}: cannot read: ${file}: ${errnoText(err)}`
}

export const sort: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const { sources, stderr, failed } = readSources(e, rest, formatSortError(e.name))

  let lines = sources.flatMap((source) => toLines(source.text))

  lines.sort((a, b) => (flags.has('n') ? numericKey(a) - numericKey(b) || byteOrder(a, b) : byteOrder(a, b)))
  if (flags.has('r')) lines.reverse()
  if (flags.has('u')) lines = lines.filter((line, i) => i === 0 || line !== lines[i - 1])

  return { stdout: lines.map((l) => `${l}\n`).join(''), stderr, exitCode: failed ? 2 : 0 }
}
