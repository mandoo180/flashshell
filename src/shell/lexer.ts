import { matchSubstitutionEnd, matchBraceEnd, matchDoubleParenEnd, matchArrayLiteralEnd } from './subst'

export type WordPart =
  | { kind: 'literal'; text: string } // 작은따옴표 안 / 이스케이프됨 → 확장 없음
  | { kind: 'raw'; text: string } // 따옴표 없음 → 확장 + 단어분할 + 글롭
  | { kind: 'dquote'; text: string } // 큰따옴표 안 → 확장만, 분할·글롭 없음

export type Word = WordPart[]

export type Operator = '|' | '||' | '&&' | ';' | ';;' | '>' | '>>' | '<' | '<<' | '2>' | '2>>' | '(' | ')'

/**
 * here-document 본문(M3 Part 4 task 5). `<<`/`<<-` 뒤 물리적 줄들을 pre-pass 가 잘라내
 * 여기 담고, `<<` 연산자 토큰에 실어 parser 로 넘긴다. expand=false 는 따옴표 delim
 * (`<<'EOF'`/`<<"EOF"`/`<<\EOF`)일 때 — 본문을 확장하지 않는다.
 */
export interface HereDocBody { body: string; expand: boolean }

export type Token =
  | { type: 'WORD'; word: Word }
  | { type: 'OP'; value: Operator; heredoc?: HereDocBody }
  | { type: 'EOF' }

// 긴 것부터. 앞선 것이 먼저 매칭된다. ';;' 는 ';' 보다 먼저 와야 한다 — 안 그러면
// `;;` 의 첫 글자에서 이미 ';' 로 매칭되어 버려(둘 다 ';'로 시작) 두 번째 ';' 가
// 별개의 ';' 토큰으로 새어나간다 (task 6: case 문의 `;;` 분기 종료자).
// `(`/`)` 는 여기 없다 — 이 목록은 아래 while 루프 앞부분(따옴표·치환 캡처 이전)에서
// startsWith 로 스캔되는데, 그 자리에서 `(` 를 먹으면 word-start `((` 산술 캡처가 절대
// 도달하지 못한다. 그래서 `(`/`)` 는 `((` 캡처 *뒤* 전용 분기에서 따로 토큰화한다.
// '<<' 는 반드시 '<' 보다 앞이다 — startsWith 로 앞선 것이 먼저 매칭되므로, 뒤에 있으면
// here-doc 연산자 `<<` 가 단일 `<` 두 개로 새어버린다(pre-pass 가 남긴 2글자 `<<`).
const OPERATORS: Operator[] = ['2>>', '2>', '>>', '&&', '||', ';;', ';', '|', '>', '<<', '<']

// 진행 중인 word 가 배열 리터럴 대입의 LHS(`NAME=`/`NAME[subscript]=`, 그리고 M3 Part 4
// 의 append 형 `NAME+=`/`NAME[subscript]+=`)인지 — 여는 `(` 를 인접 배열로 삼킬지
// 판정한다(M3 Part 3 task 2). 반드시 `=`(선택적 선행 `+`) 로 끝나야 한다. `\+?` 는 단일
// 리터럴 옵션이라 구조적(ReDoS 없음)이다.
const ARRAY_ASSIGN_LHS_RE = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=$/

interface PendingHereDoc { index: number; delim: string; dash: boolean }

/**
 * `<<`/`<<-` 뒤(선행 공백 스킵 후) 위치 j 에서 here-doc 구분자를 읽는다. 따옴표(`'…'`/`"…"`)
 * 나 백슬래시가 하나라도 있으면 expand=false(본문 미확장)이고, 구분자 이름은 따옴표·백슬래시를
 * 벗긴 문자들의 연결이다(bash: `<<E"O"F` → `EOF`, no-expand). 공백/개행/메타문자에서 멈춘다.
 * 유효한 구분자가 하나도 없으면(바로 개행/메타문자/EOF) null — 호출부가 malformed 로 처리한다.
 * 여기 정규식은 없다(문자 스캔) — ReDoS 없음.
 */
function readHereDocDelim(input: string, j: number): { delim: string; expand: boolean; next: number } | null {
  let delim = ''
  let expand = true
  let sawAny = false
  let k = j
  while (k < input.length) {
    const c = input[k]!
    if (c === "'") {
      const end = input.indexOf("'", k + 1)
      if (end === -1) return null
      delim += input.slice(k + 1, end)
      expand = false
      sawAny = true
      k = end + 1
      continue
    }
    if (c === '"') {
      const end = input.indexOf('"', k + 1)
      if (end === -1) return null
      delim += input.slice(k + 1, end)
      expand = false
      sawAny = true
      k = end + 1
      continue
    }
    if (c === '\\') {
      if (k + 1 >= input.length) break
      delim += input[k + 1]!
      expand = false
      sawAny = true
      k += 2
      continue
    }
    if (
      c === ' ' || c === '\t' || c === '\n' || c === ';' || c === '|' ||
      c === '&' || c === '<' || c === '>' || c === '(' || c === ')'
    ) break
    delim += c
    sawAny = true
    k++
  }
  if (!sawAny) return null
  return { delim, expand, next: k }
}

/**
 * pos(다음 물리적 줄 시작)부터 대기 중 here-doc 들의 본문을 **순서대로** 흡수한다. 각 here-doc
 * 은 자기 구분자와 정확히 같은 줄에서 닫힌다(닫는 줄은 소비하되 본문에 넣지 않는다 — 구분자
 * 앞뒤에 다른 문자가 있으면 닫히지 않는다: `EOFX`/`EOF ` 는 닫는 줄이 아니다, docker 확인).
 * `<<-`(dash)면 각 줄의 **선행 TAB** 만 벗긴 뒤 비교·저장한다(SPACE 는 안 벗긴다). 닫는 구분자
 * 없이 입력이 끝나면(unterminated) 지금까지 흡수한 부분 본문을 그대로 쓴다 — bash 는 경고를
 * stderr 로 내고 부분 본문을 전달한다(docker 실측: exit 0, syntax error 아님). 모든 본문을
 * 채운 뒤 다음 스캔 위치를 돌려준다. 정규식 없이 indexOf/slice 로만 라인을 나눈다(ReDoS 없음).
 */
function captureHereDocBodies(
  input: string,
  pos: number,
  pending: PendingHereDoc[],
  heredocs: HereDocBody[],
): number {
  for (const hd of pending) {
    let body = ''
    for (;;) {
      if (pos >= input.length) break // 닫는 구분자 없이 EOF → 부분 본문 사용
      const nl = input.indexOf('\n', pos)
      const lineEnd = nl === -1 ? input.length : nl
      const nextPos = nl === -1 ? input.length : nl + 1
      let line = input.slice(pos, lineEnd)
      if (hd.dash) {
        let s = 0
        while (s < line.length && line[s] === '\t') s++
        line = line.slice(s)
      }
      if (line === hd.delim) { pos = nextPos; break } // 닫는 줄 — 소비하고 종료
      body += line + '\n'
      pos = nextPos
      if (nl === -1) break // 마지막 줄이 개행 없이 끝났고 구분자도 아님 → unterminated
    }
    heredocs[hd.index]!.body = body
  }
  return pos
}

/**
 * here-doc 전처리 pre-pass (M3 Part 4 task 5). 메인 char 스캐너 + `\n`→`;` fold 는 "구분자
 * 줄까지 물리적 라인을 소비" 하지 못하므로, tokenize 전에 입력 전체를 한 번 훑어 `<<[-]DELIM`
 * 뒤에 오는 물리적 줄들(본문)을 잘라내 heredocs 에 담고, 스트림에는 2글자 `<<` 연산자만 남긴다
 * (구분자와 본문은 제거). 반환한 text 를 메인 tokenize 가 처리한다.
 *
 * **핵심 불변식(무회귀의 근거):** 입력에 top-level `<<` 가 하나도 없으면 text === input(바이트
 * 동일)이고 heredocs 는 빈 배열이다. 따옴표/`$(…)`/`${…}`/`((…))`/`NAME=(…)` 캡처는 통째로
 * 원문 그대로 복사하므로 — 그 안의 `<<` 는 절대 here-doc 로 오인되지 않고(예: `$(( a << b ))`,
 * `(( x << 2 ))` 의 왼쪽 시프트), 내부 개행도 본문 트리거가 되지 않는다. 주석(`#`…)과 백슬래시
 * 이스케이프(`\<`)도 원문 복사하며 `<<` 스캔에서 제외한다. 그래서 `<<` 를 안 쓰는 기존 모든
 * 입력의 토크나이즈는 완전히 그대로다. 캡처 짝 찾기는 subst.ts 를 공유하고, unterminated 캡처는
 * 남은 입력을 그대로 흘려 메인 tokenize 가 표준 에러(`unexpected EOF`)를 내게 한다.
 *
 * `<<` 연산자와 heredocs 배열의 정렬: pre-pass 는 왼→오로 `<<` 마다 heredocs 에 한 항목을
 * push 하고, 메인 tokenize 도 왼→오로 `<<` 를 만날 때마다 hereIndex 카운터로 그 항목을 뽑아
 * 붙인다(둘이 같은 캡처를 같은 방식으로 건너뛰므로 top-level `<<` 집합이 정확히 일치한다).
 */
function stripHereDocs(input: string): { text: string; heredocs: HereDocBody[] } {
  const heredocs: HereDocBody[] = []
  let out = ''
  let i = 0
  let wordStart = 0 // 현재 단어 시작 인덱스. i===wordStart 이면 단어 시작(메인 tokenize 의 word.length===0 대응).
  let pending: PendingHereDoc[] = [] // 현재 논리 라인에서 본문 대기 중인 here-doc(들), 순서대로.

  const copyRest = (): void => { out += input.slice(i); i = input.length }

  while (i < input.length) {
    const ch = input[i]!

    // 주석: 단어 시작의 `#` 는 줄 끝까지 주석(메인 tokenize 와 같은 규칙). 원문 복사하고
    // `<<` 스캔에서 제외한다 — 주석 속 `<<` 는 here-doc 가 아니다(docker 확인).
    if (ch === '#' && i === wordStart) {
      const nl = input.indexOf('\n', i)
      const end = nl === -1 ? input.length : nl
      out += input.slice(i, end)
      i = end
      continue
    }

    // 백슬래시 이스케이프: `\x` 두 글자를 원문 그대로 흘린다(`\<\<` 가 here-doc 로 안 새게).
    if (ch === '\\') {
      out += input.slice(i, i + 2)
      i += 2
      continue
    }

    // '…' 작은따옴표: 안쪽은 확장/연산자 해석 없음 → 통째 복사(속 `<<`·개행 무시).
    if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end === -1) { copyRest(); continue } // 안 닫힘 → 메인 tokenize 가 표준 에러
      out += input.slice(i, end + 1)
      i = end + 1
      continue
    }

    // "…" 큰따옴표: \" \\ 를 건너뛰며 짝 맞는 " 까지 통째 복사.
    if (ch === '"') {
      let k = i + 1
      while (k < input.length && input[k] !== '"') k += input[k] === '\\' ? 2 : 1
      if (k >= input.length) { copyRest(); continue }
      out += input.slice(i, k + 1)
      i = k + 1
      continue
    }

    // $( … ) 명령치환 / $(( … )) 산술확장 — 통째 복사(속 `<<` 는 왼쪽 시프트이지 here-doc 가
    // 아니다). 짝 찾기는 subst.ts 공유. 안 닫히면 나머지를 흘려 메인 tokenize 가 표준 에러.
    if (ch === '$' && input[i + 1] === '(') {
      let end: number
      try { end = matchSubstitutionEnd(input, i) + 1 } catch { copyRest(); continue }
      out += input.slice(i, end)
      i = end
      continue
    }

    // ${ … } 파라미터 확장 — 통째 복사.
    if (ch === '$' && input[i + 1] === '{') {
      let end: number
      try { end = matchBraceEnd(input, i) + 1 } catch { copyRest(); continue }
      out += input.slice(i, end)
      i = end
      continue
    }

    // (( … )) 산술 명령(단어 시작). 속 `<<` 는 왼쪽 시프트다: `(( x << 2 ))`. 통째 복사.
    if (ch === '(' && input[i + 1] === '(' && i === wordStart) {
      let end: number
      try { end = matchDoubleParenEnd(input, i) } catch { copyRest(); continue }
      out += input.slice(i, end)
      i = end
      wordStart = i
      continue
    }

    // NAME=( … ) / NAME[..]=( … ) 배열 리터럴 — 통째 복사(개행 가능, 속 `<<` 무시).
    if (ch === '(' && i > wordStart && ARRAY_ASSIGN_LHS_RE.test(input.slice(wordStart, i))) {
      let end: number
      try { end = matchArrayLiteralEnd(input, i) } catch { copyRest(); continue }
      out += input.slice(i, end)
      i = end
      wordStart = i
      continue
    }

    // << / <<- here-doc 연산자. 구분자·본문은 제거하고 스트림엔 2글자 `<<` 만 남긴다.
    if (ch === '<' && input[i + 1] === '<') {
      let j = i + 2
      let dash = false
      if (input[j] === '-') { dash = true; j++ }
      while (input[j] === ' ' || input[j] === '\t') j++
      const d = readHereDocDelim(input, j)
      out += '<<'
      if (d === null) {
        // 구분자 없음(malformed, 예: `cat <<` 뒤 개행/EOF). 정렬 유지를 위해 빈 본문 항목을
        // 기록한다 → graceful(빈 stdin). bash 는 문법 오류지만 크래시 없는 관대한 처리.
        heredocs.push({ body: '', expand: true })
        i += 2
      } else {
        heredocs.push({ body: '', expand: d.expand }) // 본문은 라인 끝 pending 처리에서 채운다
        pending.push({ index: heredocs.length - 1, delim: d.delim, dash })
        i = d.next // 구분자 뒤로
      }
      wordStart = i
      continue
    }

    // 개행: 논리 라인 종료. 대기 중 here-doc 가 있으면 다음 물리적 줄들을 본문으로 흡수한다.
    if (ch === '\n') {
      out += '\n'
      i++
      if (pending.length > 0) {
        i = captureHereDocBodies(input, i, pending, heredocs)
        pending = []
      }
      wordStart = i
      continue
    }

    // 단어 경계 메타문자 — 원문 복사 + wordStart 리셋(다음 글자가 단어 시작이 되도록).
    if (
      ch === ' ' || ch === '\t' || ch === ';' || ch === '|' || ch === '&' ||
      ch === '<' || ch === '>' || ch === '(' || ch === ')'
    ) {
      out += ch
      i++
      wordStart = i
      continue
    }

    // 그 외 일반 글자 — 단어 진행(wordStart 유지).
    out += ch
    i++
  }

  return { text: out, heredocs }
}

export function tokenize(rawInput: string): Token[] {
  // here-doc pre-pass: 본문을 잘라내고 `<<` 연산자만 남긴 스트림(text)과 본문 배열(heredocs).
  // text 에서 `<<` 를 만날 때마다 hereIndex 로 heredocs 를 순서대로 뽑아 연산자 토큰에 싣는다.
  const { text: input, heredocs } = stripHereDocs(rawInput)
  let hereIndex = 0
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
        if (op === '<<') {
          // pre-pass 가 왼→오로 채운 본문을 같은 순서로 뽑아 싣는다(정렬 보장은 stripHereDocs 주석).
          tokens.push({ type: 'OP', value: '<<', heredoc: heredocs[hereIndex++] })
        } else {
          tokens.push({ type: 'OP', value: op })
        }
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

    // NAME=( ... ) / NAME[sub]=( ... ) 배열 리터럴 대입(M3 Part 3 task 2). `(` 가 대입
    // LHS(`NAME=`/`NAME[..]=`)에 **공백 없이 바로 붙을** 때만 배열이다 — 진행 중인 word 가
    // 그 LHS 한 조각(raw)이면, 짝 맞는 `)` 까지(따옴표·${..} 인식, $(..)/중첩 괄호는 depth
    // 로) 통째로 그 raw 조각에 이어 붙여 `NAME=(...)` 한 WORD 로 만든다. 공백이 끼면
    // (`arr= (..)`) 는 word 가 이미 flush 돼 여기 안 걸리고 아래에서 OP('(') 로 갈린다 —
    // 실제 bash 도 그 경우 배열이 아니다(docker 확인: `arr= (a b c)` → syntax error).
    // 이 분기는 반드시 아래 `(`/`)` 메타문자 분기보다 앞에 둔다 — 안 그러면 `(` 가 OP 로
    // 먼저 새어 배열 캡처가 도달하지 못한다. (렉서는 명령 위치를 모르므로 `echo arr=(x)`
    // 같은 비-대입 위치의 `NAME=(` 도 삼킨다 — 실제 bash 는 문법 오류지만, 퍼즐에 없는
    // obscure edge 이고 "더 관대한" 방향이라 무해하다.)
    if (ch === '(' && word.length === 1 && word[0]!.kind === 'raw' && ARRAY_ASSIGN_LHS_RE.test(word[0]!.text)) {
      const end = matchArrayLiteralEnd(input, i)
      push('raw', input.slice(i, end))
      i = end
      continue
    }

    // ( 와 ) 는 메타문자다 — bash 는 이 둘을 언제나 토큰 경계로 본다(글자에 붙어 있어도).
    // `(echo)`→`(` `echo` `)`, `f()`→`f` `(` `)`, `f(){`→`f` `(` `)` `{`.
    // (docker 확인: `echo a(b` → syntax error near `(`, 즉 ( 가 단어를 끊는다.) 그래서
    // 진행 중이던 단어를 먼저 flush 하고 단일 OP 토큰으로 낸다. 이 분기를 위 `((` 산술
    // 캡처보다 *뒤에* 두는 게 핵심이다 — word-start `((`(예: `(( x > 3 ))`)는 산술 명령
    // 이라 통째로 삼켜야 하고, 여기 도달했다는 건 (a) 두 번째 `(`거나 (b) 단어 중간의 `(`
    // 거나 (c) `( (`처럼 공백으로 갈라진 단일 `(`(중첩 subshell — Task 3)라는 뜻이다.
    // ( 와 ) 만 메타문자다. `{`/`}`는 메타문자가 아니라 예약어라(글자에 붙으면 안 끊는다:
    // `echo a{b`→리터럴 `a{b`) 렉서가 손대지 않고, 기존 RESERVED_WORDS/keywordOf 경로가
    // 단독 단어일 때만 그룹 구분자로 인정한다. `[`/`]`도 메타문자가 아니다(글롭/`[` 빌트인).
    // NOTE(Task 3): 명령 위치의 선행 `(`(subshell)는 아직 파서 규칙이 없어 얌전한 문법
    // 오류로 끝난다 — Task 3 에서 SubshellNode 를 추가한다.
    if (ch === '(' || ch === ')') {
      flush()
      tokens.push({ type: 'OP', value: ch })
      i++
      continue
    }

    push('raw', ch)
    i++
  }

  flush()
  tokens.push({ type: 'EOF' })
  return tokens
}
