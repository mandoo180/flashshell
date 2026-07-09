import type { VFS } from './vfs'
import { ExecutionLimitError } from './errors'

/** 글롭 메타문자(*, ?, [)가 들어있는가? */
export function hasGlob(text: string): boolean {
  return /[*?[]/.test(text)
}

/** 세그먼트 매처를 이루는 한 조각: '*'(임의 길이 와일드카드) 아니면 문자 하나를 맞춰보는 술어. */
type Token = { star: true } | { star: false; test: (c: string) => boolean }

/**
 * 패턴의 `[...]` 대괄호 표현식 하나를 파싱한다. `pattern[start]`가 '['여야 한다.
 *
 * - 여는 `[` 바로 뒤(또는 부정 기호 `!`/`^` 바로 뒤)에 오는 `]`는 닫는 괄호가 아니라
 *   리터럴 멤버다 — 진짜 닫는 괄호는 그 다음부터 찾는다 (POSIX/bash 규칙).
 * - 본문은 리터럴 멤버와 `x-y` 범위로 이루어진다. `-`가 본문의 맨 앞이거나 범위를
 *   이룰 다음 글자가 없는 맨 끝이면 리터럴 `-`다.
 * - 역순 범위(`z-a`처럼 lo > hi)는 'invalid'를 돌려준다 — 호출자는 이를 "패턴 전체가
 *   아무것도 매칭하지 않는다"로 처리해야 한다 (기존 정규식 기반 구현이 `new RegExp`
 *   컴파일 실패 시 패턴 전체를 NEVER_MATCHES로 폴백하던 것과 동일한 결과).
 * - 닫히지 않은 `[`는 null을 돌려준다 — 호출자는 '['를 리터럴 문자로 취급한다.
 */
function parseBracket(
  pattern: string,
  start: number,
): { test: (c: string) => boolean; next: number } | 'invalid' | null {
  let j = start + 1
  let negate = false
  if (pattern[j] === '!' || pattern[j] === '^') { negate = true; j++ }
  const bodyStart = j
  let searchFrom = j
  if (pattern[searchFrom] === ']') searchFrom++
  const close = pattern.indexOf(']', searchFrom)
  if (close === -1) return null // 닫히지 않은 [ 는 문자 그대로 (호출자 처리)
  const rawBody = pattern.slice(bodyStart, close)

  const members = new Set<string>()
  const ranges: Array<[string, string]> = []
  let k = 0
  while (k < rawBody.length) {
    const c = rawBody[k]!
    if (rawBody[k + 1] === '-' && k + 2 < rawBody.length) {
      const lo = c
      const hi = rawBody[k + 2]!
      if (lo > hi) return 'invalid' // 역순 범위 — bash와 동일하게 던지지 않고 "매칭 없음"
      ranges.push([lo, hi])
      k += 3
      continue
    }
    members.add(c)
    k++
  }

  const test = (c: string): boolean => {
    let hit = members.has(c)
    if (!hit) {
      for (const [lo, hi] of ranges) {
        if (c >= lo && c <= hi) { hit = true; break }
      }
    }
    return negate ? !hit : hit
  }

  return { test, next: close + 1 }
}

/**
 * 패턴을 토큰 배열로 미리 컴파일한다. 이렇게 하면 아래 tokensMatch의 역추적
 * 루프가 매 스텝마다 대괄호 표현식을 다시 파싱할 필요가 없다 — 파싱은 패턴 길이에
 * 선형이고 한 번만 일어난다.
 *
 * 역순 범위처럼 패턴 자체가 깨진 경우 null을 돌려준다 (호출자는 "아무것도
 * 매칭하지 않음"으로 처리한다 — 기존 정규식 구현의 NEVER_MATCHES 폴백과 동일).
 */
function tokenize(pattern: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (ch === '*') { tokens.push({ star: true }); i++; continue }
    if (ch === '?') { tokens.push({ star: false, test: () => true }); i++; continue }
    if (ch === '[') {
      const parsed = parseBracket(pattern, i)
      if (parsed === 'invalid') return null
      if (parsed === null) {
        tokens.push({ star: false, test: (c) => c === '[' }) // 닫히지 않은 [ 는 문자 그대로
        i++
        continue
      }
      tokens.push({ star: false, test: parsed.test })
      i = parsed.next
      continue
    }
    tokens.push({ star: false, test: (c) => c === ch })
    i++
  }
  return tokens
}

/**
 * 토큰화된 패턴을 이름 하나에 맞춰본다. 고전적인 "별표 위치 기억" 두 포인터
 * 기법이다: '*'를 만나면 그 위치(starTi)와 그 시점의 이름 위치(starNi)를 기억해
 * 두고, 이후 매칭이 막히면 마지막 별표가 한 글자 더 삼킨 걸로 치고 그 지점부터
 * 다시 시도한다. 각 실패마다 이름 포인터가 정확히 하나씩 전진하므로 전체 반복
 * 횟수는 O(이름 길이 × 패턴 길이)로 묶인다 — 정규식 기반 구현의 지수적 백트래킹이
 * 사라진다.
 */
function tokensMatch(tokens: Token[], name: string): boolean {
  const tlen = tokens.length
  const nlen = name.length
  let ti = 0
  let ni = 0
  let starTi = -1
  let starNi = 0

  while (ni < nlen) {
    const tok = ti < tlen ? tokens[ti] : undefined
    if (tok !== undefined && !tok.star && tok.test(name[ni]!)) {
      ti++
      ni++
    } else if (tok !== undefined && tok.star) {
      starTi = ti
      starNi = ni
      ti++
    } else if (starTi !== -1) {
      ti = starTi + 1
      starNi++
      ni = starNi
    } else {
      return false
    }
  }
  while (ti < tlen && tokens[ti]!.star) ti++
  return ti === tlen
}

/** 패턴 하나를 파일명 하나에 맞춰본다. 경로 구분자는 다루지 않는다. */
export function matchSegment(pattern: string, name: string): boolean {
  // bash: 글롭의 * 와 ? 는 선행 점에 맞지 않는다. 패턴의 "첫 글자"가 리터럴 '.' 이어야
  // 이 보호가 풀린다 — [.]* 처럼 대괄호 표현식이 '.'을 매칭할 수 있어도 소용없다.
  if (name.startsWith('.') && !pattern.startsWith('.')) return false
  const tokens = tokenize(pattern)
  if (tokens === null) return false // 역순 범위 등 깨진 패턴 — 아무것도 매칭하지 않는다
  return tokensMatch(tokens, name)
}

/** frontier(작업 중인 후보 경로 집합)의 상한. 순환 심볼릭 링크를 통과하는 글롭
 * 세그먼트마다 후보가 갑절로 불어나는 경우(2^N)를 막는다. 이 게임의 VFS는 작고
 * 저작자가 직접 구성하므로 정상적인 글롭은 결과가 몇 개~몇십 개를 넘지 않는다;
 * 10,000은 그보다 몇 자릿수 위의 넉넉한 상한이다. */
const FRONTIER_CAP = 10_000

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
    const pushCandidate = (candidate: string): void => {
      next.push(candidate)
      // 다음 세그먼트로 넘어가 또 갑절이 되기 전에, 바로 이 자리에서 끊는다 —
      // 2^20개 문자열을 다 만들고 나서야 잘라내지 않는다.
      if (next.length > FRONTIER_CAP) throw new ExecutionLimitError()
    }

    for (const prefix of frontier) {
      const dir = fs.resolve(prefix === '' ? '.' : prefix, base)
      if (!fs.isDir(dir)) continue

      if (!hasGlob(segment)) {
        const candidate = prefix === '' ? segment : `${prefix}/${segment}`
        if (fs.exists(fs.resolve(candidate, base))) pushCandidate(candidate)
        continue
      }

      for (const name of fs.readdir(dir)) {
        if (!matchSegment(segment, name)) continue
        pushCandidate(prefix === '' ? name : `${prefix}/${name}`)
      }
    }
    frontier = next
  }

  if (frontier.length === 0) return [pattern]
  const results = absolute ? frontier.map((p) => `/${p}`) : frontier
  return results.sort()
}
