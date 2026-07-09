import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines, normalizeCountFlag } from './shared'
import { renderSelected, formatOpenError } from './head'

export const tail: CommandFn = (e) => {
  const { flags, rest } = parseFlags(normalizeCountFlag(e.args), ['n'])
  const count = Number(flags.get('n') ?? 10)
  const { sources, stderr, failed } = readSources(e, rest, formatOpenError(e.name))
  // head.ts 의 주석 참고: 헤더는 요청한 파일 인자가 둘 이상일 때만 붙는다.
  const showHeaders = rest.length > 1

  let stdout = ''
  sources.forEach((source, idx) => {
    const lines = toLines(source.text)
    const selected = lines.slice(Math.max(0, lines.length - count))
    // tail 이 고른 줄들은 count > 0 인 한 항상 원문의 마지막 줄로 끝난다.
    const includesTail = selected.length > 0
    if (showHeaders) stdout += `${idx > 0 ? '\n' : ''}==> ${source.label} <==\n`
    stdout += renderSelected(source, selected, includesTail)
  })

  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
