/**
 * bash 산술 확장 `$(( expr ))` 의 정수 평가기.
 *
 * 파이프라인: tokenize(문자열 → 토큰) → Parser(토큰 → AST) → Evaluator(AST → number).
 * AST 를 한 번 만든 뒤 평가하는 이유는 `&& || ?:` 의 단락 평가(short-circuit)와 대입
 * 부작용을 자연스럽게 처리하기 위해서다 — 평가기는 실제로 취해지는 가지만 재귀하므로
 * `0 && (x=7)` 이 x 를 건드리지 않는다(bash 실측 일치).
 *
 * bash 산술의 미묘한 지점들(전부 debian:stable-slim bash 5 로 실측 확인):
 *  - 정수 전용(부동소수 없음). `/` 는 0 방향 절삭(-7/2 → -3), `%` 부호는 피제수를 따른다
 *    (-7%3 → -1, 7%-3 → 1) — JS 의 기본 `/`+Math.trunc, `%` 와 정확히 일치.
 *  - 리터럴: 10진, `0x`/`0X` 16진, 선행 `0` 8진(`010` → 8; `08` 은 "value too great for
 *    base" 오류). 이 8진 규칙은 arithmetic context 전용이라 test/[ 의 10진 규칙과 다르다.
 *  - `**` 는 우결합(2**3**2 → 512)이고 단항보다 느슨하다: `-2**2` → (-2)**2 → 4 (bash 실측).
 *    이 결합은 parseUnary 가 피연산자를 먼저 통째로 삼키는 재귀하강 구조에서 자연히 나온다.
 *  - 변수: bare `x` 와 `$x` 둘 다 env 를 읽는다. 미설정/빈 값 = 0. 값이 다시 산술식이면
 *    재귀 평가한다(x="y+1"; $((x)) → 3). 순환(x=x)은 깊이 상한으로 잘라 던진다.
 *
 * 알려진 한계(서브셋 밖, bash 와 다를 수 있음): 비트/시프트(`& | ^ ~ << >>`)는 JS 의
 * 32비트 정수 연산을 쓰므로 bash 의 64비트와 큰 값에서 갈린다. `**` 등 큰 수는 JS double
 * 정밀도(2^53)를 넘으면 bash 의 64비트 랩어라운드와 다르다. `base#num`, 콤마 연산자는
 * 미구현. 서브셋의 카운터/비교/증감 용도에서는 문제되지 않는다.
 */

/** 산술 평가 실패(0 나누기, 문법 오류, 순환 재귀 등). expand/interpreter 가 잡아 ExecResult 로 바꾼다. */
export class ArithError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArithError'
  }
}

// ── 토크나이저 ──────────────────────────────────────────────────────────────

type Token =
  | { type: 'num'; value: number }
  | { type: 'id'; name: string }
  | { type: 'op'; op: string }

/** 3글자 연산자 — 최대 뭉치기(maximal munch) 위해 2·1글자보다 먼저 시도한다. */
const OPS3 = ['<<=', '>>=']
const OPS2 = [
  '**', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++', '--',
]
const OPS1 = ['+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', '(', ')']

const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isIdStart = (c: string): boolean => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_'
const isIdChar = (c: string): boolean => isIdStart(c) || isDigit(c)
const isHexDigit = (c: string): boolean => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')

/** 숫자 리터럴 하나를 읽어 [값, 소비한 글자 수] 를 돌려준다. */
function readNumber(s: string, start: number): [number, number] {
  // 16진: 0x / 0X
  if (s[start] === '0' && (s[start + 1] === 'x' || s[start + 1] === 'X')) {
    let j = start + 2
    while (j < s.length && isHexDigit(s[j]!)) j++
    if (j === start + 2) throw new ArithError('invalid hex literal')
    return [parseInt(s.slice(start + 2, j), 16), j - start]
  }
  // 선행 0 → 8진 (단, 그냥 "0" 하나는 10진 0)
  if (s[start] === '0') {
    let j = start + 1
    while (j < s.length && isDigit(s[j]!)) j++
    const digits = s.slice(start, j)
    if (digits.length > 1) {
      if (/[89]/.test(digits)) throw new ArithError(`value too great for base (error token is "${digits}")`)
      return [parseInt(digits, 8), j - start]
    }
    return [0, 1]
  }
  // 10진
  let j = start
  while (j < s.length && isDigit(s[j]!)) j++
  return [parseInt(s.slice(start, j), 10), j - start]
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }

    // $NAME — bash 는 arithmetic 안에서 `$x` 도 변수로 읽는다(bare `x` 와 동일).
    if (c === '$') {
      let j = i + 1
      if (j >= source.length || !isIdStart(source[j]!)) throw new ArithError('syntax error near `$`')
      const nameStart = j
      while (j < source.length && isIdChar(source[j]!)) j++
      tokens.push({ type: 'id', name: source.slice(nameStart, j) })
      i = j
      continue
    }

    if (isDigit(c)) {
      const [value, len] = readNumber(source, i)
      tokens.push({ type: 'num', value })
      i += len
      continue
    }

    if (isIdStart(c)) {
      let j = i
      while (j < source.length && isIdChar(source[j]!)) j++
      tokens.push({ type: 'id', name: source.slice(i, j) })
      i = j
      continue
    }

    const three = source.slice(i, i + 3)
    if (OPS3.includes(three)) { tokens.push({ type: 'op', op: three }); i += 3; continue }
    const two = source.slice(i, i + 2)
    if (OPS2.includes(two)) { tokens.push({ type: 'op', op: two }); i += 2; continue }
    if (OPS1.includes(c)) { tokens.push({ type: 'op', op: c }); i++; continue }

    throw new ArithError(`syntax error near unexpected token \`${c}\``)
  }
  return tokens
}

// ── AST ─────────────────────────────────────────────────────────────────────

type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'unary'; op: string; operand: Node }
  | { type: 'preincr'; op: '++' | '--'; name: string }
  | { type: 'postincr'; op: '++' | '--'; name: string }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'ternary'; cond: Node; then: Node; else: Node }
  | { type: 'assign'; op: string; name: string; value: Node }

/** 이항 연산자 결합력(클수록 강하게 묶는다). C 우선순위. `**` 최상위, `||` 최하위. */
const BINDING: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6, '!=': 6,
  '<': 7, '<=': 7, '>': 7, '>=': 7,
  '<<': 8, '>>': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
  '**': 11,
}
const RIGHT_ASSOC = new Set(['**'])
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='])

// ── 파서 (재귀하강 / 우선순위 등반) ──────────────────────────────────────────

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.pos] }
  private advance(): Token { return this.tokens[this.pos++]! }
  private isOp(t: Token | undefined, op: string): boolean {
    return t !== undefined && t.type === 'op' && t.op === op
  }

  parse(): Node {
    if (this.tokens.length === 0) return { type: 'num', value: 0 } // `$(())` → 0
    const node = this.parseAssign()
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!
      const tok = t.type === 'op' ? t.op : t.type === 'num' ? String(t.value) : t.name
      throw new ArithError(`syntax error near unexpected token \`${tok}\``)
    }
    return node
  }

  // 대입(최하위, 우결합). 좌변은 반드시 lvalue(변수)여야 한다.
  private parseAssign(): Node {
    const left = this.parseTernary()
    const t = this.peek()
    if (t !== undefined && t.type === 'op' && ASSIGN_OPS.has(t.op)) {
      if (left.type !== 'var') throw new ArithError('attempted assignment to non-variable')
      this.advance()
      const value = this.parseAssign()
      return { type: 'assign', op: t.op, name: left.name, value }
    }
    return left
  }

  // 삼항(우결합).
  private parseTernary(): Node {
    const cond = this.parseBinary(1)
    if (this.isOp(this.peek(), '?')) {
      this.advance()
      const thenBranch = this.parseAssign() // bash 는 가지 안의 대입을 허용한다
      if (!this.isOp(this.peek(), ':')) throw new ArithError('expected `:` in conditional expression')
      this.advance()
      const elseBranch = this.parseTernary()
      return { type: 'ternary', cond, then: thenBranch, else: elseBranch }
    }
    return cond
  }

  // 이항 연산자들(우선순위 등반).
  private parseBinary(minBp: number): Node {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t === undefined || t.type !== 'op') break
      const bp = BINDING[t.op]
      if (bp === undefined || bp < minBp) break
      this.advance()
      const nextMin = RIGHT_ASSOC.has(t.op) ? bp : bp + 1
      const right = this.parseBinary(nextMin)
      left = { type: 'binary', op: t.op, left, right }
    }
    return left
  }

  // 전위 단항: + - ! ~, 그리고 전위 증감 ++x --x.
  // 단항이 parseBinary 의 피연산자 공급자이므로 단항은 `**` 보다 강하게 묶인다(bash: -2**2 → 4).
  private parseUnary(): Node {
    const t = this.peek()
    if (t !== undefined && t.type === 'op' && (t.op === '+' || t.op === '-' || t.op === '!' || t.op === '~')) {
      this.advance()
      return { type: 'unary', op: t.op, operand: this.parseUnary() }
    }
    if (t !== undefined && t.type === 'op' && (t.op === '++' || t.op === '--')) {
      this.advance()
      const operand = this.parseUnary()
      if (operand.type !== 'var') throw new ArithError('attempted assignment to non-variable')
      return { type: 'preincr', op: t.op, name: operand.name }
    }
    return this.parsePostfix()
  }

  // 후위 증감 x++ x--.
  private parsePostfix(): Node {
    const atom = this.parseAtom()
    const t = this.peek()
    if (atom.type === 'var' && t !== undefined && t.type === 'op' && (t.op === '++' || t.op === '--')) {
      this.advance()
      return { type: 'postincr', op: t.op, name: atom.name }
    }
    return atom
  }

  private parseAtom(): Node {
    const t = this.peek()
    if (t === undefined) throw new ArithError('syntax error: operand expected')
    if (t.type === 'num') { this.advance(); return { type: 'num', value: t.value } }
    if (t.type === 'id') { this.advance(); return { type: 'var', name: t.name } }
    if (t.type === 'op' && t.op === '(') {
      this.advance()
      const inner = this.parseAssign()
      if (!this.isOp(this.peek(), ')')) throw new ArithError('expected `)`')
      this.advance()
      return inner
    }
    throw new ArithError(`syntax error near unexpected token \`${t.op}\``)
  }
}

// ── 평가기 ──────────────────────────────────────────────────────────────────

/** 변수 값이 다시 산술식일 때의 재귀 상한(순환 x=x 를 잘라 던진다). bash 도 유한 상한을 둔다. */
const MAX_RECURSION = 100

/** exp>=0 에 대한 정수 거듭제곱. double 정밀도 안에서 정확하다(서브셋의 작은 값 범위). */
function ipow(base: number, exp: number): number {
  if (exp < 0) throw new ArithError('exponent less than 0')
  let result = 1
  for (let i = 0; i < exp; i++) result *= base
  return result
}

class Evaluator {
  constructor(
    private readonly env: Record<string, string>,
    private readonly depth: number,
  ) {}

  /** 문자열을 토크나이즈·파싱·평가한다. 변수 값 재귀 평가에도 같은 경로를 쓴다. */
  evalString(source: string): number {
    const tokens = tokenize(source)
    const ast = new Parser(tokens).parse()
    return this.evalNode(ast)
  }

  private evalNode(n: Node): number {
    switch (n.type) {
      case 'num':
        return n.value
      case 'var':
        return this.readVar(n.name)
      case 'unary': {
        const v = this.evalNode(n.operand)
        switch (n.op) {
          case '+': return v
          case '-': return -v
          case '!': return v === 0 ? 1 : 0
          case '~': return ~v
        }
        throw new ArithError(`unknown unary operator ${n.op}`)
      }
      case 'preincr': {
        const next = this.readVar(n.name) + (n.op === '++' ? 1 : -1)
        this.setVar(n.name, next)
        return next
      }
      case 'postincr': {
        const old = this.readVar(n.name)
        this.setVar(n.name, old + (n.op === '++' ? 1 : -1))
        return old
      }
      case 'ternary':
        return this.evalNode(n.cond) !== 0 ? this.evalNode(n.then) : this.evalNode(n.else)
      case 'assign':
        return this.evalAssign(n)
      case 'binary':
        return this.evalBinary(n)
    }
  }

  private evalBinary(n: Node & { type: 'binary' }): number {
    // 단락 평가: 취하지 않는 쪽은 evalNode 를 호출하지 않아 부작용도 없다.
    if (n.op === '&&') return this.evalNode(n.left) !== 0 && this.evalNode(n.right) !== 0 ? 1 : 0
    if (n.op === '||') return this.evalNode(n.left) !== 0 || this.evalNode(n.right) !== 0 ? 1 : 0

    const a = this.evalNode(n.left)
    const b = this.evalNode(n.right)
    switch (n.op) {
      case '+': return a + b
      case '-': return a - b
      case '*': return a * b
      case '/': if (b === 0) throw new ArithError('division by 0'); return Math.trunc(a / b)
      case '%': if (b === 0) throw new ArithError('division by 0'); return a % b
      case '**': return ipow(a, b)
      case '<': return a < b ? 1 : 0
      case '<=': return a <= b ? 1 : 0
      case '>': return a > b ? 1 : 0
      case '>=': return a >= b ? 1 : 0
      case '==': return a === b ? 1 : 0
      case '!=': return a !== b ? 1 : 0
      case '&': return a & b
      case '|': return a | b
      case '^': return a ^ b
      case '<<': return a << b
      case '>>': return a >> b
    }
    throw new ArithError(`unknown binary operator ${n.op}`)
  }

  private evalAssign(n: Node & { type: 'assign' }): number {
    let value: number
    if (n.op === '=') {
      value = this.evalNode(n.value)
    } else {
      const cur = this.readVar(n.name)
      const rhs = this.evalNode(n.value)
      switch (n.op) {
        case '+=': value = cur + rhs; break
        case '-=': value = cur - rhs; break
        case '*=': value = cur * rhs; break
        case '/=': if (rhs === 0) throw new ArithError('division by 0'); value = Math.trunc(cur / rhs); break
        case '%=': if (rhs === 0) throw new ArithError('division by 0'); value = cur % rhs; break
        case '&=': value = cur & rhs; break
        case '|=': value = cur | rhs; break
        case '^=': value = cur ^ rhs; break
        case '<<=': value = cur << rhs; break
        case '>>=': value = cur >> rhs; break
        default: throw new ArithError(`unknown assignment operator ${n.op}`)
      }
    }
    this.setVar(n.name, value)
    return value
  }

  /** 변수 읽기. 미설정/빈 값 = 0. 값이 산술식이면 재귀 평가(깊이 상한으로 순환 차단). */
  private readVar(name: string): number {
    const raw = this.env[name]
    if (raw === undefined || raw === '') return 0
    if (this.depth >= MAX_RECURSION) throw new ArithError('expression recursion level exceeded')
    return new Evaluator(this.env, this.depth + 1).evalString(raw)
  }

  private setVar(name: string, value: number): void {
    this.env[name] = String(value)
  }
}

/**
 * bash 산술 확장 `$(( expr ))` 를 평가한다. 정수 결과를 돌려주고, 대입·증감은 `ctx.env` 에
 * 문자열로 기록한다. 0 나누기·문법 오류·순환 재귀는 ArithError 를 던진다 — 호출부(expandDollar)가
 * 그대로 위로 흘려 interpreter 의 catch 가 얌전한 ExecResult(stderr + exit 1)로 바꾼다.
 */
export function evalArith(expr: string, ctx: { env: Record<string, string> }): number {
  return new Evaluator(ctx.env, 0).evalString(expr)
}
