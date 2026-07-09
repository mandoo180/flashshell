import { tokenize, type Operator, type Token, type Word } from './lexer'

export interface Redir { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; target: Word }
export interface Assignment { name: string; value: Word }

export interface CommandNode {
  kind: 'command'
  assignments: Assignment[]
  words: Word[]
  redirs: Redir[]
}

export interface PipelineNode { kind: 'pipeline'; commands: CommandNode[] }

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

  parseList(): ListNode {
    const items: ListNode['items'] = []
    const first = this.peek()
    if (first.type === 'EOF') return { kind: 'list', items }
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
      items.push({ op, pipeline: this.parsePipeline() })
    }

    if (this.peek().type !== 'EOF') syntaxError('unexpected token')
    return { kind: 'list', items }
  }

  private parsePipeline(): PipelineNode {
    const commands: CommandNode[] = [this.parseCommand()]
    while (this.atOp('|')) {
      this.next()
      if (this.peek().type === 'EOF') syntaxError('|')
      commands.push(this.parseCommand())
    }
    return { kind: 'pipeline', commands }
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
