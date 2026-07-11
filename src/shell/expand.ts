import type { VFS } from './vfs'
import type { Word } from './lexer'
import { expandGlob, matchSegment } from './glob'
import { matchSubstitutionEnd } from './subst'
import { evalArith, ArithError } from './arith'

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
 * - splittable[i] 는 text[i] 가 IFS 단어분할 대상인지다. bash 는 **확장 결과**(파라미터/
 *   명령/산술 확장)의 비따옴표 부분만 단어분할하고, 소스에 그대로 적힌 리터럴 문자는
 *   절대 분할하지 않는다. 기본 IFS(공백류)에서는 리터럴 공백이 렉서 단계에서 이미 단어를
 *   가르므로 이 구분이 안 보였지만(한 Word 안에 비따옴표 리터럴 공백은 없다), `IFS=:` 처럼
 *   비공백 IFS 에서는 `echo a:b:c` 의 리터럴 `:` 를 분할하면 안 되므로(bash: `a:b:c` 그대로)
 *   quoted 와 별개로 이 플래그가 필요하다. splittable=true 는 항상 quoted=false 를 함의한다.
 * - breaks 는 "하드 필드 경계"의 char 인덱스 목록이다(중복 허용, 기록 순서대로 비감소).
 *   경계 p 는 "인덱스 p 바로 앞에서 새 필드가 시작된다"는 뜻으로, IFS·따옴표와 무관하게
 *   splitFields 가 무조건 필드를 끊는다. `"$@"` 가 각 위치 인자를 개별 필드로 만들 때만
 *   쓰인다 — IFS 문자가 아닌 필드 경계는 이것 말고는 표현할 방법이 없다. 같은 위치에
 *   여러 경계가 있으면(연속 빈 위치 인자) 각각이 빈 필드를 만든다(그래서 Set 이 아니라
 *   배열이다 — Set 은 중복을 잃어 연속 빈 인자를 구분 못 한다).
 */
interface Field { text: string; quoted: boolean[]; splittable: boolean[]; hadQuotes: boolean; breaks: number[] }

const empty = (): Field => ({ text: '', quoted: [], splittable: [], hadQuotes: false, breaks: [] })

/** 저수준 append — quoted(따옴표 보호=글롭/분할 억제)와 splittable(IFS 분할 대상)을 명시한다. */
function append(field: Field, text: string, quoted: boolean, splittable: boolean): void {
  field.text += text
  for (let i = 0; i < text.length; i++) { field.quoted.push(quoted); field.splittable.push(splittable) }
}

/** 소스 리터럴 문자 append — 절대 IFS 분할되지 않는다(splittable=false). */
function appendLiteral(field: Field, text: string, quoted: boolean): void {
  append(field, text, quoted, false)
}

/**
 * 확장 결과 append — protectedResult(따옴표 안이면 true)면 보호받고 분할도 안 된다.
 * 비따옴표 확장 결과만 IFS 분할 대상이다(splittable = !protectedResult).
 */
function appendExpanded(field: Field, text: string, protectedResult: boolean): void {
  append(field, text, protectedResult, !protectedResult)
}

/** 현재 text 끝 위치에 하드 필드 경계를 기록한다. `"$@"` 인자 사이 경계 전용. */
function addBreak(field: Field): void {
  field.breaks.push(field.text.length)
}

/**
 * 현재 문맥의 IFS 문자 집합을 ctx.env.IFS 에서 읽는다(하드코딩 상수가 아니라).
 *  - 미설정(undefined) → 기본 `[' ', '\t', '\n']`
 *  - 빈 문자열 `''`    → `[]` (단어분할이 전혀 일어나지 않는다 — 확장 전체가 한 필드)
 *  - 그 외            → IFS 문자열의 서로 다른 문자들
 * 비공백 문자(예: `IFS=:`)는 분할 문자이자 `$*` 조인 문자가 된다(bash 실측).
 */
function ifsChars(ctx: ExpandCtx): string[] {
  const raw = ctx.env.IFS
  if (raw === undefined) return [' ', '\t', '\n']
  if (raw === '') return []
  return [...new Set(raw)]
}

/**
 * `$*` / `${*}` / 비따옴표 `$@`/`$*` 조인에 쓰는 분리자 — IFS 의 첫 글자다.
 * IFS 빈 문자열이면 분리자 없이(''), 미설정이면 스페이스. (bash 실측: `IFS=xyz; echo "$*"`
 * → `axbxc`, 즉 첫 글자 `x` 로 조인. `IFS=; echo "$*"` → 이어붙임.)
 */
function ifsJoinSep(ctx: ExpandCtx): string {
  const chars = ifsChars(ctx)
  return chars.length > 0 ? chars[0]! : ''
}

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
    // `${@}` / `${*}` 및 연산자형(`${@:-x}` 등)의 조인형 값. 여기서는 per-arg 하드 경계를
    // 표현할 수 없으므로(문자열 하나만 돌려준다) IFS 첫 글자로 조인한 단일 값이다 —
    // per-arg 는 bare `"$@"`(expandDollar 의 @/* 분기) 전용이다.
    return { isSet: ctx.positional.length > 0, value: ctx.positional.join(ifsJoinSep(ctx)), assignable: false }
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
 * 문자열 s 안에서 `(`/`{` 깊이가 0인 지점에 있는 target 문자의 첫 인덱스를 찾는다
 * (findBraceClose 와 같은 "pragmatic" 단순화 — 따옴표는 추적하지 않는다). task 4가
 * 두 군데에 쓴다:
 *  - substring `${x:off:len}` 의 두 번째 `:` — off 안에 괄호 낀 산술식(`${x:(a?1:2):3}`)
 *    이 있어도 안쪽 `:`를 분리자로 착각하지 않는다.
 *  - substitution `${x/pat/rep}` 의 pat/rep 구분자 `/` — pat/rep 안에 `$(...)`나
 *    `${...}` 가 있으면(`${x/$(echo a/b)/c}`) 그 안의 `/`를 분리자로 착각하지 않는다.
 */
function findTopLevelChar(s: string, target: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '(' || c === '{') depth++
    else if (c === ')' || c === '}') { if (depth > 0) depth-- }
    else if (depth === 0 && c === target) return i
  }
  return -1
}

/**
 * `${x#pat}`/`${x##pat}` 접두 제거. glob 엔진(matchSegment, glob.ts)으로 후보
 * 접두사를 짧은 쪽부터(`#`, shortest) 또는 긴 쪽부터(`##`, longest) 시험해 첫 매치를
 * 취한다. **`new RegExp(pattern)`으로 컴파일하지 않는다** — 이 서브셋 전체가 ReDoS
 * 회피를 위해 정규식 대신 matchSegment 의 선형 시간 두-포인터 매처를 쓰기로 한
 * 설계이고(glob.ts 주석 참고), 여기서 RegExp 로 되돌아가면 그 안전장치가 무의미해진다.
 * `dotglob:true` 를 쓴다 — 이건 경로명 글롭이 아니라 순수 문자열 패턴 매칭이라 선행
 * 점 보호가 적용되면 안 된다(docker 확인: `H=.hidden.txt; echo ${H#*.}` → `hidden.txt`;
 * dotglob:false 였다면 `*.`가 `.`로 시작하는 모든 후보를 거부해 매치가 전혀 안 됐을 것).
 * 매치가 하나도 없으면 원본 그대로(no-op) — 브리프 명시(`${F%.zzz}` → 그대로, docker 확인).
 */
function removePrefix(value: string, pattern: string, longest: boolean): string {
  if (pattern === '') return value
  if (longest) {
    for (let k = value.length; k >= 0; k--) {
      if (matchSegment(pattern, value.slice(0, k), { dotglob: true })) return value.slice(k)
    }
  } else {
    for (let k = 0; k <= value.length; k++) {
      if (matchSegment(pattern, value.slice(0, k), { dotglob: true })) return value.slice(k)
    }
  }
  return value
}

/** `${x%pat}`/`${x%%pat}` 접미 제거 — removePrefix 와 대칭(후보를 오른쪽에서부터 자른다). */
function removeSuffix(value: string, pattern: string, longest: boolean): string {
  if (pattern === '') return value
  const len = value.length
  if (longest) {
    for (let k = len; k >= 0; k--) {
      if (matchSegment(pattern, value.slice(len - k), { dotglob: true })) return value.slice(0, len - k)
    }
  } else {
    for (let k = 0; k <= len; k++) {
      if (matchSegment(pattern, value.slice(len - k), { dotglob: true })) return value.slice(0, len - k)
    }
  }
  return value
}

/**
 * pos 위치에서 시작하는 가장 긴 매치의 끝 인덱스를 찾는다 — bash 의 "leftmost longest"
 * 규칙 중 longest 부분(leftmost 는 호출부가 pos 를 왼쪽부터 늘려가며 담당한다). 후보를
 * 긴 것부터(value.length 부터 pos+1 까지 내려오며) 시험한다 — docker 확인:
 * `S=hello; echo ${S/l*\/X}` → `heX`. pos=2 에서 짧은 쪽부터 시험했다면 "l" 한 글자만
 * 먹고 `heXlo`가 됐을 것 — longest-at-leftmost 가 아니면 틀린다. 매치 없으면 -1.
 */
function longestMatchAt(pattern: string, value: string, pos: number): number {
  for (let end = value.length; end > pos; end--) {
    if (matchSegment(pattern, value.slice(pos, end), { dotglob: true })) return end
  }
  if (matchSegment(pattern, '', { dotglob: true })) return pos // 빈 문자열에도 매치하는 패턴(예: `*`)
  return -1
}

/** `${x/pat/rep}`(all=false, 첫 매치만) / `${x//pat/rep}`(all=true, 전체 — 비중첩, 왼쪽부터 순차). */
function substituteScan(value: string, pattern: string, rep: string, all: boolean): string {
  if (pattern === '') return value
  let result = ''
  let i = 0
  let replaced = false
  while (i < value.length) {
    if (all || !replaced) {
      const end = longestMatchAt(pattern, value, i)
      if (end !== -1 && end > i) {
        result += rep
        i = end
        replaced = true
        continue
      }
    }
    result += value[i]
    i++
  }
  return result
}

/** `${x/#pat/rep}` — pat 이 문자열 시작에서 매치할 때만 치환(최長 접두, `##`와 같은 방향). */
function substituteAnchoredStart(value: string, pattern: string, rep: string): string {
  if (pattern === '') return value
  for (let end = value.length; end >= 0; end--) {
    if (matchSegment(pattern, value.slice(0, end), { dotglob: true })) return rep + value.slice(end)
  }
  return value
}

/** `${x/%pat/rep}` — pat 이 문자열 끝에서 매치할 때만 치환(최長 접미, `%%`와 같은 방향). */
function substituteAnchoredEnd(value: string, pattern: string, rep: string): string {
  if (pattern === '') return value
  for (let pos = 0; pos <= value.length; pos++) {
    if (matchSegment(pattern, value.slice(pos), { dotglob: true })) return value.slice(0, pos) + rep
  }
  return value
}

/**
 * `${x:offset}` / `${x:offset:length}` 부분 문자열. offset/length 는 산술식이다 —
 * task 1의 evalArith 를 그대로 재사용한다(`${x:1+1:1+1}` 도 동작). bash 실측
 * (docker debian:stable-slim bash 5, 전부 확인):
 *  - offset < 0 이면 문자열 끝에서부터 재해석한다(`len+offset`). 재해석 후에도 0보다
 *    작거나 len 보다 크면 그냥 빈 문자열이다 — 에러가 아니다(`${S: -100}` → ''). 이
 *    시점에 이미 범위를 벗어났으면 length 는 평가는 하되(부작용 보존) 검사하지 않고
 *    바로 빈 문자열을 반환한다(`${S:6:-1}` → '' — length 오류조차 안 낸다, docker로
 *    offset(6) > len(5) 케이스에서 확인. 이건 length 검사 전에 조기 반환되기 때문).
 *  - length 생략 → 끝까지.
 *  - length >= 0 → offset+length 까지(len 넘으면 clamp) — `${S:0:100}` → 'hello'.
 *  - length < 0 → "문자열 끝에서 |length| 만큼 뺀 위치까지"(`end = len+length`,
 *    offset 기준이 아니라 전체 길이 기준). 이 end 가 offset 보다 작으면(구간이
 *    뒤집히면) 실제 bash 는 그 명령을 런타임 에러 "N: substring expression < 0"로
 *    실패시키고, non-interactive 스크립트 전체가 죽는다(docker: `${S:0:-6}` 이후
 *    출력이 전부 사라짐). 이 서브셋은 task 1(`$((1/0))`)·task 3(`${:?}`)이 이미 정한
 *    단순화를 그대로 따른다 — ArithError 를 던져 그 명령 하나만 실패시키고 스크립트는
 *    계속한다(interpreter.ts 의 기존 generic catch가 ArithError 를 이미
 *    `bash: ${errnoText}\n`/exit 1 로 처리하므로 interpreter.ts 는 한 글자도 안
 *    고쳐도 된다).
 */
function substringOp(spec: string, value: string, ctx: ExpandCtx): string {
  const sep = findTopLevelChar(spec, ':')
  const offSource = sep === -1 ? spec : spec.slice(0, sep)
  const lenSource = sep === -1 ? undefined : spec.slice(sep + 1)

  const len = value.length
  let offset = evalArith(offSource, ctx)
  const rawLen = lenSource === undefined ? undefined : evalArith(lenSource, ctx)

  if (offset < 0) offset += len
  if (offset < 0 || offset > len) return ''

  if (rawLen === undefined) return value.slice(offset)

  let end: number
  if (rawLen < 0) {
    end = len + rawLen
    if (end < offset) throw new ArithError(`${rawLen}: substring expression < 0`)
  } else {
    end = offset + rawLen
    if (end > len) end = len
  }
  return value.slice(offset, end)
}

/**
 * `${...}` 안쪽 문자열(`inner`, 여닫는 중괄호 제외)을 해석해 최종 문자열을 낸다.
 * 서브파서 문법: 선행 `#`(길이) → NAME(VARNAME 또는 위치 매개변수 토큰) → 연산자
 * (`:` 유무 + 한 글자 `- = + ?` [task 3], 또는 `# ## % %%`[접두/접미 제거], `/ // /# /%`
 * [치환], `:off[:len]`[부분문자열] [task 4]) → arg. 연산자가 없으면(rest==='') 기존
 * `${NAME}`/`${N}` 동작 그대로다.
 *
 * substring 은 opChar 스위치에 들어가지 않고 그 앞에서 따로 갈린다 — 연산자 문자가
 * 아니라 산술식(숫자/`-`/`(`/공백 등)으로 시작하기 때문이다. `hasColon` 판정 직후,
 * opChar 가 기존 4개 연산자(`- = + ?`) 중 하나가 *아닐* 때만 substring 으로 분기한다.
 * 이 판정이 바로 `${S:-2}`(→ `:-` 기본값 연산자, S 가 설정돼 있으므로 결과는 S 자신)와
 * `${S: -2}`/`${S:(-2)}`(→ substring, offset -2) 의 차이다 — 실제 bash 도 정확히 이렇게
 * 갈린다(docker 확인). 브리프가 언급한 "음수 offset 은 공백/괄호가 필요하다"는 지시가
 * 바로 이 충돌 회피 규칙이다.
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
  const resolved = resolveName(ctx, name)

  // 부분문자열: `${name:offset[:length]}`. `:` 바로 다음 글자가 기존 4개 연산자
  // (`- = + ?`) 중 하나가 아닐 때만 여기로 분기한다 — `${S:-2}`는 `:-`(기본값) 연산자가
  // 먼저 먹는다(실제 bash 동작, docker 확인).
  if (hasColon && opChar !== '-' && opChar !== '=' && opChar !== '+' && opChar !== '?') {
    return substringOp(rest.slice(1), resolved.value, ctx)
  }

  const argSource = rest.slice(hasColon ? 2 : 1)
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
    // 아래 세 케이스는 `:` 콜론 변형이 없다(hasColon 은 항상 false로 여기 도달) — 이름
    // 바로 뒤에 `# % /` 가 온다. rest[1]을 한 번 더 봐서 `## %% //`(최長/전역)를 가른다.
    case '#': {
      const long = rest[1] === '#'
      const patSource = rest.slice(long ? 2 : 1)
      const pattern = await expandNested(patSource, protectedResult, ctx)
      return removePrefix(resolved.value, pattern, long)
    }
    case '%': {
      const long = rest[1] === '%'
      const patSource = rest.slice(long ? 2 : 1)
      const pattern = await expandNested(patSource, protectedResult, ctx)
      return removeSuffix(resolved.value, pattern, long)
    }
    case '/': {
      // ${x/pat/rep} 첫 매치, ${x//pat/rep} 전체, ${x/#pat/rep} 시작 고정, ${x/%pat/rep} 끝 고정.
      let mode: 'first' | 'all' | 'start' | 'end' = 'first'
      let specStart = 1
      if (rest[1] === '/') { mode = 'all'; specStart = 2 }
      else if (rest[1] === '#') { mode = 'start'; specStart = 2 }
      else if (rest[1] === '%') { mode = 'end'; specStart = 2 }
      const spec = rest.slice(specStart)
      // pat/rep 구분자 `/`는 depth-0(괄호/중괄호 밖)인 첫 자리 — pat/rep 안의 $(...)나
      // ${...}에 낀 `/`를 분리자로 착각하지 않는다(findTopLevelChar).
      const sepIdx = findTopLevelChar(spec, '/')
      const patSource = sepIdx === -1 ? spec : spec.slice(0, sepIdx)
      const repSource = sepIdx === -1 ? '' : spec.slice(sepIdx + 1)
      // pat/rep 는 그 자체로 재확장 대상이다(task 3 이 default-value arg 에 쓴 것과 같은
      // expandNested 재사용) — `${x/$a/$b}`. rep 는 비어 있을 수 있다(`${x//pat/}` → 삭제).
      const pattern = await expandNested(patSource, protectedResult, ctx)
      const rep = await expandNested(repSource, protectedResult, ctx)
      if (mode === 'start') return substituteAnchoredStart(resolved.value, pattern, rep)
      if (mode === 'end') return substituteAnchoredEnd(resolved.value, pattern, rep)
      return substituteScan(resolved.value, pattern, rep, mode === 'all')
    }
    default:
      // 알 수 없는/미지원 연산자 — 크래시 대신 NAME 그대로의 값을 낸다(무연산자 폴백과 동일).
      return resolved.value
  }
}

/** $VAR, ${VAR}, $?, $(...) 를 치환한다. protectedResult 면 결과 문자는 따옴표 보호를 받는다. */
async function expandDollar(source: string, protectedResult: boolean, field: Field, ctx: ExpandCtx): Promise<void> {
  let i = 0
  while (i < source.length) {
    const ch = source[i]!

    if (ch !== '$') { appendLiteral(field, ch, protectedResult); i++; continue }

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
      appendExpanded(field, String(evalArith(expr, ctx)), protectedResult)
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
      // 결과는 따옴표 보호를 물려받는다. 안 그러면 "$(x)"가 쪼개진다. 비따옴표면 확장
      // 결과이므로 IFS 단어분할 대상이다(appendExpanded).
      appendExpanded(field, output, protectedResult)
      i = closeIndex + 1
      continue
    }

    // $?
    if (source[i + 1] === '?') {
      appendExpanded(field, String(ctx.lastExitCode), protectedResult)
      i += 2
      continue
    }

    // ${NAME} / ${N} / ${#NAME} / ${NAME:-word} 등 — 진짜 서브파서(task 3). 짝 찾기는
    // indexOf('}') 대신 중괄호 깊이 카운트(findBraceClose)를 쓴다 — 중첩 ${..}나 치환
    // replacement(task 4) 안의 }에서 옛 코드처럼 깨지지 않기 위해서다.
    if (source[i + 1] === '{') {
      const close = findBraceClose(source, i + 2)
      if (close === -1) { appendLiteral(field, ch, protectedResult); i++; continue }
      const value = await expandBraceParam(source.slice(i + 2, close), protectedResult, ctx)
      appendExpanded(field, value, protectedResult)
      i = close + 1
      continue
    }

    // $#, $@, $*, $0..$9 — 위치 매개변수. 이름 정규식(문자로 시작)보다 먼저 잡아야
    // 한다. 안 그러면 숫자/기호로 시작하는 이 이름들은 아래 이름 regex를 통과 못 해
    // 리터럴 $1 등으로 흘러버린다 (M1 시절 동작 — task 3부터 실제 확장 대상이다).
    const posChar = source[i + 1]
    if (posChar === '#') {
      appendExpanded(field, String(ctx.positional.length), protectedResult)
      i += 2
      continue
    }
    if (posChar === '@' || posChar === '*') {
      const args = ctx.positional
      if (protectedResult && posChar === '@') {
        // "$@": 각 위치 인자를 개별 필드로 보존한다 — 인자 내부에 공백/IFS 가 있어도
        // 안 쪼개지고, 인접 인자 사이에는 하드 경계를 넣는다(IFS 와 무관). 첫 인자 앞·
        // 마지막 인자 뒤에는 경계를 넣지 않으므로 같은 단어의 앞뒤 텍스트에 붙는다
        // (`"pre$@post"` → preA, B, Cpost). 인자가 없으면 아무것도 안 붙이고 경계도
        // 안 남긴다 → "$@" 는 통째로 사라진다(빈 필드조차 아님; hadQuotes 도 안 세운다,
        // expandWord 참고). 첫 인자 이후 각 인자 앞에 하드 경계를 기록한다.
        for (let a = 0; a < args.length; a++) {
          if (a > 0) addBreak(field)
          appendExpanded(field, args[a]!, true) // 보호됨: IFS 분할 안 됨(하드 경계로만 나뉨)
        }
      } else if (protectedResult && posChar === '*') {
        // "$*": IFS 첫 글자로 조인한 단일 필드(IFS 빈 문자열이면 이어붙임). 하드 경계 없음.
        appendExpanded(field, args.join(ifsJoinSep(ctx)), true)
      } else {
        // 비따옴표 $@ / $*: IFS 첫 글자로 조인한 뒤 unprotected 로 넣어, splitFields 가
        // env IFS 로 단어분할하게 한다(둘 다 결과적으로 IFS 로 재분할된다 — 차이는
        // 따옴표 붙었을 때만 드러난다).
        appendExpanded(field, args.join(ifsJoinSep(ctx)), false)
      }
      i += 2
      continue
    }
    if (posChar !== undefined && posChar >= '0' && posChar <= '9') {
      appendExpanded(field, positionalAt(ctx, Number(posChar)), protectedResult)
      i += 2
      continue
    }

    // $NAME
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i + 1))
    if (!match) { appendLiteral(field, ch, protectedResult); i++; continue }
    appendExpanded(field, ctx.env[match[0]] ?? '', protectedResult)
    i += 1 + match[0].length
  }
}

/**
 * 필드를 (1) 하드 경계(field.breaks — IFS·따옴표와 무관하게 무조건)와 (2) splittable(비따옴표
 * 확장 결과)인 IFS 문자에서 쪼갠다. ifs 는 ctx.env.IFS 에서 파싱된 문자 집합이다(빈 배열이면
 * IFS 분할이 전혀 일어나지 않고 하드 경계만 적용된다).
 *
 * 하드 경계는 무조건 필드를 끊는다 — 인접 `"$@"` 인자가 빈 문자열이어도 빈 필드를 남긴다.
 * 경계 뒤에는 반드시 한 필드가 뒤따르므로(breakPending), 마지막 인자가 비어도 필드로 남는다.
 * IFS 분할은 반대로 "started" 인 필드만 끊고 연속 IFS/선행·후행 IFS 를 접는다(기존 동작 유지).
 */
function splitFields(field: Field, ifs: string[]): Field[] {
  const out: Field[] = []
  let current = empty()
  let started = false
  let breakPending = false // 하드 경계가 방금 커밋한 "뒤따를 필드" — 비어도 emit 해야 한다
  const breaks = field.breaks
  let bIdx = 0
  const len = field.text.length

  for (let p = 0; p <= len; p++) {
    // 하드 경계: 이 위치의 경계를 전부 소진한다. 같은 위치에 여러 개면(연속 빈 인자)
    // 각각이 필드 하나를 무조건 밀어낸다.
    while (bIdx < breaks.length && breaks[bIdx] === p) {
      out.push(current)
      current = empty()
      started = false
      breakPending = true
      bIdx++
    }
    if (p === len) break

    const ch = field.text[p]!
    const isQuoted = field.quoted[p]!
    const isSplittable = field.splittable[p]!
    // 확장 결과의 비따옴표 부분(splittable)만 IFS 로 쪼갠다 — 리터럴 소스 문자는
    // splittable=false 라 `IFS=:` 에서도 `echo a:b:c` 가 안 잘린다(bash 동작).
    if (isSplittable && ifs.includes(ch)) {
      if (started) { out.push(current); current = empty(); started = false }
      continue
    }
    append(current, ch, isQuoted, isSplittable)
    started = true
    breakPending = false
  }
  if (started || breakPending) out.push(current)

  // 내용이 하나도 안 나왔지만 따옴표는 있었다면(`""`, `"$*"` 빈 인자 등), 빈 단어 하나를
  // 남긴다. (`"$@"` 빈 인자는 hadQuotes 를 세우지 않아 여기 안 걸린다 — expandWord 참고.)
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

    if (part.kind === 'literal') { field.hadQuotes = true; appendLiteral(field, part.text, true); continue }
    if (part.kind === 'dquote') {
      // 따옴표 조각은 보통 "따옴표 있었음"을 세워 빈 필드(`""`→빈 단어)를 정당화한다.
      // 단, 조각 전체가 바로 `$@` 뿐이면 예외다: bash 는 인자 없는 `"$@"` 를 빈 필드조차
      // 아니라 통째로 사라지게 한다(docker: `set --; for a in "$@"; do echo x; done` → 무출력).
      // `"$*"` 나 `""` 는 빈 따옴표 null 을 남기지만 `"$@"` 만 유일하게 안 남긴다.
      if (part.text !== '$@') field.hadQuotes = true
      await expandDollar(part.text, true, field, ctx)
      continue
    }

    // raw: 맨 앞 조각의 맨 앞 ~ 만 홈으로 바꾼다.
    let text = part.text
    if (index === 0 && text.startsWith('~') && (text.length === 1 || text[1] === '/')) {
      appendLiteral(field, ctx.home, true) // 홈 경로는 리터럴 — 다시 분할되면 안 된다
      text = text.slice(1)
    }
    await expandDollar(text, false, field, ctx)
  }

  // 아무 조각도 없으면(있을 수 없지만) 빈 배열
  if (word.length === 0) return []

  const fields = splitFields(field, ifsChars(ctx))

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

    if (part.kind === 'literal') { appendLiteral(field, part.text, true); continue }
    if (part.kind === 'dquote') { await expandDollar(part.text, true, field, ctx); continue }

    let text = part.text
    if (index === 0 && text.startsWith('~') && (text.length === 1 || text[1] === '/')) {
      appendLiteral(field, ctx.home, true)
      text = text.slice(1)
    }
    await expandDollar(text, false, field, ctx)
  }
  return field.text
}
