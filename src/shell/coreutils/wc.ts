import type { CommandFn } from '../types'
import { parseFlags, readSources, byteLength } from './shared'

/** 파이프에서 읽을 때 GNU wc 가 쓰는 고정 폭. 미리 크기를 알 수 없기 때문이다. */
const UNKNOWN_SIZE_WIDTH = 7

/**
 * 줄 수는 "개행 문자의 개수"다 — toLines() 가 반환하는 배열의 길이가 아니다.
 * toLines() 는 화면에 낼 줄 목록을 만들려고 후행 개행 하나를 무시하고 쪼개므로,
 * 후행 개행이 없는 파일에서 실제 개행 수보다 하나 많게 나온다. docker
 * debian:stable-slim coreutils 9.7 로 확인: `printf 'a' | wc -l` -> 0 인데
 * toLines('a').length 는 1 이다. `printf 'a\nb'`(개행 1개)도 toLines 로 세면
 * 2 가 나와 틀린다.
 */
function countLines(text: string): number {
  return text.split('\n').length - 1
}

export const wc: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const { sources, stderr, failed } = readSources(e, rest)

  // 플래그가 하나도 없으면 -l -w -c 전부.
  const wantLines = flags.has('l') || flags.size === 0
  const wantWords = flags.has('w') || flags.size === 0
  const wantBytes = flags.has('c') || flags.size === 0
  const counterCount = [wantLines, wantWords, wantBytes].filter(Boolean).length

  const rows = sources.map((source) => ({
    label: source.label,
    lines: countLines(source.text),
    words: source.text.split(/\s+/).filter((w) => w !== '').length,
    bytes: byteLength(source.text),
  }))

  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const sizeKnown = rest.length > 0 || e.stdinFromFile

  /*
   * "여러 파일" 여부와 폭 계산은 성공적으로 읽힌 소스 개수(rows.length)가 아니라
   * 요청한 파일 인자 개수(rest.length)로 판단한다. docker로 확인:
   * `wc -l missing.txt a.txt` -> " 3 a.txt\n 3 total\n" (exit 1) — missing.txt 가
   * 읽기에 실패해 rows 에는 a.txt 하나만 들어가지만, 요청한 인자가 둘이었으므로
   * total 줄이 나오고 폭도 "여러 입력" 규칙(총 바이트 자릿수)을 따른다.
   * `wc missing1.txt missing2.txt`(둘 다 없음) -> "0 0 0 total\n" — rows 가 아예
   * 비어도 total 은 나온다.
   */
  const multiFile = rest.length > 1

  /*
   * GNU wc 의 폭 규칙. debian:stable-slim 에서 실측했다.
   *   카운터 1개 + 입력 1개(요청 기준) → 폭 1 (패딩 없음)      `wc -l f`   → "3 f"
   *   그 외 + 크기를 앎      → 폭 = 자릿수(총 바이트)  `wc f`      → " 3  3 14 f"
   *   그 외 + 크기를 모름    → 폭 7                   `cat f | wc` → "      3 …"
   */
  const width =
    counterCount === 1 && !multiFile
      ? 1
      : sizeKnown
        ? Math.max(1, String(totalBytes).length)
        : UNKNOWN_SIZE_WIDTH

  const format = (lines: number, words: number, bytes: number, label: string): string => {
    const fields: number[] = []
    if (wantLines) fields.push(lines)
    if (wantWords) fields.push(words)
    if (wantBytes) fields.push(bytes)
    const row = fields.map((n) => String(n).padStart(width)).join(' ')
    return `${row}${label ? ` ${label}` : ''}\n`
  }

  let stdout = ''
  for (const row of rows) stdout += format(row.lines, row.words, row.bytes, row.label)

  if (multiFile) {
    stdout += format(
      rows.reduce((sum, row) => sum + row.lines, 0),
      rows.reduce((sum, row) => sum + row.words, 0),
      totalBytes,
      'total',
    )
  }

  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
