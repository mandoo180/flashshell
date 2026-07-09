import type { VFS } from './vfs'

/** 글롭 메타문자(*, ?, [)가 들어있는가? */
export function hasGlob(text: string): boolean {
  return /[*?[]/.test(text)
}

/** 어떤 문자열로도 매칭되지 않는 정규식 — 잘못된 패턴(예: 역순 범위)의 안전한 폴백. */
const NEVER_MATCHES = /(?!)/

/**
 * 글롭 패턴을 정규식으로 옮긴다.
 *
 * - `*`, `?` 는 각각 `[^/]*`, `[^/]` 로 옮긴다 (경로 구분자는 넘지 않는다 — 이 함수는
 *   세그먼트 하나만 다루므로 방어적 차원일 뿐, 호출자가 이미 세그먼트 단위로 쪼갠다).
 * - `[...]` 는 POSIX 대괄호 표현식 규칙을 따른다: 여는 `[` 바로 뒤(또는 부정 기호
 *   `!`/`^` 바로 뒤)에 오는 `]`는 닫는 괄호가 아니라 리터럴 멤버다. 끝의 `-`는
 *   범위가 아니라 리터럴이다 (JS 정규식 클래스도 동일하게 동작해 손댈 필요 없다).
 * - 그 외 문자는 JS 정규식 메타문자만 이스케이프해 리터럴로 취급한다.
 * - 닫히지 않은 `[`나 잘못된 범위처럼 구성이 깨지면 예외 없이 "매칭 안 함"으로
 *   폴백한다 — expandGlob은 매칭 0건을 패턴 원문 반환(nullglob 없음)으로 처리하므로
 *   이 폴백이 곧 bash의 실제 동작과 맞아떨어진다.
 */
function toRegExp(pattern: string): RegExp {
  let out = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (ch === '*') { out += '[^/]*'; i++; continue }
    if (ch === '?') { out += '[^/]'; i++; continue }
    if (ch === '[') {
      let j = i + 1
      let negate = false
      if (pattern[j] === '!' || pattern[j] === '^') { negate = true; j++ }
      const bodyStart = j
      // 여는 대괄호(또는 부정 기호) 바로 다음의 ']'는 리터럴 멤버다. 진짜 닫는
      // 괄호는 그 다음부터 찾는다.
      let searchFrom = j
      if (pattern[searchFrom] === ']') searchFrom++
      const close = pattern.indexOf(']', searchFrom)
      if (close === -1) { out += '\\['; i++; continue } // 닫히지 않은 [ 는 문자 그대로
      const rawBody = pattern.slice(bodyStart, close)
      // JS 문자 클래스에서는 '\'와 ']'가 특수하다 (POSIX 대괄호 표현식과 다르게).
      // 리터럴 멤버로 남기려면 이스케이프해야 한다.
      const body = rawBody.replace(/\\/g, '\\\\').replace(/]/g, '\\]')
      out += `[${negate ? '^' : ''}${body}]`
      i = close + 1
      continue
    }
    out += ch.replace(/[.+^${}()|\\]/g, '\\$&')
    i++
  }
  try {
    return new RegExp(out + '$')
  } catch {
    return NEVER_MATCHES
  }
}

/** 패턴 하나를 파일명 하나에 맞춰본다. 경로 구분자는 다루지 않는다. */
export function matchSegment(pattern: string, name: string): boolean {
  // bash: 글롭의 * 와 ? 는 선행 점에 맞지 않는다. 패턴의 "첫 글자"가 리터럴 '.' 이어야
  // 이 보호가 풀린다 — [.]* 처럼 대괄호 표현식이 '.'을 매칭할 수 있어도 소용없다.
  if (name.startsWith('.') && !pattern.startsWith('.')) return false
  return toRegExp(pattern).test(name)
}

/**
 * 글롭을 확장한다. 매칭이 하나도 없으면 패턴 문자열 자체를 담은 배열을 돌려준다
 * (bash 기본 동작. nullglob 없음). 결과는 사전순 정렬.
 */
export function expandGlob(pattern: string, cwd: string, fs: VFS): string[] {
  if (!hasGlob(pattern)) return [pattern]

  const absolute = pattern.startsWith('/')
  const segments = pattern.split('/').filter((s) => s !== '')

  // 시작 디렉터리에서 출발해 세그먼트를 하나씩 넓혀 나간다.
  let frontier: string[] = ['']
  const base = absolute ? '/' : cwd

  for (const segment of segments) {
    const next: string[] = []
    for (const prefix of frontier) {
      const dir = fs.resolve(prefix === '' ? '.' : prefix, base)
      if (!fs.isDir(dir)) continue

      if (!hasGlob(segment)) {
        const candidate = prefix === '' ? segment : `${prefix}/${segment}`
        if (fs.exists(fs.resolve(candidate, base))) next.push(candidate)
        continue
      }

      for (const name of fs.readdir(dir)) {
        if (!matchSegment(segment, name)) continue
        next.push(prefix === '' ? name : `${prefix}/${name}`)
      }
    }
    frontier = next
  }

  if (frontier.length === 0) return [pattern]
  const results = absolute ? frontier.map((p) => `/${p}`) : frontier
  return results.sort()
}
