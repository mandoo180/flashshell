//
// 서브셋: [-c] [-d] [-u] [-i] [INPUT]. 인접 중복만 접는다 (정렬 안 함).
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

export const uniq: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const count = flags.has('c')
  const onlyDup = flags.has('d')
  const onlyUniq = flags.has('u')
  const ignoreCase = flags.has('i')

  const { sources, stderr, failed } = readSources(e, rest.slice(0, 1))
  const lines = sources.flatMap((s) => toLines(s.text))

  const key = (line: string) => (ignoreCase ? line.toLowerCase() : line)
  const groups: { line: string; n: number }[] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (last && key(last.line) === key(line)) last.n += 1
    else groups.push({ line, n: 1 })
  }

  let stdout = ''
  for (const g of groups) {
    if (onlyDup && g.n < 2) continue
    if (onlyUniq && g.n > 1) continue
    stdout += count ? `${String(g.n).padStart(7)} ${g.line}\n` : `${g.line}\n`
  }
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
