import { matchSubstitutionEnd } from './subst'

export type WordPart =
  | { kind: 'literal'; text: string } // 작은따옴표 안 / 이스케이프됨 → 확장 없음
  | { kind: 'raw'; text: string } // 따옴표 없음 → 확장 + 단어분할 + 글롭
  | { kind: 'dquote'; text: string } // 큰따옴표 안 → 확장만, 분할·글롭 없음

export type Word = WordPart[]

export type Operator = '|' | '||' | '&&' | ';' | '>' | '>>' | '<' | '2>' | '2>>'

export type Token = { type: 'WORD'; word: Word } | { type: 'OP'; value: Operator } | { type: 'EOF' }

// 긴 것부터. 앞선 것이 먼저 매칭된다.
const OPERATORS: Operator[] = ['2>>', '2>', '>>', '&&', '||', '|', ';', '>', '<']

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let word: Word = []

  const flush = () => {
    if (word.length > 0) {
      tokens.push({ type: 'WORD', word })
      word = []
    }
  }

  // 같은 종류의 조각이 이어지면 합친다. 빈 텍스트라도 조각은 반드시 남는다 —
  // 그래야 `echo ""` 가 빈 단어 하나를 만든다.
  const push = (kind: WordPart['kind'], text: string) => {
    const last = word[word.length - 1]
    if (last && last.kind === kind) {
      last.text += text
    } else if (kind === 'literal') {
      word.push({ kind, text })
    } else if (kind === 'raw') {
      word.push({ kind, text })
    } else {
      word.push({ kind, text })
    }
  }

  while (i < input.length) {
    const ch = input[i]!

    if (ch === ' ' || ch === '\t' || ch === '\n') {
      flush()
      i++
      continue
    }

    // 연산자. 단, '2>' 계열은 앞에 다른 글자가 붙어있지 않을 때만 연산자다.
    // (`echo 2` 의 2는 단어, `echo 2>f` 의 2>는 연산자)
    const op = OPERATORS.find((o) => input.startsWith(o, i))
    if (op) {
      const isFdRedirect = op.startsWith('2')
      if (!isFdRedirect || word.length === 0) {
        flush()
        tokens.push({ type: 'OP', value: op })
        i += op.length
        continue
      }
    }

    if (ch === '\\') {
      const next = input[i + 1]
      if (next === undefined) throw new Error('unexpected EOF after backslash')
      push('literal', next)
      i += 2
      continue
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end === -1) throw new Error("unexpected EOF while looking for matching `'`")
      push('literal', input.slice(i + 1, end))
      i = end + 1
      continue
    }

    if (ch === '"') {
      let j = i + 1
      let text = ''
      // \", \\, \$ 는 백슬래시가 사라지고 다음 글자가 확장에서 보호된 literal이 된다.
      // dquote 텍스트로 합쳐버리면 \$ 가 진짜 $와 구분이 안 돼 확장기가 다시 확장해버린다
      // — 그래서 여기서 literal 조각으로 갈라 push한다. 그 외 백슬래시는 그대로 둔다.
      let producedPart = false
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && (input[j + 1] === '"' || input[j + 1] === '\\' || input[j + 1] === '$')) {
          if (text.length > 0) {
            push('dquote', text)
            text = ''
          }
          push('literal', input[j + 1]!)
          producedPart = true
          j += 2
          continue
        }
        text += input[j]!
        j++
      }
      if (j >= input.length) throw new Error('unexpected EOF while looking for matching `"`')
      // 빈 텍스트라도 조각은 남겨야 `echo ""`/`echo a""b`가 빈 dquote 조각을 낸다.
      // 단, 이미 이 따옴표 안에서 literal 조각을 냈다면(예: `"\$"`) 뒤에 남는 빈
      // dquote까지 덧붙일 필요는 없다 — 그러면 [literal:'$'] 대신 [literal:'$', dquote:'']가 된다.
      if (text.length > 0 || !producedPart) push('dquote', text)
      i = j + 1
      continue
    }

    // $( ... ) 는 괄호 깊이를 세어 통째로 삼킨다. 안의 공백·연산자는 렉서가 건드리지 않는다.
    // 단, 따옴표 안의 (/) 는 깊이에 반영하지 않는다 — 그래야 `$(echo ")")` 같은 입력이
    // 따옴표 속 )에서 스캔이 멈추는 일이 없다. 짝 찾기는 subst.ts와 공유한다
    // (unterminated 면 matchSubstitutionEnd가 던진다).
    if (ch === '$' && input[i + 1] === '(') {
      const j = matchSubstitutionEnd(input, i) + 1
      push('raw', input.slice(i, j))
      i = j
      continue
    }

    push('raw', ch)
    i++
  }

  flush()
  tokens.push({ type: 'EOF' })
  return tokens
}
