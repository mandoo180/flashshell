//
// 서브셋: SET1 SET2 (치환), -d SET1 (삭제), -s SET1 (중복 압축).
// SET: a-z 범위, [:upper:]/[:lower:]/[:digit:]/[:space:] 클래스, \n \t \\ 이스케이프.
// stdin 만 읽는다 (파일 인자 없음).
import type { CommandFn } from '../types'
import { parseFlags } from './shared'

const CLASSES: Record<string, string> = {
  '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
  '[:digit:]': '0123456789',
  '[:space:]': ' \t\n\r\f\v',
}

/** SET 스펙을 개별 문자 배열로 펼친다. */
function expandSet(spec: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < spec.length) {
    // 문자 클래스
    let matchedClass = false
    for (const [name, chars] of Object.entries(CLASSES)) {
      if (spec.startsWith(name, i)) {
        out.push(...chars)
        i += name.length
        matchedClass = true
        break
      }
    }
    if (matchedClass) continue

    // 이스케이프
    if (spec[i] === '\\') {
      const next = spec[i + 1]
      out.push(next === 'n' ? '\n' : next === 't' ? '\t' : next === '\\' ? '\\' : (next ?? '\\'))
      i += 2
      continue
    }

    // 범위 a-z
    if (spec[i + 1] === '-' && spec[i + 2] !== undefined && spec[i + 2] !== '') {
      const lo = spec.charCodeAt(i)
      const hi = spec.charCodeAt(i + 2)
      if (hi >= lo) {
        for (let c = lo; c <= hi; c++) out.push(String.fromCharCode(c))
        i += 3
        continue
      }
    }

    out.push(spec[i]!)
    i++
  }
  return out
}

export const tr: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const del = flags.has('d')
  const squeeze = flags.has('s')

  // 피연산자 개수 검증
  if (del && squeeze) {
    // -d -s: 2개 필요
    if (rest.length < 2) {
      return { stdout: '', stderr: 'tr: missing operand\n', exitCode: 1 }
    }
  } else if (del || squeeze) {
    // -d 또는 -s만: 1개 필요
    if (rest.length < 1) {
      return { stdout: '', stderr: 'tr: missing operand\n', exitCode: 1 }
    }
  } else {
    // 치환 모드: 2개 필요
    if (rest.length < 2) {
      return { stdout: '', stderr: 'tr: missing operand\n', exitCode: 1 }
    }
  }

  const set1 = rest[0] !== undefined ? expandSet(rest[0]) : []
  const set2 = rest[1] !== undefined ? expandSet(rest[1]) : []

  if (del) {
    const drop = new Set(set1)
    let result = [...e.stdin].filter((ch) => !drop.has(ch)).join('')
    if (squeeze && set2.length > 0) result = squeezeRun(result, new Set(set2))
    return { stdout: result, stderr: '', exitCode: 0 }
  }

  // 치환. SET1[i] → SET2[i], SET2 가 짧으면 마지막 문자로 채운다.
  const map = new Map<string, string>()
  if (set2.length > 0) {
    for (let i = 0; i < set1.length; i++) {
      map.set(set1[i]!, set2[Math.min(i, set2.length - 1)]!)
    }
  }
  let result = [...e.stdin].map((ch) => map.get(ch) ?? ch).join('')

  // -s: 압축 대상은 (치환이 있으면) SET2, 아니면 SET1.
  if (squeeze) result = squeezeRun(result, new Set(set2.length > 0 ? set2 : set1))

  return { stdout: result, stderr: '', exitCode: 0 }
}

/** set 에 든 문자가 연달아 나오면 하나로 접는다. */
function squeezeRun(text: string, set: Set<string>): string {
  let out = ''
  let prev = ''
  for (const ch of text) {
    if (ch === prev && set.has(ch)) continue
    out += ch
    prev = ch
  }
  return out
}
