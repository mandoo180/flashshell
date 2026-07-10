//
// 서브셋: `[BEGIN{...}] [/re/ | EXPR OP EXPR] {action} [END{...}]` 규칙들.
// 변수: $0(줄 전체), $1..$N(필드, 리터럴 정수만 — `$NF`/`$(expr)` 같은 동적 필드
// 참조는 미지원), NR(줄 번호), NF(필드 수). -F SEP 로 필드 구분자 지정
// (기본: 공백 연속 분할 + 앞뒤 공백 무시).
// 문장: `print` / `print EXPR, EXPR, ...`(콤마는 OFS=공백 join, ORS="\n" 추가),
// `VAR = EXPR` / `VAR += EXPR`(둘 다 숫자 누적 변수 — 이 서브셋의 변수는 항상 숫자다).
// 패턴: `/re/`(줄 매치), `EXPR OP EXPR`(비교: > < >= <= == !=), 없으면 모든 줄.
// EXPR: 필드($N), NR, NF, 숫자 리터럴, 문자열 리터럴("..."), 변수, `+ - *` 이항.
//
// 미지원(전부 flashshell: 로 거부, 절대 부분 실행하지 않는다): 사용자 함수, for/while/if
// 제어문, 배열(`a[1]`), printf, getline, 정규식 함수(gsub/sub/match/split), 삼항 연산자,
// `++`/`--`, 나눗셈(`/`)·나머지(`%`) 연산자, 단항 부호, 괄호로 묶은 grouping, 패턴만 있고
// 액션이 없는 규칙(암묵적 `{print}` 는 지원하지 않음 — 항상 명시적 액션 블록이 필요).
//
// 설계 노트: 렉서는 이 서브셋에 나눗셈 연산자가 없다는 사실을 이용한다 — 소스에 나오는
// 모든 `/`는 무조건 정규식 리터럴의 시작으로 취급한다(그래서 정규식과 나눗셈을 문맥으로
// 구분하는 고전적인 awk 렉서 난제가 아예 없다). 마찬가지로 이 서브셋은 괄호를 전혀
// 쓰지 않으므로(필드는 $N 직접 표기, grouping 없음) `(` 를 토큰 집합에서 완전히 빼버리면
// `for(...)`, `while(...)`, `if(...)`, `gsub(...)`, `printf(...)`, 사용자 함수 호출이
// 전부 "인식 못 하는 문자"로 자연스럽게 거부된다 — 각각을 따로 감지하는 특수 케이스가
// 필요 없다.
import type { CommandFn } from '../types'
import { errnoText, parseFlags, readSources, toLines } from './shared'

/** 파서/렉서가 서브셋 밖 구문을 만나면 이 타입으로 던진다. detail 은 실패 지점의 원문 조각. */
class AwkReject extends Error {
  constructor(public detail: string) {
    super(detail)
  }
}

// ---------- 토크나이저 ----------

type Tok =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'regex'; value: RegExp }
  | { type: 'field'; index: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'eof' }

interface PosTok { tok: Tok; start: number }

const TWO_CHAR_OPS = ['>=', '<=', '==', '!=', '+=']
const ONE_CHAR_OPS = ['{', '}', ',', ';', '=', '>', '<', '+', '-', '*']

function tokenize(src: string): PosTok[] {
  const out: PosTok[] = []
  let i = 0
  const fail = (start: number, why: string): never => {
    throw new AwkReject(`${why}: ${src.slice(start).trim().slice(0, 40)}`)
  }
  while (i < src.length) {
    const ch = src[i]!
    const start = i
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }

    if (ch === '/') {
      // 나눗셈 연산자는 이 서브셋에 없으므로 `/` 는 항상 정규식 리터럴 시작이다.
      let j = i + 1
      let raw = ''
      while (j < src.length && src[j] !== '/') {
        if (src[j] === '\\' && src[j + 1] === '/') { raw += '/'; j += 2; continue }
        raw += src[j]; j++
      }
      if (src[j] !== '/') fail(start, '정규식이 닫히지 않았습니다')
      j++
      let re: RegExp
      try { re = new RegExp(raw) } catch { fail(start, '잘못된 정규식입니다') }
      out.push({ tok: { type: 'regex', value: re! }, start })
      i = j
      continue
    }

    if (ch === '"') {
      let j = i + 1
      let value = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') {
          const n = src[j + 1]
          if (n === 'n') { value += '\n'; j += 2; continue }
          if (n === 't') { value += '\t'; j += 2; continue }
          if (n === '"') { value += '"'; j += 2; continue }
          if (n === '\\') { value += '\\'; j += 2; continue }
          value += n ?? '\\'
          j += n === undefined ? 1 : 2
          continue
        }
        value += src[j]; j++
      }
      if (src[j] !== '"') fail(start, '문자열이 닫히지 않았습니다')
      j++
      out.push({ tok: { type: 'str', value }, start })
      i = j
      continue
    }

    if (ch === '$') {
      const m = /^\$(\d+)/.exec(src.slice(i))
      if (!m) fail(start, '$ 뒤에는 정수 필드 번호만 올 수 있습니다 ($NF/$(expr) 같은 동적 필드 참조는 미지원)')
      out.push({ tok: { type: 'field', index: Number(m![1]) }, start })
      i += m![0].length
      continue
    }

    if (/\d/.test(ch)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i))!
      out.push({ tok: { type: 'num', value: Number(m[0]) }, start })
      i += m[0].length
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ tok: { type: 'ident', value: m[0] }, start })
      i += m[0].length
      continue
    }

    const two = TWO_CHAR_OPS.find((op) => src.startsWith(op, i))
    if (two) { out.push({ tok: { type: 'op', value: two }, start }); i += 2; continue }
    const one = ONE_CHAR_OPS.find((op) => src[i] === op)
    if (one) { out.push({ tok: { type: 'op', value: one }, start }); i += 1; continue }

    fail(start, '이 환경이 지원하지 않는 문자입니다')
  }
  out.push({ tok: { type: 'eof' }, start: src.length })
  return out
}

// ---------- AST ----------

type CmpOp = '>' | '<' | '>=' | '<=' | '==' | '!='
type ExprNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'field'; index: number }
  | { kind: 'nr' }
  | { kind: 'nf' }
  | { kind: 'var'; name: string }
  | { kind: 'bin'; op: '+' | '-' | '*'; left: ExprNode; right: ExprNode }

type PatternNode = { kind: 'regex'; re: RegExp } | { kind: 'cmp'; op: CmpOp; left: ExprNode; right: ExprNode }
type Stmt = { kind: 'print'; args: ExprNode[] } | { kind: 'assign'; name: string; op: '=' | '+='; expr: ExprNode }
interface MainRule { pattern: PatternNode | null; action: Stmt[] }
interface Program { begin: Stmt[][]; end: Stmt[][]; rules: MainRule[] }

const RESERVED = new Set(['BEGIN', 'END', 'print', 'NR', 'NF'])

class Parser {
  private p = 0
  constructor(private toks: PosTok[], private src: string) {}

  private peek(): Tok { return this.toks[this.p]!.tok }
  private peekStart(): number { return this.toks[this.p]!.start }
  private advance(): Tok { return this.toks[this.p++]!.tok }

  private detailFromHere(): string {
    return this.src.slice(this.peekStart()).trim().slice(0, 40) || '(끝)'
  }

  private reject(): never {
    throw new AwkReject(this.detailFromHere())
  }

  private expectOp(value: string): void {
    const t = this.peek()
    if (t.type !== 'op' || t.value !== value) this.reject()
    this.advance()
  }

  private isOp(value: string): boolean {
    const t = this.peek()
    return t.type === 'op' && t.value === value
  }

  private skipSeparators(): void {
    while (this.isOp(';')) this.advance()
  }

  parseProgram(): Program {
    const begin: Stmt[][] = []
    const end: Stmt[][] = []
    const rules: MainRule[] = []
    this.skipSeparators()
    while (this.peek().type !== 'eof') {
      const t = this.peek()
      if (t.type === 'ident' && t.value === 'BEGIN') {
        this.advance()
        begin.push(this.parseBlock())
      } else if (t.type === 'ident' && t.value === 'END') {
        this.advance()
        end.push(this.parseBlock())
      } else {
        rules.push(this.parseMainRule())
      }
      this.skipSeparators()
    }
    return { begin, end, rules }
  }

  private parseMainRule(): MainRule {
    let pattern: PatternNode | null = null
    if (this.peek().type === 'regex') {
      const t = this.advance() as { type: 'regex'; value: RegExp }
      pattern = { kind: 'regex', re: t.value }
    } else if (!this.isOp('{')) {
      const left = this.parseExpr()
      const cmpOps: CmpOp[] = ['>=', '<=', '==', '!=', '>', '<']
      const t = this.peek()
      const op = t.type === 'op' && (cmpOps as string[]).includes(t.value) ? (t.value as CmpOp) : null
      if (!op) this.reject() // bare Expr 패턴(비교 연산자 없음)은 서브셋 밖 — 항상 거부.
      this.advance()
      const right = this.parseExpr()
      pattern = { kind: 'cmp', op, left, right }
    }
    if (!this.isOp('{')) this.reject() // 패턴만 있고 액션이 없는 규칙(암묵적 print $0)은 미지원.
    const action = this.parseBlock()
    return { pattern, action }
  }

  private parseBlock(): Stmt[] {
    this.expectOp('{')
    const stmts: Stmt[] = []
    this.skipSeparators()
    while (!this.isOp('}')) {
      stmts.push(this.parseStmt())
      if (this.isOp(';')) this.skipSeparators()
      else break
    }
    this.expectOp('}')
    return stmts
  }

  private parseStmt(): Stmt {
    const t = this.peek()
    if (t.type === 'ident' && t.value === 'print') {
      this.advance()
      const args: ExprNode[] = []
      if (!this.isOp(';') && !this.isOp('}')) {
        args.push(this.parseExpr())
        while (this.isOp(',')) { this.advance(); args.push(this.parseExpr()) }
      }
      return { kind: 'print', args }
    }
    if (t.type === 'ident' && !RESERVED.has(t.value)) {
      const name = t.value
      const next = this.toks[this.p + 1]!.tok
      if (next.type === 'op' && (next.value === '=' || next.value === '+=')) {
        this.advance()
        const op = this.advance() as { type: 'op'; value: '=' | '+=' }
        const expr = this.parseExpr()
        return { kind: 'assign', name, op: op.value, expr }
      }
    }
    this.reject()
  }

  private parseExpr(): ExprNode {
    let left = this.parseTerm()
    for (;;) {
      const t = this.peek()
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.advance()
        const right = this.parseTerm()
        left = { kind: 'bin', op: t.value, left, right }
      } else break
    }
    return left
  }

  private parseTerm(): ExprNode {
    let left = this.parseFactor()
    while (this.isOp('*')) {
      this.advance()
      const right = this.parseFactor()
      left = { kind: 'bin', op: '*', left, right }
    }
    return left
  }

  private parseFactor(): ExprNode {
    const t = this.peek()
    if (t.type === 'num') { this.advance(); return { kind: 'num', value: t.value } }
    if (t.type === 'str') { this.advance(); return { kind: 'str', value: t.value } }
    if (t.type === 'field') { this.advance(); return { kind: 'field', index: t.index } }
    if (t.type === 'ident' && t.value === 'NR') { this.advance(); return { kind: 'nr' } }
    if (t.type === 'ident' && t.value === 'NF') { this.advance(); return { kind: 'nf' } }
    if (t.type === 'ident' && !RESERVED.has(t.value)) { this.advance(); return { kind: 'var', name: t.value } }
    this.reject()
  }
}

// ---------- 값 표현 & 평가 ----------

/**
 * numericEligible: 이 값이 다른 쪽도 "숫자로 취급 가능"할 때 숫자 비교에 참여할 수
 * 있는가. NR/NF/숫자 리터럴/산술 결과/대입된 변수는 항상 true. 필드는 텍스트가
 * POSIX "numeric string" 패턴을 완전히 만족할 때만 true(strnum). 문자열 리터럴은
 * 항상 false(진짜 텍스트를 봐도 숫자로 안 본다 — GNU awk 실측: `$2=="30"` 는
 * 문자열 비교로도 우연히 같은 결과가 나오지만, `$2==" 30"`/`$2=="030"` 은 반드시
 * 문자열 비교라야 실측과 일치한다). 한 번도 대입되지 않은 변수는 특별히
 * numericEligible=true, str=''로 취급한다(대입된 값 0과 구분 — `print x` 는 빈 줄,
 * `x=0; print x` 는 "0").
 */
interface Val { str: string; num: number; numericEligible: boolean }

const NUMERIC_PREFIX_RE = /^[ \t\n]*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/
const NUMERIC_FULL_RE = /^[ \t\n]*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[ \t\n]*$/

function coerceToNumber(text: string): number {
  const m = NUMERIC_PREFIX_RE.exec(text)
  if (!m) return 0
  const n = Number(m[0])
  return Number.isNaN(n) ? 0 : n
}

function looksNumeric(text: string): boolean {
  return NUMERIC_FULL_RE.test(text)
}

/** awk 의 기본 OFMT(%.6g)를 흉내낸다. 정수는 그대로, 아니면 유효숫자 6자리. */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'nan' : n > 0 ? 'inf' : '-inf'
  let s = n.toPrecision(6)
  if (!s.includes('e') && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

function numVal(n: number): Val { return { str: formatNumber(n), num: n, numericEligible: true } }
function strVal(s: string): Val { return { str: s, num: coerceToNumber(s), numericEligible: false } }
function fieldVal(s: string): Val { return { str: s, num: coerceToNumber(s), numericEligible: looksNumeric(s) } }
const UNSET_VAL: Val = { str: '', num: 0, numericEligible: true }

// 이름을 `Record`로 하지 않는다 — TS 내장 유틸리티 타입 `Record<K, V>`를 이 파일
// 스코프에서 가려버려 헷갈린다.
interface AwkRecord { fields: string[]; line: string }

class Runtime {
  vars = new Map<string, number>()
  nr = 0
  record: AwkRecord = { fields: [], line: '' }

  get nf(): number { return this.record.fields.length }

  getField(n: number): string {
    if (n === 0) return this.record.line
    return this.record.fields[n - 1] ?? ''
  }

  getVar(name: string): Val {
    const v = this.vars.get(name)
    return v === undefined ? UNSET_VAL : numVal(v)
  }

  setVar(name: string, n: number): void { this.vars.set(name, n) }

  evalExpr(e: ExprNode): Val {
    switch (e.kind) {
      case 'num': return numVal(e.value)
      case 'str': return strVal(e.value)
      case 'field': return fieldVal(this.getField(e.index))
      case 'nr': return numVal(this.nr)
      case 'nf': return numVal(this.nf)
      case 'var': return this.getVar(e.name)
      case 'bin': {
        const l = this.evalExpr(e.left).num
        const r = this.evalExpr(e.right).num
        const result = e.op === '+' ? l + r : e.op === '-' ? l - r : l * r
        return numVal(result)
      }
    }
  }

  evalPattern(p: PatternNode | null): boolean {
    if (p === null) return true
    if (p.kind === 'regex') return p.re.test(this.record.line)
    const l = this.evalExpr(p.left)
    const r = this.evalExpr(p.right)
    if (l.numericEligible && r.numericEligible) {
      switch (p.op) {
        case '>': return l.num > r.num
        case '<': return l.num < r.num
        case '>=': return l.num >= r.num
        case '<=': return l.num <= r.num
        case '==': return l.num === r.num
        case '!=': return l.num !== r.num
      }
    }
    switch (p.op) {
      case '>': return l.str > r.str
      case '<': return l.str < r.str
      case '>=': return l.str >= r.str
      case '<=': return l.str <= r.str
      case '==': return l.str === r.str
      case '!=': return l.str !== r.str
    }
  }

  runStmts(stmts: Stmt[]): string {
    let out = ''
    for (const s of stmts) {
      if (s.kind === 'print') {
        if (s.args.length === 0) { out += `${this.record.line}\n`; continue }
        out += `${s.args.map((a) => this.evalExpr(a).str).join(' ')}\n`
      } else {
        const cur = this.vars.get(s.name) ?? 0
        const rhs = this.evalExpr(s.expr).num
        this.setVar(s.name, s.op === '+=' ? cur + rhs : rhs)
      }
    }
    return out
  }
}

/** 기본 필드 분리(공백 연속, 앞뒤 공백 무시) 아니면 -F 로 받은 구분자. */
function splitFields(line: string, fs: string | undefined): string[] {
  if (fs === undefined || fs === ' ') {
    const trimmed = line.trim()
    return trimmed === '' ? [] : trimmed.split(/\s+/)
  }
  if (fs.length === 1) return line.split(fs)
  return line.split(new RegExp(fs))
}

export const awk: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args, ['F'])
  const program = rest[0]
  if (program === undefined) {
    return { stdout: '', stderr: 'awk: usage: awk [-F sep] program [file ...]\n', exitCode: 2 }
  }

  let parsed: Program
  try {
    parsed = new Parser(tokenize(program), program).parseProgram()
  } catch (err) {
    if (err instanceof AwkReject) {
      return {
        stdout: '',
        stderr: `flashshell: awk: 이 환경이 지원하지 않는 구문입니다: ${err.detail}\n`,
        exitCode: 2,
      }
    }
    throw err
  }

  const fs = flags.get('F')
  const rt = new Runtime()
  let stdout = ''

  for (const block of parsed.begin) stdout += rt.runStmts(block)

  // GNU/mawk 문구(docker debian:stable-slim mawk 1.3.4 실측): 파일이 없든
  // 디렉터리든 문구 틀은 같다 — `awk: cannot open "FILE" (REASON)`, exit 2.
  const formatReadError = (file: string, err: unknown): string => `awk: cannot open "${file}" (${errnoText(err)})`
  const { sources, stderr, failed } = readSources(e, rest.slice(1), formatReadError)

  for (const source of sources) {
    for (const line of toLines(source.text)) {
      rt.nr++
      rt.record = { line, fields: splitFields(line, fs) }
      for (const rule of parsed.rules) {
        if (rt.evalPattern(rule.pattern)) stdout += rt.runStmts(rule.action)
      }
    }
  }

  for (const block of parsed.end) stdout += rt.runStmts(block)

  return { stdout, stderr, exitCode: failed ? 2 : 0 }
}
