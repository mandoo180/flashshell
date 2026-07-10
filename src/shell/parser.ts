import { tokenize, type Operator, type Token, type Word } from './lexer'

export interface Redir { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; target: Word }
export interface Assignment { name: string; value: Word }

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
}

/** `while COND; do BODY; done` / `until COND; do BODY; done` (until 이면 조건 반전). */
export interface WhileNode {
  kind: 'while'
  cond: ListNode
  body: ListNode
  until: boolean
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
 * 변경이 그대로 남는다 — docker 확인: `{ x=7; }; echo $x` → 7). `( )` 서브셸 그룹은 3층
 * 이라 이 태스크 범위 밖이다.
 */
export interface GroupNode {
  kind: 'group'
  body: ListNode
}

/**
 * 파이프라인의 한 단계가 될 수 있는 명령. 단순 명령 + 복합 명령의 유니온이다.
 * `kind` 로 판별한다.
 */
export type Command = CommandNode | IfNode | WhileNode | ForNode | CaseNode | FunctionDefNode | GroupNode

export interface PipelineNode { kind: 'pipeline'; commands: Command[] }

export interface ListNode {
  kind: 'list'
  items: { op: ';' | '&&' | '||' | null; pipeline: PipelineNode }[]
}

const REDIR_OPS: Operator[] = ['>', '>>', '<', '2>', '2>>']
// NAME= 접두사는 첫 조각(word[0])이 raw 일 때만 인식한다. 값 뒤쪽은 어떤 조각이든 허용한다.
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s

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
  const restOfFirst = m[2]!
  const value: Word = []
  if (restOfFirst.length > 0) value.push({ kind: 'raw', text: restOfFirst })
  value.push(...word.slice(1))
  return { name, value }
}

/**
 * case 패턴의 선택적 여는 `(` 를 뗀다 — `(h*)` 처럼 렉서가 `(` 를 별도 토큰으로 안
 * 내고(`(`/`)` 는 OPERATORS 에 없다 — 그냥 raw 글자로 흡수된다) 첫 raw 조각 맨 앞에
 * 붙는다. 떼고 나서 그 조각이 비면 통째로 지운다(순수 `(` 하나뿐이던 토큰이었단 뜻 —
 * 이땐 호출부가 다음 토큰을 진짜 첫 패턴으로 다시 읽는다). raw 가 아닌 조각으로
 * 시작하면(따옴표) 손대지 않는다 — 여는 `(` 는 항상 따옴표 밖에 있다.
 */
function stripLeadingParen(word: Word): Word {
  const first = word[0]
  if (!first || first.kind !== 'raw' || !first.text.startsWith('(')) return word
  const text = first.text.slice(1)
  return text.length > 0 ? [{ kind: 'raw' as const, text }, ...word.slice(1)] : word.slice(1)
}

/**
 * case 패턴의 닫는 `)` 를 뗀다. `)` 도 `(` 와 마찬가지로 별도 토큰이 아니라 마지막
 * raw 조각 끝에 붙는다(예: `h*)`, `dog)`). 마지막 조각이 raw 이고 `)` 로 끝나면
 * 떼어내고 hasParen=true. 그 외(따옴표로 끝나거나 `)` 가 없음)엔 손대지 않고
 * hasParen=false — 호출부가 다음 토큰에서 alternation(`|`) 이나 단독 `)` 를 더 찾는다.
 */
function splitTrailingParen(word: Word): { core: Word; hasParen: boolean } {
  const last = word[word.length - 1]
  if (!last || last.kind !== 'raw' || !last.text.endsWith(')')) return { core: word, hasParen: false }
  const text = last.text.slice(0, -1)
  const core = text.length > 0 ? [...word.slice(0, -1), { kind: 'raw' as const, text }] : word.slice(0, -1)
  return { core, hasParen: true }
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
    // 그 구분을 parseCommand 에 맡기지 않고 여기서 하는 이유는, 안 그러면
    // parseCommand 가 "빈 명령" 에러를 내면서 사용자에게 엉뚱한 위치를 알려주기 때문이다.
    if (first.type === 'OP' && !REDIR_OPS.includes(first.value)) syntaxError(first.value)

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

    if (!stops || stops.size === 0) {
      // top-level 리스트는 반드시 EOF 까지 소비해야 한다.
      if (this.peek().type !== 'EOF') syntaxError('unexpected token')
    } else if (!atStop()) {
      // 하위 리스트는 반드시 자신의 종료 예약어에서 끝나야 한다 (fi/done 전에 EOF 면 미완성).
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
   */
  private parseCommandOrCompound(): Command {
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
   * 판정한다. `(`/`)` 는 렉서 연산자가 아니라(OPERATORS 에 없음) 인접 raw 텍스트에
   * 흡수되므로(task 6 의 case 패턴과 같은 문제), 공백 유무에 따라 갈라지는 여러 토큰
   * 형태를 모두 받는다 — docker 로 전부 유효함을 확인했다:
   *   `f()`     → 한 토큰 raw "f()"            (consume 1)
   *   `f ()`    → raw "f", raw "()"            (consume 2)
   *   `f( )`    → raw "f(", raw ")"            (consume 2)
   *   `f ( )`   → raw "f", raw "(", raw ")"    (consume 3)
   * 매치되면 {name, consume(토큰 수)} 를, 아니면 null 을 준다(→ 일반 단순 명령).
   */
  private matchFuncDefName(): { name: string; consume: number } | null {
    const w0 = this.rawAt(0)
    if (w0 === null) return null

    // `NAME()` — 한 토큰 안에 `()` 까지 붙어 있음.
    let m = /^([A-Za-z_][A-Za-z0-9_]*)\(\)$/.exec(w0)
    if (m) return { name: m[1]!, consume: 1 }

    // `NAME(` — 여는 괄호까지 붙고, 닫는 `)` 는 다음 토큰.
    m = /^([A-Za-z_][A-Za-z0-9_]*)\($/.exec(w0)
    if (m) return this.rawAt(1) === ')' ? { name: m[1]!, consume: 2 } : null

    // 순수 `NAME` — `()` / `(` `)` 가 뒤따르는지 본다.
    if (!FUNC_NAME_RE.test(w0)) return null
    const w1 = this.rawAt(1)
    if (w1 === '()') return { name: w0, consume: 2 }
    if (w1 === '(') return this.rawAt(2) === ')' ? { name: w0, consume: 3 } : null
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

  /** `{ LIST; }` 의 내부 LIST 를 읽는다(중괄호 소비 포함). 그룹/함수 body 가 공유한다. */
  private parseBraceGroupList(): ListNode {
    this.expectKeyword('{')
    this.skipSeparators()
    const body = this.parseList(new Set(['}']))
    this.expectKeyword('}')
    return body
  }

  private parseGroup(): GroupNode {
    return { kind: 'group', body: this.parseBraceGroupList() }
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
    return { kind: 'if', cond, then: thenList, elifs, else: elseList }
  }

  private parseWhile(until: boolean): WhileNode {
    this.expectKeyword(until ? 'until' : 'while')
    const cond = this.parseList(new Set(['do']))
    this.expectKeyword('do')
    this.skipSeparators()
    const body = this.parseList(new Set(['done']))
    this.expectKeyword('done')
    return { kind: 'while', cond, body, until }
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
    return { kind: 'for', var: varName, words, body }
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
    return { kind: 'case', word, branches }
  }

  /**
   * 한 branch 의 `[(] PATTERN [| PATTERN]* )` 를 읽는다. `(`/`)` 는 렉서 연산자가
   * 아니라(OPERATORS 에 없음) 인접한 WORD 의 raw 조각에 그냥 흡수돼 있으므로
   * (`h*)` 는 통째로 raw 텍스트 "h*)"), 토큰 자체가 아니라 그 raw 텍스트를
   * stripLeadingParen/splitTrailingParen 으로 까서 판정한다. `|` 는 (case 밖에서
   * 파이프 연산자와 같은 렉서 토큰이지만) 이 자리에선 패턴 구분자로 읽는다 — 문법
   * 위치로 구분되는 건 bash 도 동일하다.
   */
  private parseCasePatterns(): Word[] {
    const patterns: Word[] = []
    let first = true

    for (;;) {
      const t = this.next()
      if (t.type !== 'WORD') syntaxError(t.type === 'OP' ? t.value : ')')
      let word = t.word
      if (first) {
        word = stripLeadingParen(word)
        first = false
        // 토큰이 순수 '(' 하나뿐이었다(예: '(' 가 공백으로 떨어진 별도 토큰) — 다음
        // 토큰이 진짜 첫 패턴이다.
        if (word.length === 0) continue
      }

      const { core, hasParen } = splitTrailingParen(word)
      if (core.length > 0) patterns.push(core)
      if (hasParen) break

      if (this.atOp('|')) { this.next(); continue }
      const nt = this.peek()
      if (nt.type === 'WORD' && bareWord(nt.word) === ')') { this.next(); break }
      syntaxError(')')
    }

    if (patterns.length === 0) syntaxError(')')
    return patterns
  }

  private parseCommand(): CommandNode {
    const cmd: CommandNode = { kind: 'command', assignments: [], words: [], redirs: [] }
    let sawWord = false

    for (;;) {
      const t = this.peek()

      if (t.type === 'OP' && REDIR_OPS.includes(t.value)) {
        this.next()
        const target = this.peek()
        if (target.type !== 'WORD') syntaxError(t.value)
        this.next()
        const fd = t.value.startsWith('2') ? 2 : t.value === '<' ? 0 : 1
        const op = t.value === '<' ? '<' : t.value.endsWith('>>') ? '>>' : '>'
        cmd.redirs.push({ fd, op, target: target.word })
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
