//
// 서브셋: -f LIST [-d DELIM] (필드, 기본 구분자 TAB), -c LIST (문자), -s.
// LIST 항목: N | N-M | N- | -M. -b(바이트)는 미지원.
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

/** "1,3-5,7-" 을 (1-based, inclusive) 범위 목록으로 파싱. 열린 끝은 Infinity. */
function parseList(spec: string): { start: number; end: number }[] | null {
  const ranges: { start: number; end: number }[] = []
  for (const part of spec.split(',')) {
    if (part === '') return null
    const m = /^(\d*)-(\d*)$/.exec(part)
    if (m) {
      const start = m[1] === '' ? 1 : Number(m[1])
      const end = m[2] === '' ? Infinity : Number(m[2])
      if (start < 1 || end < start) return null
      ranges.push({ start, end })
    } else if (/^\d+$/.test(part)) {
      const n = Number(part)
      if (n < 1) return null
      ranges.push({ start: n, end: n })
    } else {
      return null
    }
  }
  return ranges
}

function inRanges(n: number, ranges: { start: number; end: number }[]): boolean {
  return ranges.some((r) => n >= r.start && n <= r.end)
}

export const cut: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args, ['f', 'c', 'd'])
  const delim = flags.get('d') ?? '\t'
  const suppress = flags.has('s')

  const spec = flags.get('f') ?? flags.get('c')
  if (spec === undefined) {
    return { stdout: '', stderr: 'cut: you must specify a list of bytes, characters, or fields\n', exitCode: 1 }
  }
  const ranges = parseList(spec)
  if (ranges === null) {
    return { stdout: '', stderr: `cut: invalid field value '${spec}'\n`, exitCode: 1 }
  }
  const byField = flags.has('f')

  const { sources, stderr, failed } = readSources(e, rest)
  let stdout = ''
  for (const source of sources) {
    for (const line of toLines(source.text)) {
      if (byField) {
        if (!line.includes(delim)) {
          if (!suppress) stdout += `${line}\n`
          continue
        }
        const fields = line.split(delim)
        const picked = fields.filter((_, i) => inRanges(i + 1, ranges))
        stdout += `${picked.join(delim)}\n`
      } else {
        // -c: 문자 단위. (우리 VFS는 UTF-16 문자열이므로 코드유닛 기준 — 게임 파일은 ASCII다.)
        const chars = [...line].filter((_, i) => inRanges(i + 1, ranges))
        stdout += `${chars.join('')}\n`
      }
    }
  }
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
