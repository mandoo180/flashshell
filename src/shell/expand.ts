import type { VFS } from './vfs'
import type { Word } from './lexer'
import { expandGlob } from './glob'
import { matchSubstitutionEnd } from './subst'
import { evalArith } from './arith'

export interface ExpandCtx {
  env: Record<string, string>
  cwd: string
  home: string
  fs: VFS
  lastExitCode: number
  /** $1..$9 / $@ / $* / $# 의 재료. 인덱스 0 = $1. Task 7(함수)·8(source)·9(shebang)가 세팅한다. */
  positional: string[]
  runSubshell(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

/**
 * 확장 중간 표현.
 * - quoted[i] 는 text[i] 가 따옴표 보호를 받는지 나타낸다.
 * - hadQuotes 는 "따옴표 조각이 하나라도 있었는가"다. 내용이 비어도 참일 수 있다.
 *   `""` 는 빈 단어를 남기고 `$EMPTY` 는 단어를 남기지 않는 차이가 여기서 갈린다.
 */
interface Field { text: string; quoted: boolean[]; hadQuotes: boolean }

const empty = (): Field => ({ text: '', quoted: [], hadQuotes: false })

function append(field: Field, text: string, quoted: boolean): void {
  field.text += text
  for (let i = 0; i < text.length; i++) field.quoted.push(quoted)
}

const IFS = [' ', '\t', '\n']

/**
 * $N / ${N} 하나를 읽는다. $0 은 스크립트/함수명 자리인데 지금은 항상 빈 문자열이다
 * (Task 7/8/9가 실제 값을 채운다 — positional 배열과는 별개 개념이다). $1은
 * positional[0], 배열 범위를 벗어나면(미설정) 빈 문자열 — 미설정 변수와 동일하게 취급한다.
 */
function positionalAt(ctx: ExpandCtx, n: number): string {
  if (n === 0) return ''
  return ctx.positional[n - 1] ?? ''
}

/**
 * `${name:?word}` 류의 파라미터 확장 오류(task 3). arith.ts 의 ArithError 와 같은 계약:
 * expandDollar 가 그대로 위로 던지고, interpreter 의 runSimpleCommand/runFor 에 있는
 * "확장 예외 → 얌전한 ExecResult" catch(`bash: ${errnoText(e)}\n`, exit 1)가 이미
 * Error 서브클래스 전부를 message 로 받아 처리한다 — interpreter.ts 는 이 클래스를
 * import 하거나 특별 취급할 필요가 없다(ArithError 전용 분기와 달리, ${:?}는 표준
 * exit 1 로 충분해 별도 분기가 없다). exec()는 절대 reject 하지 않는다.
 *
 * 메시지는 실측 bash 와 일치시킨다(docker debian:stable-slim bash 5):
 *  - `unset U; echo ${U:?boom}` → "bash: line 1: U: boom"
 *  - `unset U; echo ${U:?}`     → "...: U: parameter null or not set"
 *  - `unset U; echo ${U?}` (콜론 없음, word 없음) → "...: U: parameter not set"
 *    ("null" 이 빠진다 — `:` 유무로 기본 메시지도 갈린다, hadColon 파라미터로 반영)
 */
export class ParamExpansionError extends Error {
  constructor(name: string, detail: string, hadColon: boolean) {
    const fallback = hadColon ? 'parameter null or not set' : 'parameter not set'
    super(`${name}: ${detail !== '' ? detail : fallback}`)
    this.name = 'ParamExpansionError'
  }
}

/** `${...}` 안의 이름 하나(변수명 또는 위치 매개변수 토큰)를 값으로 푼 결과. */
interface ResolvedName { isSet: boolean; value: string; assignable: boolean }

const VARNAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** `${...}` 안에서 이름이 시작될 수 있는 자리(위치 매개변수 토큰 또는 셸 변수 이름). */
const NAME_RE = /^(?:[@*#]|[0-9]+|[A-Za-z_][A-Za-z0-9_]*)/

/**
 * `${...}` 안의 NAME 을 { 미설정여부, 값, (env에) 대입 가능여부 } 로 푼다. 위치 매개변수
 * ($N, $@, $*, $# 토큰)는 대입 불가(`${1:=x}` 는 브리프 지시대로 조용히 대입을 건너뛴다 — 실제
 * bash 는 "cannot assign in this way" 오류를 내지만 이 서브셋은 그 오류까지는 재현하지
 * 않는다). "미설정"과 "설정됐지만 빈 값"을 구분해야 `:-`(빈=미설정) vs `-`(빈≠미설정)
 * 가 갈린다(브리프 표 참고) — 그래서 값뿐 아니라 isSet 도 함께 돌려준다.
 */
function resolveName(ctx: ExpandCtx, name: string): ResolvedName {
  if (/^[0-9]+$/.test(name)) {
    const n = Number(name)
    return { isSet: n >= 1 && n <= ctx.positional.length, value: positionalAt(ctx, n), assignable: false }
  }
  if (name === '@' || name === '*') {
    return { isSet: ctx.positional.length > 0, value: ctx.positional.join(IFS[0]!), assignable: false }
  }
  if (name === '#') {
    return { isSet: true, value: String(ctx.positional.length), assignable: false }
  }
  if (VARNAME_RE.test(name)) {
    return { isSet: Object.prototype.hasOwnProperty.call(ctx.env, name), value: ctx.env[name] ?? '', assignable: true }
  }
  // 이름이 아예 인식 안 되는 형태(`${}` 등) — 관대하게 미설정 취급, 크래시하지 않는다.
  return { isSet: false, value: '', assignable: false }
}

/**
 * `${` 의 짝이 되는 `}` 를 찾는다(중괄호 깊이 카운트). start 는 여는 `{` 바로 다음 문자
 * 인덱스. 옛 코드(`indexOf('}')`)는 중첩 `${...}`(`${x:-${y}}`)나 치환 replacement 안의
 * `}`(task 4, `${x/a/b}`)에서 엉뚱한 `}` 를 짝으로 잡았다 — 여기서는 `{`/`}` 깊이만
 * 세고 depth 0 에서 만난 첫 `}` 를 짝으로 삼는다. 따옴표는 추적하지 않는다(브리프가
 * 명시한 "pragmatic" 단순화 — 이 서브셋에서 `${...}` 안에 따옴표 낀 arg는 다루지 않는다).
 * 못 찾으면 -1(호출부가 옛 동작대로 `${` 를 리터럴로 남긴다).
 */
function findBraceClose(source: string, start: number): number {
  let depth = 0
  for (let j = start; j < source.length; j++) {
    const c = source[j]
    if (c === '{') depth++
    else if (c === '}') {
      if (depth === 0) return j
      depth--
    }
  }
  return -1
}

/**
 * `${...}` 의 word(연산자 오른쪽 인자)를 재귀적으로 확장한다 — `$y`, `$(...)`, 중첩
 * `${...}` 전부 여기서 expandDollar 를 다시 태운다(`${UNSET:-$NAME}`, `${UNSET:-${NAME}}`
 * 둘 다 이 재귀로 해결된다). protectedResult 는 바깥 문맥(따옴표 보호 여부)을 그대로
 * 물려받는다 — `"${x:-$y}"` 안의 $y 도 따옴표 보호를 받아야 분할/글롭이 안 걸린다.
 */
async function expandNested(source: string, protectedResult: boolean, ctx: ExpandCtx): Promise<string> {
  const sub = empty()
  await expandDollar(source, protectedResult, sub, ctx)
  return sub.text
}

/**
 * `${...}` 안쪽 문자열(`inner`, 여닫는 중괄호 제외)을 해석해 최종 문자열을 낸다.
 * task 3 서브파서: 선행 `#`(길이) → NAME(VARNAME 또는 위치 매개변수 토큰) → 연산자
 * (`:` 유무 + 한 글자 `- = + ?`) → arg. 연산자가 없으면(rest==='') 기존 `${NAME}`/`${N}`
 * 동작 그대로다.
 *
 * 확장 지점(task 4가 여기에 케이스를 추가한다): `switch (opChar)` 에 `'#'`(최短
 * prefix 제거)/`'%'`(suffix 제거)/`'/'`(substitution) 케이스를 추가하면 된다 —
 * hasColon/unsetOrNull 계산은 그 케이스들엔 안 쓰이지만(bash에 `:#`/`:%`/`:/` 콜론
 * 변형이 없다) 구조상 방해되지 않는다. `##`/`%%`/`//`(최長/전역)는 opChar 다음 글자를
 * 한 번 더 봐서 갈라야 한다. 콜론+숫자(substring, `${x:off:len}`)는 연산자 문자가 아니라
 * 숫자/`-`로 시작하므로 `hasColon` 판정 직후, opChar 스위치보다 먼저 별도 분기가
 * 필요하다(`rest[1]`이 숫자 또는 `-` 인지 확인).
 */
async function expandBraceParam(inner: string, protectedResult: boolean, ctx: ExpandCtx): Promise<string> {
  // 길이형: ${#name} / ${#}(=$#) / ${#@} / ${#*}(브리프 지시대로 개수로 단순화). 선행
  // '#'가 열림 중괄호 바로 다음 글자일 때만 길이형이다 — `${name#pattern}`(task 4, 접두
  // 제거)은 '#'가 이름 *뒤*에 온다(이름 정규식이 먼저 이름을 다 먹은 뒤에야 rest로
  // 넘어가므로 여기 안 걸린다).
  if (inner[0] === '#') {
    const rest = inner.slice(1)
    if (rest === '' || rest === '@' || rest === '*') return String(ctx.positional.length)
    return String(resolveName(ctx, rest).value.length)
  }

  const nameMatch = NAME_RE.exec(inner)
  const name = nameMatch ? nameMatch[0] : ''
  const rest = inner.slice(name.length)

  if (rest === '') return resolveName(ctx, name).value // 연산자 없음 — 기존 ${NAME}/${N}

  const hasColon = rest[0] === ':'
  const opChar = hasColon ? rest[1] : rest[0]
  const argSource = rest.slice(hasColon ? 2 : 1)

  const resolved = resolveName(ctx, name)
  // `:` 있으면 "미설정 또는 빈 값" 둘 다 대상(:-/:=/:+/:?), `:` 없으면 "미설정만"
  // (-/=/+/?) — 브리프가 명시한 핵심 구분(`${EMPTY:-fb}`→fb 지만 `${EMPTY-fb}`→'').
  const unsetOrNull = !resolved.isSet || (hasColon && resolved.value === '')

  switch (opChar) {
    case '-': {
      if (unsetOrNull) return await expandNested(argSource, protectedResult, ctx)
      return resolved.value
    }
    case '=': {
      if (!unsetOrNull) return resolved.value
      const word = await expandNested(argSource, protectedResult, ctx)
      if (resolved.assignable) ctx.env[name] = word // 위치 매개변수는 대입하지 않는다.
      return word
    }
    case '+': {
      if (unsetOrNull) return ''
      return await expandNested(argSource, protectedResult, ctx)
    }
    case '?': {
      if (!unsetOrNull) return resolved.value
      const detail = await expandNested(argSource, protectedResult, ctx)
      throw new ParamExpansionError(name, detail, hasColon)
    }
    default:
      // 미구현 연산자(task 4가 `# ## % %% / // :off:len` 을 여기 채운다) — 크래시 대신
      // NAME 그대로의 값을 낸다(무연산자 폴백과 동일 취급).
      return resolved.value
  }
}

/** $VAR, ${VAR}, $?, $(...) 를 치환한다. protectedResult 면 결과 문자는 따옴표 보호를 받는다. */
async function expandDollar(source: string, protectedResult: boolean, field: Field, ctx: ExpandCtx): Promise<void> {
  let i = 0
  while (i < source.length) {
    const ch = source[i]!

    if (ch !== '$') { append(field, ch, protectedResult); i++; continue }

    // $((expr)) — 산술 확장. 반드시 $( 명령치환보다 먼저 잡아야 한다: matchSubstitutionEnd
    // 는 $(( 를 구분하지 않으므로, 이 분기가 없으면 `$((1+2))` 가 `(1+2)` 명령치환으로
    // 오인돼 조용히 빈 문자열이 된다(오늘의 버그). matchSubstitutionEnd 는 괄호 깊이를
    // 세므로 `$(( ... ))` 의 바깥 `)` 인덱스를 돌려준다 → 안쪽 `)` 는 close-1, 식은
    // source.slice(i+3, close-1). evalArith 가 던지는 오류(0 나누기·문법 오류 등)는 여기서
    // 잡지 않고 그대로 위로 흘린다 — runSimpleCommand 의 catch 가 얌전한 ExecResult
    // (stderr + exit 1)로 바꾼다(exec 은 reject 하지 않는다).
    if (source[i + 1] === '(' && source[i + 2] === '(') {
      const closeIndex = matchSubstitutionEnd(source, i)
      const expr = source.slice(i + 3, closeIndex - 1)
      append(field, String(evalArith(expr, ctx)), protectedResult)
      i = closeIndex + 1
      continue
    }

    // $(...) — 짝 찾기는 렉서와 공유하는 따옴표 인식 스캐너를 쓴다. 여기서 독자적으로
    // 괄호 깊이를 세면 따옴표 속 )를 짝으로 착각하는 버그를 다시 만들게 된다
    // (`echo $(echo ")")` 가 대표 사례 — lexer.ts 도 한때 이 버그가 있었다).
    if (source[i + 1] === '(') {
      const closeIndex = matchSubstitutionEnd(source, i)
      const script = source.slice(i + 2, closeIndex)
      const result = await ctx.runSubshell(script)
      // 명령치환 결과의 후행 개행은 전부 벗긴다. 이것이 bash 동작이다.
      const output = result.stdout.replace(/\n+$/, '')
      // 결과는 따옴표 보호를 물려받는다. 안 그러면 "$(x)"가 쪼개진다.
      append(field, output, protectedResult)
      i = closeIndex + 1
      continue
    }

    // $?
    if (source[i + 1] === '?') {
      append(field, String(ctx.lastExitCode), protectedResult)
      i += 2
      continue
    }

    // ${NAME} / ${N} / ${#NAME} / ${NAME:-word} 등 — 진짜 서브파서(task 3). 짝 찾기는
    // indexOf('}') 대신 중괄호 깊이 카운트(findBraceClose)를 쓴다 — 중첩 ${..}나 치환
    // replacement(task 4) 안의 }에서 옛 코드처럼 깨지지 않기 위해서다.
    if (source[i + 1] === '{') {
      const close = findBraceClose(source, i + 2)
      if (close === -1) { append(field, ch, protectedResult); i++; continue }
      const value = await expandBraceParam(source.slice(i + 2, close), protectedResult, ctx)
      append(field, value, protectedResult)
      i = close + 1
      continue
    }

    // $#, $@, $*, $0..$9 — 위치 매개변수. 이름 정규식(문자로 시작)보다 먼저 잡아야
    // 한다. 안 그러면 숫자/기호로 시작하는 이 이름들은 아래 이름 regex를 통과 못 해
    // 리터럴 $1 등으로 흘러버린다 (M1 시절 동작 — task 3부터 실제 확장 대상이다).
    const posChar = source[i + 1]
    if (posChar === '#') {
      append(field, String(ctx.positional.length), protectedResult)
      i += 2
      continue
    }
    if (posChar === '@' || posChar === '*') {
      // 기본형만 구현한다: 공백(IFS 첫 글자)으로 조인한 뒤, 그 결과를 기존
      // append/splitFields 경로에 그대로 태운다 — 따옴표 없는 $@/$*는 자연히
      // 인자별로 재분할되고(splitFields가 공백에서 쪼갠다), 따옴표 붙은 "$@"/"$*"는
      // 둘 다 공백-조인 단일 필드가 된다. "$@"의 진짜 bash 동작(인자마다 개별
      // 필드로 보존 — 인자 내부에 공백이 있어도 안 쪼개짐)은 여기 구현과 다르다.
      // 이 정밀 동작은 M3/Layer-3로 미룬다 — 지금은 크래시 없이 기본형으로만 동작.
      append(field, ctx.positional.join(IFS[0]!), protectedResult)
      i += 2
      continue
    }
    if (posChar !== undefined && posChar >= '0' && posChar <= '9') {
      append(field, positionalAt(ctx, Number(posChar)), protectedResult)
      i += 2
      continue
    }

    // $NAME
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i + 1))
    if (!match) { append(field, ch, protectedResult); i++; continue }
    append(field, ctx.env[match[0]] ?? '', protectedResult)
    i += 1 + match[0].length
  }
}

/** 따옴표 보호를 받지 않는 IFS 문자에서 필드를 쪼갠다. */
function splitFields(field: Field): Field[] {
  const out: Field[] = []
  let current = empty()
  let started = false

  for (let i = 0; i < field.text.length; i++) {
    const ch = field.text[i]!
    const isQuoted = field.quoted[i]!
    if (!isQuoted && IFS.includes(ch)) {
      if (started) { out.push(current); current = empty(); started = false }
      continue
    }
    append(current, ch, isQuoted)
    started = true
  }
  if (started) out.push(current)

  // 내용이 하나도 안 나왔지만 따옴표는 있었다면(`""`), 빈 단어 하나를 남긴다.
  if (out.length === 0 && field.hadQuotes) out.push(empty())
  return out
}

/**
 * 이 필드를 글롭 패턴으로 볼 것인가?
 * 따옴표 보호를 받지 않는 메타문자가 하나라도 있어야 패턴이다.
 *
 * 알려진 한계: 한 단어 안에 따옴표 보호를 받는 메타문자와 받지 않는 메타문자가
 * 섞이면(`"*"*`) 글롭하지 않고 리터럴로 취급한다. 진짜 bash는 글롭한다.
 * 문제 출제에서 이 조합을 쓰지 않는다.
 */
function globPattern(field: Field): string | null {
  let hasUnquotedMeta = false
  for (let i = 0; i < field.text.length; i++) {
    if (!field.quoted[i] && '*?['.includes(field.text[i]!)) hasUnquotedMeta = true
  }
  if (!hasUnquotedMeta) return null

  for (let i = 0; i < field.text.length; i++) {
    if (field.quoted[i] && '*?['.includes(field.text[i]!)) return null
  }
  return field.text
}

export async function expandWord(word: Word, ctx: ExpandCtx): Promise<string[]> {
  const field = empty()

  for (let index = 0; index < word.length; index++) {
    const part = word[index]!

    if (part.kind === 'literal') { field.hadQuotes = true; append(field, part.text, true); continue }
    if (part.kind === 'dquote') { field.hadQuotes = true; await expandDollar(part.text, true, field, ctx); continue }

    // raw: 맨 앞 조각의 맨 앞 ~ 만 홈으로 바꾼다.
    let text = part.text
    if (index === 0 && text.startsWith('~') && (text.length === 1 || text[1] === '/')) {
      append(field, ctx.home, true) // 홈 경로는 다시 분할되면 안 된다
      text = text.slice(1)
    }
    await expandDollar(text, false, field, ctx)
  }

  // 아무 조각도 없으면(있을 수 없지만) 빈 배열
  if (word.length === 0) return []

  const fields = splitFields(field)

  // 따옴표가 전혀 없고 내용도 비었으면 단어가 통째로 사라진다 ($NOPE, $EMPTY)
  if (fields.length === 0) return []

  const results: string[] = []
  for (const f of fields) {
    const pattern = globPattern(f)
    if (pattern === null) { results.push(f.text); continue }
    results.push(...expandGlob(pattern, ctx.cwd, ctx.fs))
  }
  return results
}

export async function expandToSingle(word: Word, ctx: ExpandCtx): Promise<string> {
  const results = await expandWord(word, ctx)
  if (results.length !== 1) throw new Error('ambiguous redirect')
  return results[0]!
}

/**
 * `case` 문의 WORD/PATTERN 전용 확장 (task 6). bash 매뉴얼: 둘 다 tilde·파라미터·
 * 명령치환·산술확장·따옴표제거만 거치고, 단어분리(IFS)도 경로명확장(파일시스템 글롭)도
 * 받지 않는다 — expandWord 는 이 둘을 다 하므로 여기 재사용할 수 없다(재사용하면
 * `case *.txt in *.txt) ...` 의 패턴이 실제 파일 목록으로 바뀌어 버린다 — glob.ts의
 * matchSegment 로 순수 fnmatch 매칭을 해야 하는데 미리 파일시스템에 물어버리는 꼴).
 * expandWord 의 raw 조각 루프(tilde 확장 + expandDollar)만 그대로 따라가고
 * splitFields/globPattern/expandGlob 단계를 건너뛴다 — 결과는 항상 문자열 하나
 * (빈 단어 포함, `""` 나 `$NOPE` 도 그냥 빈 문자열이지 단어 자체가 사라지지 않는다 —
 * case 에는 "인자가 사라진다" 개념이 없다).
 *
 * 알려진 단순화(브리프가 명시한 "keep it simple"): 패턴에 따옴표로 감싼 글롭
 * 메타문자가 있어도(`case xyz in "*") ...`) quoted 여부를 추적하지 않고 field.text
 * 를 그대로 matchSegment 에 넘기므로 여전히 와일드카드로 해석된다 — 진짜 bash 는
 * 따옴표로 감싼 메타문자를 리터럴화한다(docker 확인: `case xyz in "*") echo lit;;
 * *) echo other;; esac` → other, 우리 구현은 lit). 반대로 `$var` 안의 글롭 메타문자가
 * 그대로 패턴에 살아남는 것(`p='a*'; case abc in $p) ...` → match)은 실제 bash와
 * 일치한다(docker 확인) — 이건 단순화가 아니라 올바른 동작이다.
 */
export async function expandForCase(word: Word, ctx: ExpandCtx): Promise<string> {
  const field = empty()
  for (let index = 0; index < word.length; index++) {
    const part = word[index]!

    if (part.kind === 'literal') { append(field, part.text, true); continue }
    if (part.kind === 'dquote') { await expandDollar(part.text, true, field, ctx); continue }

    let text = part.text
    if (index === 0 && text.startsWith('~') && (text.length === 1 || text[1] === '/')) {
      append(field, ctx.home, true)
      text = text.slice(1)
    }
    await expandDollar(text, false, field, ctx)
  }
  return field.text
}
