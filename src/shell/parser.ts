import { tokenize, type Operator, type Token, type Word, type HereDocBody } from './lexer'
import { matchArrayLiteralEnd } from './subst'

/**
 * 리다이렉션. 파일 계열(`>`/`>>`/`<`)은 확장할 target Word 를, here-doc(`<<`, M3 Part 4 task 5)
 * 은 lexer pre-pass 가 잘라낸 본문(heredoc)을 싣는다 — 판별 유니온이라 interpreter 가
 * `op==='<<'` 를 먼저 걸러내면 나머지는 파일 변형으로 좁혀진다(기존 target 접근이 그대로 안전).
 */
export type Redir =
  | { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; target: Word }
  | { fd: 0; op: '<<'; heredoc: HereDocBody }
/**
 * `NAME=value` 스칼라 대입, `NAME=(a b c)` 배열 리터럴(elements), `NAME[i]=value` 원소
 * 대입(index) 중 하나(M3 Part 3 task 2). 셋은 상호 배타적이다:
 *  - elements 있음 → 배열 리터럴. value 는 빈 Word([]). interpreter 가 각 원소를 expandWord
 *    (단어분할+글롭)로 펴 arrays 에 통째 저장한다.
 *  - index 있음 → 원소 대입. index 는 대괄호 안쪽(확장 전 Word) — interpreter 가 evalArith
 *    로 첨자를 평가한다. value 는 스칼라와 동일(분할/글롭 없는 expandForCase 로 편다).
 *  - 둘 다 없음 → 기존 스칼라 대입.
 *
 * append(M3 Part 4 task 1): `NAME+=…`/`NAME[i]+=…`/`NAME+=(…)` 이면 true. 세 갈래 각각에
 * 대해 interpreter 가 "덮어쓰기" 대신 "기존 값에 이어붙이기"를 한다(스칼라 문자열 연결,
 * 배열 끝에 push, 원소 문자열 연결). 일반 `=` 대입은 이 필드가 아예 없다(undefined) —
 * index?/elements? 와 같은 "해당 없으면 생략" 규약이라 기존 `toEqual` 스냅샷이 안 깨진다.
 */
export interface Assignment { name: string; value: Word; index?: Word; elements?: Word[]; append?: boolean }

export interface CommandNode {
  kind: 'command'
  assignments: Assignment[]
  words: Word[]
  redirs: Redir[]
}

/**
 * `if COND; then BODY; [elif COND; then BODY;]* [else BODY;] fi`.
 * cond/then/else 는 각각 완결된 ListNode 다 — 본문 실행 프리미티브(runList)를 그대로 재사용한다.
 */
export interface IfNode {
  kind: 'if'
  cond: ListNode
  then: ListNode
  elifs: { cond: ListNode; then: ListNode }[]
  else?: ListNode
  redirs: Redir[]
}

/** `while COND; do BODY; done` / `until COND; do BODY; done` (until 이면 조건 반전). */
export interface WhileNode {
  kind: 'while'
  cond: ListNode
  body: ListNode
  until: boolean
  redirs: Redir[]
}

/**
 * `for NAME in WORD*; do BODY; done`. words 는 (아직 확장 전) Word 배열 — runFor 가
 * expandWord 로 각각 펼쳐(단어분리·글롭 포함) var 에 순서대로 대입하며 body 를 돈다.
 */
export interface ForNode {
  kind: 'for'
  var: string
  words: Word[]
  body: ListNode
  redirs: Redir[]
}

/**
 * `case WORD in [ [(] PATTERN [| PATTERN]* ) LIST ;; ]* esac`. word 는 확장 전 원본
 * Word 하나 — runCase 가 case 전용 확장(단어분리·글롭 없음)으로 문자열 하나로 편다.
 * 각 branch 의 patterns 도 Word[] 그대로 보존해(같은 case 전용 확장을 다시 태운 뒤)
 * matchSegment 로 subject 와 맞춰본다. 첫 매치 branch 의 body 를 실행하고 멈춘다
 * (`;&`/`;;&` fallthrough 는 구현하지 않는다).
 */
export interface CaseNode {
  kind: 'case'
  word: Word
  branches: { patterns: Word[]; body: ListNode }[]
  redirs: Redir[]
}

/**
 * `NAME () { LIST; }` / `function NAME [()] { LIST; }`. 함수 정의는 실행 시점에 body 를
 * 돌리지 않고 이름→body(ListNode)를 functions 맵에 등록만 한다(exit 0). body 는 브레이스
 * 그룹의 내부 리스트다 — 정의 자체는 새 실행/파싱 프리미티브 없이 parseList 를 재사용한다.
 */
export interface FunctionDefNode {
  kind: 'funcdef'
  name: string
  body: ListNode
}

/**
 * `{ LIST; }` 브레이스 그룹. 서브셸이 아니라 **현재 ctx** 에서 LIST 를 실행한다(env/cwd
 * 변경이 그대로 남는다 — docker 확인: `{ x=7; }; echo $x` → 7). `( )` 서브셸(아래
 * SubshellNode)은 파싱 구조는 같지만 실행 시 격리된 childCtx 를 쓴다는 점만 다르다.
 */
export interface GroupNode {
  kind: 'group'
  body: ListNode
  redirs: Redir[]
}

/**
 * `( LIST )` 서브셸. GroupNode 와 파싱 구조는 동일(내부에 LIST 하나)하지만, 실행 시
 * **격리된 childCtx** 에서 LIST 를 돈다 — env/cwd 변경은 밖으로 안 새고(docker 확인:
 * `cd /tmp; (cd /; echo $PWD); echo $PWD` → 안 `/`, 밖 `/tmp`), fs 와 budget 은 부모와
 * 공유한다(파일시스템 변경은 실제 부작용이고, 스텝 예산은 무한루프 방어라 서브셸이라고
 * 새로 채워지면 안 된다 — `( while true; do :; done )` 도 공유 예산에 걸려 종료해야 한다).
 *
 * 함수 정의도 격리 대상이다: 서브셸은 부모의 함수를 전부 **상속**해서 보되(공유 참조가
 * 아니라 시작 시점의 스냅샷), 서브셸 안에서 정의한 함수는 밖으로 안 샌다 — docker 확인:
 * `f(){ echo hi; }; ( f; g(){ echo g; }; g ); g` → hi, g, 그리고 마지막 `g` 는
 * command not found(안 샘). interpreter 의 childCtx 에 `copyFunctions` 옵션을 추가해
 * 처리한다(공유 참조도, isolateFunctions 의 새 빈 Map 도 아닌 **복사본**).
 */
export interface SubshellNode {
  kind: 'subshell'
  body: ListNode
  redirs: Redir[]
}

/**
 * `(( expr ))` 산술 명령(standalone, task 2). expr 은 lexer 가 통째로 삼킨 원문에서 바깥
 * `((`/`))` 를 벗겨낸 안쪽 텍스트 그대로다(파싱 전) — interpreter 가 evalArith(Task 1의
 * 산술 평가기)에 그대로 넘긴다. bash 산술-명령 규약: 결과 ≠ 0 이면 exit 0(참), 0 이면
 * exit 1(거짓). `for (( ))` C-스타일 루프는 이 태스크 범위 밖(스탠드얼론 `(( ))`만).
 */
export interface ArithCmdNode {
  kind: 'arith'
  expr: string
}

/**
 * 파이프라인의 한 단계가 될 수 있는 명령. 단순 명령 + 복합 명령의 유니온이다.
 * `kind` 로 판별한다.
 */
export type Command =
  | CommandNode
  | IfNode
  | WhileNode
  | ForNode
  | CaseNode
  | FunctionDefNode
  | GroupNode
  | ArithCmdNode
  | SubshellNode

export interface PipelineNode { kind: 'pipeline'; commands: Command[] }

export interface ListNode {
  kind: 'list'
  items: { op: ';' | '&&' | '||' | null; pipeline: PipelineNode }[]
}

const REDIR_OPS: Operator[] = ['>', '>>', '<', '<<', '2>', '2>>']
// NAME= 접두사는 첫 조각(word[0])이 raw 일 때만 인식한다. 값 뒤쪽은 어떤 조각이든 허용한다.
// 선택적 `[subscript]` 그룹(m[2])으로 원소 대입 `NAME[i]=value` 도 받는다(M3 Part 3 task 2).
// 선택적 `+` 그룹(m[3], M3 Part 4 task 1)이 있으면 append 대입(`NAME+=`/`NAME[i]+=`)이다 —
// 단일 리터럴 옵션이라 구조적(ReDoS 없음)이고 값 안의 `+=`(x=a+=b)는 이미 첫 `=` 에서
// 쪼개지므로 안 건드린다. 그룹 인덱스: m[1]=NAME, m[2]=`[...]`(있으면), m[3]=`+`(있으면), m[4]=값.
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+)?=(.*)$/s

function syntaxError(near: string): never {
  throw new Error(`syntax error near \`${near}'`)
}

/**
 * bash 예약어. 여기 뒤 태스크(7)에서 function 등이 더해진다.
 * 이 집합에 있는 단어만 "명령 위치의 bare 단어"일 때 예약어로 인정된다.
 */
const RESERVED_WORDS = new Set([
  'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done', 'for', 'in', 'case', 'esac',
  'function', '{', '}',
])

// 함수 정의 이름으로 쓸 수 있는 식별자. `NAME`, `NAME(`, `NAME()` 판정에 공유한다.
const FUNC_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 단어가 "raw 조각 하나짜리 bare 단어"면 그 텍스트를, 아니면 null 을 준다. 따옴표가
 * 섞이면(literal/dquote 조각) null — 렉서가 따옴표 없는 텍스트를 raw 조각 하나로
 * 합치므로(같은 kind 끼리 병합), 따옴표 없이 이어진 단어만 이 형태가 된다.
 * keywordOf(예약어 판정)와 parseFor(NAME 추출)가 공유하는 판정이다 — tryAssignment 가
 * `word[0].kind === 'raw'` 로 NAME= 를 가리는 것과 같은 원리다.
 */
function bareWord(word: Word): string | null {
  if (word.length !== 1) return null
  const part = word[0]!
  return part.kind === 'raw' ? part.text : null
}

/**
 * 단어가 bash 예약어인지 판정하고, 맞으면 그 텍스트를, 아니면 null 을 준다.
 *
 * 예약어는 (1) 명령 위치이고 (2) bareWord 형태(따옴표 없이 통째로 그 예약어 텍스트)일
 * 때만 예약어다. `echo if` 의 if(인자)나 `'if'`/`"if"`(따옴표)는 예약어가 아니다.
 * "명령 위치"인지는 호출부가 책임진다(parseCommandOrCompound 와 parseList 의 각
 * 아이템 첫 토큰, 그리고 parseFor 의 단어-목록 루프에서만 keywordOf 를 본다).
 */
function keywordOf(word: Word): string | null {
  const text = bareWord(word)
  return text !== null && RESERVED_WORDS.has(text) ? text : null
}

/**
 * 단어가 `NAME=값` 형태의 대입인지 판정한다.
 *
 * bash 규칙: NAME= 부분이 따옴표 없이 통째로 이어져 있어야 대입으로 인정된다.
 * 값 부분은 따옴표가 섞여도 상관없다 — `X="a b"`, `X=a"b"c` 모두 대입이다.
 * 렉서는 같은 종류의 조각을 항상 병합하므로(raw+raw는 절대 안 남는다), NAME= 가
 * 따옴표 없이 이어지면 반드시 word[0] 하나의 raw 조각 안에 전부 들어있다.
 * word[0] 이 raw 가 아니거나, 그 조각 안에 `NAME=` 형태가 없으면 대입이 아니다.
 *
 * 값(Word)은 원래 조각 구조(및 그 kind 태그)를 그대로 보존해서 만든다 — 이후
 * 단계(확장기)가 따옴표 여부를 알아야 하기 때문에, 문자열로 뭉개면 안 된다.
 */
function tryAssignment(word: Word): Assignment | null {
  const first = word[0]
  if (!first || first.kind !== 'raw') return null
  const m = ASSIGN_RE.exec(first.text)
  if (!m) return null
  const name = m[1]!
  const subscript = m[2] // '[...]' 또는 undefined
  const append = m[3] === '+' // '+' 있으면 append 대입(M3 Part 4)
  const restOfFirst = m[4]!

  // 스칼라/원소 대입의 값 Word: 첫 조각의 나머지(raw) + 뒤 조각들(따옴표 구조 보존).
  const scalarValue = (): Word => {
    const value: Word = []
    if (restOfFirst.length > 0) value.push({ kind: 'raw', text: restOfFirst })
    value.push(...word.slice(1))
    return value
  }

  // append 는 true 일 때만 필드를 얹는다(일반 `=` 는 생략 — index?/elements? 와 같은 규약).
  const appendFlag = append ? { append: true } : {}

  // NAME[subscript]=value — 원소 대입. index 는 대괄호 안쪽을 확장 전 Word(raw 하나)로
  // 보존한다(interpreter 가 evalArith 로 첨자를 평가 — `$i`/`1+1` 모두). value 는 스칼라와
  // 동일한 구조다.
  if (subscript !== undefined) {
    return { name, value: scalarValue(), index: [{ kind: 'raw', text: subscript.slice(1, -1) }], ...appendFlag }
  }

  // NAME=( ... ) — 배열 리터럴. 렉서가 인접 배열을 raw 조각 하나로 통째 삼켰으므로
  // (word.length===1) restOfFirst 는 `(...)` 형태다. 짝 맞는 `)` 가 **정확히 끝**일 때만
  // 배열이다 — 뒤에 텍스트가 붙으면(`arr=(a b)x`) bash 는 스칼라로 본다(docker 확인:
  // arr="(a b)x"). 원소는 안쪽 텍스트를 재-토큰화해 얻는다(따옴표/치환 구조는 tokenize 가
  // 그대로 복원한다 — `"1 2"`→dquote, `$(..)`→raw). 원소별 확장(단어분할+글롭)은 interpreter.
  if (word.length === 1 && restOfFirst.startsWith('(')) {
    let end = -1
    try { end = matchArrayLiteralEnd(restOfFirst, 0) } catch { end = -1 }
    if (end === restOfFirst.length) {
      const elements: Word[] = []
      for (const t of tokenize(restOfFirst.slice(1, -1))) {
        if (t.type === 'WORD') elements.push(t.word)
      }
      return { name, value: [], elements, ...appendFlag }
    }
  }

  return { name, value: scalarValue(), ...appendFlag }
}

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]! }

  private next(): Token { return this.tokens[this.pos++]! }

  private atOp(...ops: Operator[]): boolean {
    const t = this.peek()
    return t.type === 'OP' && ops.includes(t.value)
  }

  /**
   * 연속된 선행 `;` 분리자를 건너뛴다 (task 5b).
   *
   * 렉서는 개행을 무조건 `;` 로 접기 때문에(task 1), bash 문법에서 `do`/`then`/`else`/`in`
   * 바로 뒤의 개행(newline_list — 허용, 무시되는 자리)이 우리 토큰 스트림에서는 명령
   * 분리자 `;` 와 구분 없이 똑같은 OP(';') 토큰이 된다. 그래서 본문이 다음 줄에서
   * 시작하는 이디엄적인 형태(`do\n  echo x\ndone`)가 "선행 ;" 로 보여 parseList 가
   * 문법 오류를 냈다. 이 헬퍼를 그 4개 지점(then-분기/elif-then/else-분기/do-본문/
   * in-단어목록) 시작 직전에 호출해 선행 `;`(개행이 접힌 것이든 진짜 `;`든 — 렉서
   * 토큰 단계에서는 이미 구분이 안 된다)를 무시한다. 실제 bash는 개행 유래는
   * 받아주고 진짜 `;`(`do; echo x`)는 문법 오류로 거부하지만, 그 구분을 하려면
   * 렉서에 NEWLINE 전용 토큰을 새로 두는 재작업이 필요하다 — 여기서는 대신 두
   * 경우 다 관대하게 받아준다(학습용 셸에 무해한 확장, Task 4/5의 다른 관대한
   * 허용들과 같은 성격). 오직 "더 받아주는" 방향으로만 느슨해지므로 기존에 통과하던
   * 파싱은 전부 동일한 AST 를 그대로 낸다.
   */
  private skipSeparators(): void {
    while (this.atOp(';')) this.next()
  }

  /** 현재 토큰이 명령 위치의 bare 예약어면 그 텍스트, 아니면 null. */
  private peekKeyword(): string | null {
    const t = this.peek()
    return t.type === 'WORD' ? keywordOf(t.word) : null
  }

  /**
   * 현재 토큰이 lexer 가 통째로 삼킨 `(( expr ))` 단위(단일 raw 조각, `((`로 시작하고
   * `))`로 끝남)면 안쪽 expr 텍스트를, 아니면 null 을 준다. bareWord 와 같은 원리로
   * 따옴표 없이 통째로 이어진 raw 조각 하나일 때만 인정한다(lexer 가 항상 그렇게 만든다 —
   * matchDoubleParenEnd 로 짝을 찾아 한 raw 조각으로 push 하므로).
   */
  private peekArithExpr(): string | null {
    const t = this.peek()
    if (t.type !== 'WORD') return null
    const text = bareWord(t.word)
    if (text === null || text.length < 4 || !text.startsWith('((') || !text.endsWith('))')) return null
    return text.slice(2, -2)
  }

  /** 다음 토큰이 정확히 이 예약어이길 요구하고 소비한다. 아니면 문법 오류. */
  private expectKeyword(kw: string): void {
    if (this.peekKeyword() !== kw) {
      const t = this.peek()
      syntaxError(t.type === 'EOF' ? kw : t.type === 'OP' ? t.value : (this.peekKeyword() ?? kw))
    }
    this.next()
  }

  /**
   * 리스트를 파싱한다. stopWords 가 주어지면, 각 아이템 시작 지점에서 종료 예약어
   * (then/fi/do/done/elif/else 등)를 만나면 그 토큰을 소비하지 않고 멈춘다 — 복합 명령
   * 파서가 그 종료어를 이어서 처리한다. stopWords 가 비면(=top-level) 예전처럼 EOF 까지
   * 전부 소비하고, 남는 토큰이 있으면 문법 오류를 낸다.
   *
   * stopOps(task 6)는 종료 예약어와 같은 역할을 하되 OP 토큰(`;;`)을 본다 — case 문의
   * branch body 는 `esac` 예약어뿐 아니라 `;;` 로도 끝날 수 있어서다. 기본값 `[]` 라
   * 기존 호출부(if/while/for)는 동작이 전혀 안 바뀐다.
   */
  parseList(stopWords?: Set<string>, stopOps: Operator[] = []): ListNode {
    const items: ListNode['items'] = []
    const stops = stopWords
    const atStop = (): boolean => {
      if (stopOps.length > 0 && this.atOp(...stopOps)) return true
      if (!stops || stops.size === 0) return false
      const kw = this.peekKeyword()
      return kw !== null && stops.has(kw)
    }

    const first = this.peek()
    if (first.type === 'EOF') return { kind: 'list', items }
    // 종료 예약어로 시작하면 빈 본문이다 (예: `if true; then; fi` — bash 는 이걸 문법
    // 오류로 보지만, 여기선 빈 리스트를 돌려주고 복합 파서가 종료어를 소비하게 둔다).
    if (atStop()) return { kind: 'list', items }
    // 리스트/파이프라인 연결자로 시작하는 건 항상 문법 오류다 (`; ls`, `&& ls`, `| ls`).
    // 리다이렉션 연산자(`>`, `2>`, ...)로 시작하는 건 괜찮다 — bash 는 `> out` 처럼
    // 명령 없는 리다이렉션 단독도 유효한 단순 명령으로 받아들인다 (exit 0, 파일만 생성).
    // `(` 로 시작하는 것도 괜찮다(task 3) — 서브셸(`( list )`)이 정당한 명령 위치의
    // 시작이다(parseCommandOrCompound 가 라우팅한다). `)` 는 여전히 여기서 걸러진다 —
    // 짝이 맞지 않는 `)` 로 리스트가 시작하는 건 어떤 문맥에서도 문법 오류다.
    // 그 구분을 parseCommand 에 맡기지 않고 여기서 하는 이유는, 안 그러면
    // parseCommand 가 "빈 명령" 에러를 내면서 사용자에게 엉뚱한 위치를 알려주기 때문이다.
    if (first.type === 'OP' && first.value !== '(' && !REDIR_OPS.includes(first.value)) syntaxError(first.value)

    items.push({ op: null, pipeline: this.parsePipeline() })

    while (this.atOp(';', '&&', '||')) {
      const op = (this.next() as { value: ';' | '&&' | '||' }).value
      if (this.peek().type === 'EOF') {
        if (op === ';') break // 후행 세미콜론은 허용
        syntaxError(op)
      }
      // 세미콜론 뒤에 종료 예약어가 오면(정상: `true; then`, `echo x; done`) 여기서 멈추고
      // 종료어를 복합 파서에게 넘긴다. `&&`/`||` 뒤의 종료어는 오른쪽 피연산자가 없어 오류.
      if (atStop()) {
        if (op === ';') break
        syntaxError(op)
      }
      items.push({ op, pipeline: this.parsePipeline() })
    }

    if ((!stops || stops.size === 0) && stopOps.length === 0) {
      // top-level 리스트는 반드시 EOF 까지 소비해야 한다.
      if (this.peek().type !== 'EOF') syntaxError('unexpected token')
    } else if (!atStop()) {
      // 하위 리스트는 반드시 자신의 종료 예약어/종료 연산자에서 끝나야 한다 (fi/done/`)`
      // 전에 EOF 면 미완성). stopOps 는 stopWords 없이 단독으로도 쓰인다 — 서브셸
      // (`parseSubshell`)이 종료 예약어 없이 오직 `)` 하나로만 본문을 끊는 경우가 그렇다.
      syntaxError(this.peek().type === 'EOF' ? 'unexpected EOF' : 'unexpected token')
    }
    return { kind: 'list', items }
  }

  private parsePipeline(): PipelineNode {
    const commands: Command[] = [this.parseCommandOrCompound()]
    while (this.atOp('|')) {
      this.next()
      if (this.peek().type === 'EOF') syntaxError('|')
      commands.push(this.parseCommandOrCompound())
    }
    return { kind: 'pipeline', commands }
  }

  /**
   * 첫 토큰이 bare 예약어(if/while/until/for/case/function/`{`)면 복합 명령, 아니면 단순
   * 명령. 단, `function` 예약어가 없어도 `NAME ()` 형태(첫 단어 뒤에 `()`)면 함수 정의로
   * 분기한다 — matchFuncDefName 이 토큰을 소비하지 않고 앞을 훑어 판정한다.
   *
   * `(( expr ))` (task 2)도 여기서 가장 먼저 가로챈다 — lexer 가 이미 한 단위(raw 조각
   * 하나)로 통째로 삼켰으므로, 예약어 판정보다 먼저 봐도(peekArithExpr 은 keywordOf 와
   * 겹치지 않는다 — `((`로 시작하는 예약어가 없다) 안전하고, 함수정의 판정(matchFuncDefName)
   * 보다 먼저 봐야 `((1))`처럼 함수이름 정규식에 안 걸리는 텍스트가 엉뚱하게 단순 명령으로
   * 새지 않는다.
   *
   * 명령 위치의 단일 `(` (task 3, 서브셸)도 arithExpr/keyword/funcdef 판정과 겹치지 않아
   * 안전하게 가장 먼저 본다 — `(`는 OP 토큰이라 WORD 기반인 peekArithExpr/peekKeyword/
   * matchFuncDefName(rawAt(0)) 어느 것도 이 토큰에 매치되지 않는다(전부 null 을 준다).
   * `(( expr ))`는 렉서가 이미 한 WORD 로 통째로 삼키므로 여기 도달하지 않는다 — 도달하는
   * `(`는 항상 진짜 단일 여는 괄호(서브셸 시작 또는 중첩 서브셸의 바깥 `(`)다.
   */
  private parseCommandOrCompound(): Command {
    if (this.atOp('(')) return this.parseSubshell()
    const arithExpr = this.peekArithExpr()
    if (arithExpr !== null) {
      this.next()
      return { kind: 'arith', expr: arithExpr }
    }
    switch (this.peekKeyword()) {
      case 'if': return this.parseIf()
      case 'while': return this.parseWhile(false)
      case 'until': return this.parseWhile(true)
      case 'for': return this.parseFor()
      case 'case': return this.parseCase()
      case 'function': return this.parseFunctionKeyword()
      case '{': return this.parseGroup()
      default: {
        const fd = this.matchFuncDefName()
        if (fd) {
          for (let k = 0; k < fd.consume; k++) this.next()
          return this.finishFunctionDef(fd.name)
        }
        return this.parseCommand()
      }
    }
  }

  /**
   * 현재 위치가 `NAME ()` (함수 정의 헤더)로 시작하는지 토큰을 소비하지 않고 앞을 훑어
   * 판정한다. task 2 에서 `(`/`)` 를 메타문자로 토큰화한 뒤로는 공백 유무와 무관하게
   * 언제나 같은 세 토큰 열이다 — `f()`·`f ()`·`f( )`·`f ( )` 전부:
   *   WORD(NAME)  OP( `(` )  OP( `)` )                     (consume 3)
   * (예전 M2 의 4형식 문자열 수술은 `(`/`)` 가 raw 로 흡수돼 스페이싱마다 토큰이 갈라졌기
   * 때문이었다 — 이제 렉서가 항상 별도 토큰으로 끊으므로 한 형태로 수렴한다.)
   * 매치되면 {name, consume(토큰 수)} 를, 아니면 null 을 준다(→ 일반 단순 명령).
   */
  private matchFuncDefName(): { name: string; consume: number } | null {
    const name = this.rawAt(0)
    if (name === null || !FUNC_NAME_RE.test(name)) return null
    const t1 = this.tokens[this.pos + 1]
    const t2 = this.tokens[this.pos + 2]
    const isParen = (t: Token | undefined, v: '(' | ')'): boolean => t !== undefined && t.type === 'OP' && t.value === v
    if (isParen(t1, '(') && isParen(t2, ')')) return { name, consume: 3 }
    return null
  }

  /** pos+offset 토큰이 raw 조각 하나짜리 WORD 면 그 텍스트, 아니면 null. */
  private rawAt(offset: number): string | null {
    const t = this.tokens[this.pos + offset]
    return t && t.type === 'WORD' ? bareWord(t.word) : null
  }

  /**
   * `function` 예약어로 시작하는 함수 정의. bash 는 이 형태에서 `()` 를 생략할 수 있다
   * (`function hi { ...; }`) — docker 확인. `()` 가 있으면(`function hi() { ...; }`)
   * matchFuncDefName 이 이름과 함께 소비한다.
   */
  private parseFunctionKeyword(): FunctionDefNode {
    this.expectKeyword('function')
    const fd = this.matchFuncDefName()
    let name: string
    if (fd) {
      name = fd.name
      for (let k = 0; k < fd.consume; k++) this.next()
    } else {
      const nm = this.rawAt(0)
      if (nm === null || !FUNC_NAME_RE.test(nm)) syntaxError('function')
      name = nm
      this.next()
    }
    return this.finishFunctionDef(name)
  }

  /**
   * 함수 이름과 `()` 를 소비한 뒤(호출부 책임), body 브레이스 그룹을 읽어 노드를 만든다.
   * `()` 와 `{` 사이의 개행-유래 `;`(예: `f()\n{ ... }`) 는 skipSeparators() 로 걷어낸다
   * (docker 확인: 멀티라인 정의 유효). body 는 반드시 브레이스 그룹이어야 한다 — bash 는
   * 다른 복합 명령도 body 로 받지만, 이 태스크는 `{ }` 그룹으로 한정한다.
   */
  private finishFunctionDef(name: string): FunctionDefNode {
    this.skipSeparators()
    if (this.peekKeyword() !== '{') syntaxError('{')
    return { kind: 'funcdef', name, body: this.parseBraceGroupList() }
  }

  /**
   * `{ LIST; }` 의 내부 LIST 를 읽는다(중괄호 소비 포함). 그룹/함수 body 가 공유한다.
   * 본문이 비어 있으면(`{ }`/`{ ; }`) 문법 오류다(M3 Part 4 task 4 B9) — bash 의
   * compound_list 문법은 항상 ≥1 항목을 요구한다(docker: `{ }` → exit 2 "syntax error
   * near unexpected token `}'", `f() { }` 도 동일 — 이 함수를 funcdef 도 공유하므로
   * 자동으로 같이 고쳐진다). `{ ; }`는 skipSeparators() 가 그 `;`를 먼저 삼켜 `{ }`와
   * 똑같이 "빈 리스트"로 수렴하므로 이 한 번의 길이 검사로 둘 다 잡힌다.
   */
  private parseBraceGroupList(): ListNode {
    this.expectKeyword('{')
    this.skipSeparators()
    const body = this.parseList(new Set(['}']))
    if (body.items.length === 0) syntaxError('}')
    this.expectKeyword('}')
    return body
  }

  private parseGroup(): GroupNode {
    const body = this.parseBraceGroupList()
    return { kind: 'group', body, redirs: this.parseRedirs() }
  }

  /**
   * `( LIST )` 서브셸(task 3). parseBraceGroupList(`{ }`)와 구조가 같다 — 여는 토큰을
   * 소비하고, 선행 개행-유래 `;`를 skipSeparators() 로 걷어낸 뒤, 본문을 parseList 로
   * 읽고, 닫는 토큰을 소비한다. `{ }`와 다른 점은 딱 하나: 종료를 종료 *예약어*(`}`)가
   * 아니라 종료 *연산자*(`)`, task 2 에서 렉서가 이미 OP 토큰으로 만들어둔 메타문자)로
   * 본다는 것 — 그래서 stopWords 없이 stopOps=[')'] 만 parseList 에 넘긴다(위 parseList
   * 끝의 stopOps-단독 분기가 이 호출을 지원하도록 손봤다). 닫는 `)`가 없으면(EOF 까지
   * 감) parseList 가 이미 "unexpected EOF" 문법 오류를 낸다 — 여기서 별도 처리가 필요
   * 없다.
   *
   * 본문이 비어 있으면(`( )`/`( ; )`) 문법 오류다(M3 Part 4 task 4 B9) — parseBraceGroupList
   * 와 같은 이유·같은 패턴(docker: `( )` → exit 2 "syntax error near unexpected token
   * `)'"). `( ; )`도 선행 skipSeparators() 가 `;`를 삼켜 `( )`와 같은 빈 리스트로 수렴한다.
   */
  private parseSubshell(): SubshellNode {
    this.next() // '(' 소비
    this.skipSeparators()
    const body = this.parseList(undefined, [')'])
    if (body.items.length === 0) syntaxError(')')
    this.expectOp(')')
    return { kind: 'subshell', body, redirs: this.parseRedirs() }
  }

  /** 다음 토큰이 정확히 이 연산자이길 요구하고 소비한다. 아니면 문법 오류. */
  private expectOp(op: Operator): void {
    if (!this.atOp(op)) {
      const t = this.peek()
      syntaxError(t.type === 'EOF' ? op : t.type === 'OP' ? t.value : (this.peekKeyword() ?? 'unexpected token'))
    }
    this.next()
  }

  private parseIf(): IfNode {
    this.expectKeyword('if')
    const cond = this.parseList(new Set(['then']))
    this.expectKeyword('then')
    this.skipSeparators()
    const thenList = this.parseList(new Set(['elif', 'else', 'fi']))

    const elifs: { cond: ListNode; then: ListNode }[] = []
    while (this.peekKeyword() === 'elif') {
      this.expectKeyword('elif')
      const elifCond = this.parseList(new Set(['then']))
      this.expectKeyword('then')
      this.skipSeparators()
      const elifThen = this.parseList(new Set(['elif', 'else', 'fi']))
      elifs.push({ cond: elifCond, then: elifThen })
    }

    let elseList: ListNode | undefined
    if (this.peekKeyword() === 'else') {
      this.expectKeyword('else')
      this.skipSeparators()
      elseList = this.parseList(new Set(['fi']))
    }

    this.expectKeyword('fi')
    return { kind: 'if', cond, then: thenList, elifs, else: elseList, redirs: this.parseRedirs() }
  }

  private parseWhile(until: boolean): WhileNode {
    this.expectKeyword(until ? 'until' : 'while')
    const cond = this.parseList(new Set(['do']))
    this.expectKeyword('do')
    this.skipSeparators()
    const body = this.parseList(new Set(['done']))
    this.expectKeyword('done')
    return { kind: 'while', cond, body, until, redirs: this.parseRedirs() }
  }

  /**
   * `for NAME in WORD*; do BODY; done`. NAME 은 raw 조각 하나짜리 bare 단어(keywordOf 와
   * 같은 판정 원리)여야 한다. `in` 뒤의 단어 목록은 (단순 명령의 인자 목록과 달리) `do`
   * 예약어를 만나면 멈춘다 — `;`/개행(렉서가 `;` 로 접어줌)이 있으면 그것도 소비하고
   * 없어도(직접 `do` 로 이어져도) 멈춘다. body 는 기존 parseList(stopWords={done}) 를
   * 그대로 재사용한다. positional 기반의 `for NAME; do ...`(in 생략)은 이 태스크
   * 범위 밖이라 지원하지 않는다 — `in` 이 없으면 문법 오류.
   */
  private parseFor(): ForNode {
    this.expectKeyword('for')

    const nameTok = this.peek()
    const varName = nameTok.type === 'WORD' ? bareWord(nameTok.word) : null
    if (varName === null) syntaxError('for')
    this.next()

    this.expectKeyword('in')
    this.skipSeparators()

    const words: Word[] = []
    while (this.peek().type === 'WORD' && this.peekKeyword() !== 'do') {
      const t = this.next()
      if (t.type === 'WORD') words.push(t.word)
    }

    if (this.atOp(';')) this.next()
    this.expectKeyword('do')
    this.skipSeparators()
    const body = this.parseList(new Set(['done']))
    this.expectKeyword('done')
    return { kind: 'for', var: varName, words, body, redirs: this.parseRedirs() }
  }

  /**
   * `case WORD in [ [(] PATTERN [| PATTERN]* ) LIST ;; ]* esac`. WORD 는 단어 하나여야
   * 한다(단순 명령의 인자처럼 여러 단어를 받지 않는다). branch 마다 patterns 를
   * parseCasePatterns 로 얻고, body 는 `esac`(다음 branch 시작 없이 바로 끝) 또는
   * `;;`(이 branch 종료, 다음 branch 로) 에서 멈추도록 parseList 에 stopOps=[';;']를
   * 준다. 마지막 branch 의 `;;` 는 생략 가능 — 있으면 소비하고, 없으면(body 가 `esac`
   * 에서 바로 멈췄으면) 아무것도 안 한다. `;;`/`esac` 뒤에 남는 개행-유래 `;`(예:
   * `;;\nesac`)는 skipSeparators() 로 걷어낸다(task 5b 와 같은 관대함 원칙).
   */
  private parseCase(): CaseNode {
    this.expectKeyword('case')
    const wordTok = this.peek()
    if (wordTok.type !== 'WORD') syntaxError('case')
    this.next()
    const word = wordTok.word

    this.expectKeyword('in')
    this.skipSeparators()

    const branches: { patterns: Word[]; body: ListNode }[] = []
    while (this.peekKeyword() !== 'esac') {
      const patterns = this.parseCasePatterns()
      this.skipSeparators()
      const body = this.parseList(new Set(['esac']), [';;'])
      if (this.atOp(';;')) this.next()
      this.skipSeparators()
      branches.push({ patterns, body })
    }
    this.expectKeyword('esac')
    return { kind: 'case', word, branches, redirs: this.parseRedirs() }
  }

  /**
   * 한 branch 의 `[(] PATTERN [| PATTERN]* )` 를 읽는다. task 2 에서 `(`/`)` 를 메타문자로
   * 토큰화한 뒤로는 문자열 수술 없이 토큰을 직접 소비한다: 선택적 여는 OP `(` 하나를 먼저
   * 걷어내고, 각 PATTERN(WORD)을 읽되 OP `|` 면 다음 패턴으로 이어가고 OP `)` 면 종료한다.
   * `|` 는 (case 밖에서 파이프 연산자와 같은 렉서 토큰이지만) 이 자리에선 패턴 구분자로
   * 읽는다 — 문법 위치로 구분되는 건 bash 도 동일하다. 글롭 브래킷 `[a-z])` 은 `[`/`]`가
   * 메타문자가 아니라 WORD `[a-z]` + OP `)` 로 자연히 갈라진다(docker 확인).
   */
  private parseCasePatterns(): Word[] {
    const patterns: Word[] = []
    // 선택적 여는 `(` (예: `(a)`, `(a|b)`) — bash 에서 생략 가능하고 무시된다.
    if (this.atOp('(')) this.next()

    for (;;) {
      const t = this.next()
      if (t.type !== 'WORD') syntaxError(t.type === 'OP' ? t.value : 'esac')
      patterns.push(t.word)

      if (this.atOp('|')) { this.next(); continue }
      if (this.atOp(')')) { this.next(); break }
      syntaxError(')')
    }

    if (patterns.length === 0) syntaxError(')')
    return patterns
  }

  /**
   * 현재 토큰(REDIR_OPS 중 하나여야 함 — 호출부가 확인)을 하나의 Redir 로 소비한다.
   * `2>`/`2>>` → fd 2, `<` → fd 0, 나머지 → fd 1. 대상이 WORD 가 아니면 문법 오류.
   * 단순 명령(parseCommand, 단어 사이 섞임)과 복합 명령(parseRedirs, 종결어 뒤)이 공유해
   * 리다이렉션 파싱 규칙이 한 곳에만 있게 한다.
   */
  private parseOneRedir(): Redir {
    const t = this.next() as { type: 'OP'; value: Operator; heredoc?: HereDocBody }
    // here-doc: 대상 WORD 를 소비하지 않는다 — 본문은 lexer pre-pass 가 이미 잘라내 연산자
    // 토큰(heredoc)에 실어뒀다. heredoc 이 없으면(정렬 어긋남 등 방어) graceful 문법 오류.
    if (t.value === '<<') {
      if (!t.heredoc) syntaxError('<<')
      return { fd: 0, op: '<<', heredoc: t.heredoc }
    }
    const target = this.peek()
    if (target.type !== 'WORD') syntaxError(t.value)
    this.next()
    const fd = t.value.startsWith('2') ? 2 : t.value === '<' ? 0 : 1
    const op = t.value === '<' ? '<' : t.value.endsWith('>>') ? '>>' : '>'
    return { fd, op, target: target.word }
  }

  /**
   * 복합 명령의 종결어(`done`/`fi`/`esac`/`}`/`)`) 뒤에 이어지는 리다이렉션들을 0개 이상
   * 모은다 (`for..done > o 2> e`, `{ }<f` 등, task 5). 리다이렉션 연산자가 안 나오면 빈
   * 배열을 돌려주므로 기존 redir 없는 복합 명령은 동작이 전혀 안 바뀐다.
   */
  private parseRedirs(): Redir[] {
    const redirs: Redir[] = []
    while (this.atOp(...REDIR_OPS)) redirs.push(this.parseOneRedir())
    return redirs
  }

  private parseCommand(): CommandNode {
    const cmd: CommandNode = { kind: 'command', assignments: [], words: [], redirs: [] }
    let sawWord = false

    for (;;) {
      const t = this.peek()

      if (t.type === 'OP' && REDIR_OPS.includes(t.value)) {
        cmd.redirs.push(this.parseOneRedir())
        continue
      }

      if (t.type !== 'WORD') break

      this.next()
      // 첫 단어가 나오기 전의 FOO=bar 만 대입이다.
      if (!sawWord) {
        const assignment = tryAssignment(t.word)
        if (assignment) {
          cmd.assignments.push(assignment)
          continue
        }
      }
      sawWord = true
      cmd.words.push(t.word)
    }

    if (cmd.words.length === 0 && cmd.assignments.length === 0 && cmd.redirs.length === 0) {
      syntaxError('unexpected token')
    }
    return cmd
  }
}

export function parse(input: string): ListNode {
  return new Parser(tokenize(input)).parseList()
}
