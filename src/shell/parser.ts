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
 * 파이프라인의 한 단계가 될 수 있는 명령. 단순 명령 + 복합 명령의 유니온이다.
 * `kind` 로 판별한다. Task 5(for)/6(case)/7(function)이 여기에 kind 를 더 추가한다.
 */
export type Command = CommandNode | IfNode | WhileNode

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
 * bash 예약어. 여기 뒤 태스크(5/6/7)에서 for/in/case/esac/function 등이 더해진다.
 * 이 집합에 있는 단어만 "명령 위치의 bare 단어"일 때 예약어로 인정된다.
 */
const RESERVED_WORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done'])

/**
 * 단어가 bash 예약어인지 판정하고, 맞으면 그 텍스트를, 아니면 null 을 준다.
 *
 * 예약어는 (1) 명령 위치이고 (2) 따옴표 없이 통째로 그 예약어 텍스트일 때만 예약어다.
 * `echo if` 의 if(인자)나 `'if'`/`"if"`(따옴표)는 예약어가 아니다. 렉서는 따옴표 없는
 * 텍스트를 raw 조각 하나로 만들고(같은 kind 끼리 병합하므로 `if` 는 raw 한 조각), 따옴표는
 * literal(작은따옴표) / dquote(큰따옴표) 조각으로 만든다. 따라서 예약어는 "raw 조각
 * 하나짜리 단어"일 때만 성립한다 — tryAssignment 가 `word[0].kind === 'raw'` 로 NAME= 를
 * 가리는 것과 같은 원리다. "명령 위치"인지는 호출부가 책임진다(parseCommandOrCompound 와
 * parseList 의 각 아이템 첫 토큰에서만 keywordOf 를 본다).
 */
function keywordOf(word: Word): string | null {
  if (word.length !== 1) return null
  const part = word[0]!
  if (part.kind !== 'raw') return null
  return RESERVED_WORDS.has(part.text) ? part.text : null
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

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]! }

  private next(): Token { return this.tokens[this.pos++]! }

  private atOp(...ops: Operator[]): boolean {
    const t = this.peek()
    return t.type === 'OP' && ops.includes(t.value)
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
   */
  parseList(stopWords?: Set<string>): ListNode {
    const items: ListNode['items'] = []
    const stops = stopWords
    const atStop = (): boolean => {
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

  /** 첫 토큰이 bare 예약어(if/while/until)면 복합 명령, 아니면 단순 명령. */
  private parseCommandOrCompound(): Command {
    switch (this.peekKeyword()) {
      case 'if': return this.parseIf()
      case 'while': return this.parseWhile(false)
      case 'until': return this.parseWhile(true)
      default: return this.parseCommand()
    }
  }

  private parseIf(): IfNode {
    this.expectKeyword('if')
    const cond = this.parseList(new Set(['then']))
    this.expectKeyword('then')
    const thenList = this.parseList(new Set(['elif', 'else', 'fi']))

    const elifs: { cond: ListNode; then: ListNode }[] = []
    while (this.peekKeyword() === 'elif') {
      this.expectKeyword('elif')
      const elifCond = this.parseList(new Set(['then']))
      this.expectKeyword('then')
      const elifThen = this.parseList(new Set(['elif', 'else', 'fi']))
      elifs.push({ cond: elifCond, then: elifThen })
    }

    let elseList: ListNode | undefined
    if (this.peekKeyword() === 'else') {
      this.expectKeyword('else')
      elseList = this.parseList(new Set(['fi']))
    }

    this.expectKeyword('fi')
    return { kind: 'if', cond, then: thenList, elifs, else: elseList }
  }

  private parseWhile(until: boolean): WhileNode {
    this.expectKeyword(until ? 'until' : 'while')
    const cond = this.parseList(new Set(['do']))
    this.expectKeyword('do')
    const body = this.parseList(new Set(['done']))
    this.expectKeyword('done')
    return { kind: 'while', cond, body, until }
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
