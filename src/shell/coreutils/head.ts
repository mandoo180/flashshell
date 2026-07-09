import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines, normalizeCountFlag, isDirectoryError, errnoText, type Source } from './shared'

/**
 * 골라낸 줄들을 이어붙인다. GNU head/tail 은 파일을 "줄의 배열"로 재구성하는 게
 * 아니라 원문 바이트를 그대로 잘라 내보낸다 — 그래서 후행 개행이 없는 파일의
 * 마지막 줄을 포함해서 낼 때는 그 줄에도 개행을 붙이지 않는다. docker
 * debian:stable-slim coreutils 9.7 로 확인: `printf 'a\nb\nc'` (후행 개행 없음)에
 * `head -n 5`(전체) -> "a\nb\nc"(개행 없음), `head -n 2`(일부) -> "a\nb\n"(있음).
 * `includesTail` 은 골라낸 줄 중 마지막 것이 원문의 진짜 마지막 줄인지를 뜻한다.
 */
function renderSelected(source: Source, selected: string[], includesTail: boolean): string {
  const hasTrailingNewline = source.text.endsWith('\n')
  let out = ''
  selected.forEach((line, idx) => {
    const isLastSelected = idx === selected.length - 1
    if (isLastSelected && includesTail && !hasTrailingNewline) out += line
    else out += `${line}\n`
  })
  return out
}

/**
 * task-10 finding 1: head/tail 의 "없는 파일" 문구는 cat/wc/grep 과 다르다 — 그리고
 * 두 명령이 서로 같은 문구 틀을 쓴다(명령 이름만 다르다). docker debian:stable-slim
 * coreutils 9.7 실측:
 *   `head missing.txt` -> "head: cannot open 'missing.txt' for reading: No such file or directory"
 *   `tail missing.txt` -> "tail: cannot open 'missing.txt' for reading: No such file or directory"
 *   `head /somedir`    -> "head: error reading '/somedir': Is a directory" (디렉터리는 문구 틀 자체가 다르다)
 *   `tail /somedir`    -> "tail: error reading '/somedir': Is a directory"
 * head.ts 와 tail.ts 가 함께 쓴다(renderSelected 처럼 head.ts 에서 export).
 */
function formatOpenError(name: string): (file: string, err: unknown) => string {
  return (file, err) =>
    isDirectoryError(err)
      ? `${name}: error reading '${file}': ${errnoText(err)}`
      : `${name}: cannot open '${file}' for reading: ${errnoText(err)}`
}

export const head: CommandFn = (e) => {
  const { flags, rest } = parseFlags(normalizeCountFlag(e.args), ['n'])
  const count = Number(flags.get('n') ?? 10)
  const { sources, stderr, failed } = readSources(e, rest, formatOpenError(e.name))
  // 파일 인자가 둘 이상일 때만 "==> 이름 <==" 헤더를 붙인다 — 실패한 인자도 개수에
  // 들어간다. docker로 확인: `head -n 1 missing.txt a.txt` 도 생존자 a.txt 에 헤더가
  // 붙는다(요청한 인자가 2개였으므로).
  const showHeaders = rest.length > 1

  let stdout = ''
  sources.forEach((source, idx) => {
    const lines = toLines(source.text)
    const selected = lines.slice(0, count)
    const includesTail = selected.length === lines.length && lines.length > 0
    if (showHeaders) stdout += `${idx > 0 ? '\n' : ''}==> ${source.label} <==\n`
    stdout += renderSelected(source, selected, includesTail)
  })

  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}

export { renderSelected, formatOpenError }
