import { matchSubstitutionEnd, matchBraceEnd, matchDoubleParenEnd } from './subst'

export type WordPart =
  | { kind: 'literal'; text: string } // 작은따옴표 안 / 이스케이프됨 → 확장 없음
  | { kind: 'raw'; text: string } // 따옴표 없음 → 확장 + 단어분할 + 글롭
  | { kind: 'dquote'; text: string } // 큰따옴표 안 → 확장만, 분할·글롭 없음

export type Word = WordPart[]

export type Operator = '|' | '||' | '&&' | ';' | ';;' | '>' | '>>' | '<' | '2>' | '2>>'

export type Token = { type: 'WORD'; word: Word } | { type: 'OP'; value: Operator } | { type: 'EOF' }

// 긴 것부터. 앞선 것이 먼저 매칭된다. ';;' 는 ';' 보다 먼저 와야 한다 — 안 그러면
// `;;` 의 첫 글자에서 이미 ';' 로 매칭되어 버려(둘 다 ';'로 시작) 두 번째 ';' 가
// 별개의 ';' 토큰으로 새어나간다 (task 6: case 문의 `;;` 분기 종료자).
const OPERATORS: Operator[] = ['2>>', '2>', '>>', '&&', '||', ';;', ';', '|', '>', '<']

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

    if (ch === ' ' || ch === '\t') {
      flush()
      i++
      continue
    }

    // 개행은 ;와 동등한 리스트 분리자로 접는다(fold). bash는 대부분 문맥에서 개행을
    // ;처럼 다루고, 파서는 이미 ;로 리스트를 나눈다. 단, 개행을 ;로 접으면 안 되는
    // 자리가 있어 직전 토큰을 보고 ; 를 억누른다:
    //  - 직전 토큰이 없음(선행 개행) 또는 이미 OP(;)(연속 개행/빈 줄) → ; 를 또 내면
    //    파서가 빈 파이프라인으로 오인해 문법 오류를 낸다.
    //  - 직전 토큰이 오른쪽 피연산자를 기대하는 이항 연산자(| && ||) → bash는 그런
    //    연산자 뒤의 개행을 라인 컨티뉴에이션으로 보고 명령을 이어 붙인다
    //    (`mkdir a &&\nmkdir b`, `echo x |\ncat`, `false ||\necho y`). 여기서 ; 를
    //    내면 `&& ; ...`가 되어 파싱에 실패한다 — 그래서 개행을 공백처럼 흘려버린다.
    if (ch === '\n') {
      flush()
      const last = tokens[tokens.length - 1]
      const suppress =
        !last ||
        (last.type === 'OP' && (last.value === ';' || last.value === '|' || last.value === '&&' || last.value === '||'))
      if (!suppress) {
        tokens.push({ type: 'OP', value: ';' })
      }
      i++
      continue
    }

    // #: 새 토큰이 시작하는 자리(따옴표 밖, 단어 진행 중이 아님)에서만 주석이다.
    // 단어 중간의 #(a#b)이나 따옴표 안의 #('#x')은 이 지점에 도달하지 않는다 —
    // 전자는 word.length > 0 이라 아래 조건을 건너뛰고(raw로 합쳐짐), 후자는
    // 따옴표 분기가 내부에서 통째로 소비하므로 여기까지 오지 않는다.
    if (ch === '#' && word.length === 0) {
      while (i < input.length && input[i] !== '\n') i++
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

    // ${ ... } 파라미터 확장도 $( ... ) 처럼 통째로 한 raw 조각으로 삼킨다. 이 분기가
    // 없으면 `${x:-a b}` 의 공백이 렉싱 단계에서 단어를 flush 해버려(→ `${x:-a`, `b}`
    // 두 토큰) expand.ts 의 findBraceClose/expandBraceParam 이 온전한 `${...}` 를 보지
    // 못하고 garbled 된다(따옴표 없는 다중 단어 arg 버그). 여기서 중괄호 깊이를 세어
    // 짝 맞는 `}` 까지 한 조각으로 넘기면, 확장 결과("a b")를 splitFields 가 그 뒤에
    // 나눠 준다 — `$(echo a b)` 가 이미 그렇게 동작하는 것과 동일한 흐름이다. 짝 찾기는
    // subst.ts 와 공유한다(중첩 ${..} 와 따옴표 속 } 를 정확히 건너뛰고, 안 닫히면 던진다).
    if (ch === '$' && input[i + 1] === '{') {
      const j = matchBraceEnd(input, i) + 1
      push('raw', input.slice(i, j))
      i = j
      continue
    }

    // (( expr )) 산술 명령: 단어 시작(word.length === 0)에서 bare `((` 를 만나면 짝이 맞는
    // `))` 까지 통째로 한 raw 조각으로 삼킨다. `$((` 는 위 분기가 이미 가로채므로 여기
    // 도달하지 않는다 — 이 서브셋엔 `( )` 서브셸이 없어서, 단어 시작의 bare `((` 는
    // 언제나 산술 명령으로 봐도 모호하지 않다. 이 분기가 없으면 `((`가 raw 글자 두 개로
    // 낱낱이 흩어져 `<`/`>` 가 리다이렉트 연산자로 오인되며 완전히 깨진다
    // (예: `(( i < 5 ))` 의 `<` 가 리다이렉트로 토큰화됨).
    if (ch === '(' && input[i + 1] === '(' && word.length === 0) {
      const j = matchDoubleParenEnd(input, i)
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
