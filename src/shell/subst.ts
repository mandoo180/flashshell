/**
 * 명령치환 `$( ... )`의 짝을 찾는 따옴표 인식 스캐너.
 *
 * lexer.ts와 expand.ts가 똑같은 문제(괄호 깊이를 세면서 짝을 찾되, 따옴표 안의
 * 괄호는 세지 않아야 한다)를 각자 풀지 않도록 여기 하나로 모은다.
 */

/**
 * `source`와 `$(` 의 `$` 인덱스(dollarIndex)가 주어지면, 짝이 맞는 `)` 의 인덱스를 돌려준다.
 * '…', "…", 백슬래시 이스케이프를 건너뛰므로 따옴표 안의 괄호는 깊이에 반영되지 않는다.
 * 짝이 맞는 `)` 를 찾지 못하면(따옴표가 안 닫히거나 괄호가 안 닫히면) 던진다.
 */
export function matchSubstitutionEnd(source: string, dollarIndex: number): number {
  let depth = 0
  let j = dollarIndex + 1 // source[j] === '(' 인 채로 시작한다.
  while (j < source.length) {
    const c = source[j]!
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === "'") {
      const end = source.indexOf("'", j + 1)
      if (end === -1) break // 안 닫힘 → 루프를 빠져나가 아래에서 던진다.
      j = end + 1
      continue
    }
    if (c === '"') {
      let k = j + 1
      while (k < source.length && source[k] !== '"') {
        k += source[k] === '\\' ? 2 : 1
      }
      if (k >= source.length) break // 안 닫힘 → 아래에서 던진다.
      j = k + 1
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return j
    }
    j++
  }
  throw new Error('unexpected EOF while looking for matching `)`')
}

/**
 * 단어 시작에서 만난 bare `((` (산술 명령 `(( expr ))`)의 짝이 맞는 `))` 뒤 인덱스를 돌려준다.
 * `source[i] === '(' && source[i+1] === '('` 인 상태로 호출한다(호출부 책임 — `$((`은 lexer의
 * `$` 분기가 먼저 가로채므로 여기 도달하지 않는다).
 *
 * matchSubstitutionEnd와 같은 따옴표 인식 괄호-깊이 카운팅이지만 두 가지가 다르다:
 *  - 시작 지점이 `$(`처럼 이미 연 괄호 하나가 있는 상태(depth 는 그 하나를 세면서 시작)가
 *    아니라, `((` 두 글자 자체를 첫 반복부터 세어야 한다(depth 0에서 시작해 i 위치부터 스캔).
 *  - 반환값이 "짝이 맞는 문자의 인덱스"가 아니라 "그 문자 바로 다음 인덱스"다(호출부가 +1을
 *    또 할 필요 없이 바로 slice 종료 인덱스로 쓸 수 있게).
 * `(( (1+2) * 3 ))`처럼 안쪽에 추가 괄호가 있어도(균형 잡힌 그룹) depth 카운팅이 자연히
 * 처리한다 — 안쪽 그룹은 열고 닫으며 depth가 원래 레벨로 돌아올 뿐, 바깥 `((`에 대응하는
 * 마지막 `)`에서만 depth가 0이 된다.
 */
export function matchDoubleParenEnd(source: string, i: number): number {
  let depth = 0
  let j = i
  while (j < source.length) {
    const c = source[j]!
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === "'") {
      const end = source.indexOf("'", j + 1)
      if (end === -1) break
      j = end + 1
      continue
    }
    if (c === '"') {
      let k = j + 1
      while (k < source.length && source[k] !== '"') {
        k += source[k] === '\\' ? 2 : 1
      }
      if (k >= source.length) break
      j = k + 1
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return j + 1
    }
    j++
  }
  throw new Error('unexpected EOF while looking for matching `))`')
}
