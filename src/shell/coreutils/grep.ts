import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

/**
 * 패턴은 JavaScript `RegExp`로 직행한다. bash의 BRE(기본 정규식)와는 미묘하게
 * 다르다 — BRE에서 `+`는 문자 그대로지만 우리에겐 수량자다. 골든 테스트에서
 * `grep`은 문자열 리터럴 패턴이나 ERE 문법(`grep -E`와 동일)만 쓴다는 게 이
 * 구현의 전제다. 문제 출제 시 이 한계를 지킨다.
 */
export const grep: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const pattern = rest[0]
  if (pattern === undefined) return { stdout: '', stderr: 'usage: grep PATTERN [FILE...]\n', exitCode: 2 }

  let regexp: RegExp
  try {
    regexp = new RegExp(pattern, flags.has('i') ? 'i' : '')
  } catch {
    // new RegExp 가 던지는 예외를 여기서 반드시 잡는다 — 명령 실행 도중의 예외는
    // 인터프리터가 exit 1 짜리 일반 에러로 뭉개버리므로, grep 고유의 exit 2를
    // 지키려면 여기서 직접 fail 을 반환해야 한다.
    return { stdout: '', stderr: `grep: ${pattern}: invalid regular expression\n`, exitCode: 2 }
  }

  const files = rest.slice(1)
  const { sources, stderr, failed } = readSources(e, files)
  const showFilename = files.length > 1

  let stdout = ''
  let matched = false

  for (const source of sources) {
    let count = 0
    const lines = toLines(source.text)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const hit = regexp.test(line) !== flags.has('v')
      if (!hit) continue
      matched = true
      count++
      if (flags.has('c')) continue
      const prefix = (showFilename ? `${source.label}:` : '') + (flags.has('n') ? `${i + 1}:` : '')
      stdout += `${prefix}${line}\n`
    }
    if (flags.has('c')) stdout += `${showFilename ? `${source.label}:` : ''}${count}\n`
  }

  const exitCode = failed ? 2 : matched ? 0 : 1
  return { stdout, stderr, exitCode }
}
