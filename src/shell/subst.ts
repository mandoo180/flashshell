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
