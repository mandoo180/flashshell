import type { CommandFn, CommandOutput } from '../types'
import { ifsChars } from '../expand'

/**
 * `read` 빌트인(단일 라인, M3 Part 3 task 4 + task 6 커서). 기본은 `e.stdin` 위에서 한 번만
 * 읽지만(파이프/리다이렉션에서 온 그대로), `while read`/`for` 루프가 `e.stdinCursor`(가변
 * 커서)를 주입하면 거기서 논리 줄 하나를 소비하고 커서를 갱신한다 — 그래서 반복마다 다음
 * 줄을 읽고, 소진되면 exit 1 로 루프가 끝난다(task 6, StdinCursor 주석 참고).
 *
 * 전부 docker debian:stable-slim bash 5.2.37 실측(task-4-report.md 참고):
 *  - 논리 줄 하나를 읽어 변수(들)에 대입한다. 논리 줄은 물리 줄과 다를 수 있다 — `-r`
 *    없이 줄 끝(개행 직전)에 `\`가 있으면 그 `\`+개행을 지우고 다음 물리 줄과 이어붙인다
 *    (줄이어짐: `printf 'a\\\nb\n'` → 논리 줄 "ab"). `-r`이면 이어짐 없이 첫 물리 줄만.
 *  - `-r` 없으면 `\` 다음 한 글자를 리터럴로 보존하고 `\` 자체는 지운다 — 그 글자는
 *    IFS 분할 대상에서도 빠진다(`a\ b`, 1개 변수 → "a b" 한 필드, 공백이 구분자로 안 먹힘).
 *  - 변수 이름이 0개면 전체 논리 줄이 **가공 없이**(트림도 분할도 안 함) `$REPLY`에
 *    들어간다(bash 매뉴얼 "assigned ... otherwise unmodified" — 앞뒤 공백 있는 줄도
 *    REPLY는 트림 안 됨; 명시적 `read REPLY`는 1개 변수 규칙대로 트림됨).
 *  - 변수 이름이 1개 이상이면 IFS로 단어분할한다(POSIX 규칙, expand.ts의 scanSegment와
 *    동일): 마지막 변수 앞까지는 각 변수가 "선행 IFS-공백 스킵 → 다음 구분자까지" 한
 *    단어씩 먹고, 그 뒤의 구분자 하나는 "IFS-공백 실행 → 선택적 비공백 하나 → 뒤따르는
 *    IFS-공백 실행"을 통째로 삼킨다(혼합 IFS에서 `a  ::b`, `IFS=' :'` → 필드 "a" 다음
 *    구분자는 "  :" 전체 하나, 남은 ":b"가 다음 필드로 — docker 확인). 인접한 두
 *    비공백 구분자는 그 사이에 빈 필드를 만든다. 마지막 변수는 남은 전체를 갖되 선행
 *    IFS-공백만 스킵하고 후행 IFS-**공백**만 벗긴다(비공백 구분자는 후행이라도 안
 *    벗겨짐 — `IFS=: read a b`, 입력 ":x:y:" → a='' b='x:y:').
 *  - 단어 수보다 변수가 많으면 남는 변수는 빈 문자열.
 *  - 개행을 못 만나고 EOF면(빈 stdin 포함, 또는 마지막 줄에 개행이 없어도) exit 1 —
 *    단 그때까지 읽은 내용은 그래도 대입된다(부분 대입 후 실패).
 *  - 잘못된 식별자(`read 1abc`)는 그 이름에서 즉시 멈추고(그 앞 이름들은 이미
 *    대입된 채로 남는다) exit 1. 알 수 없는 플래그(`read -x`)는 exit 2.
 *
 * **파이프 격리:** `echo hi | read v`가 밖에서 `$v`를 안 남기는 건 이 파일의 책임이
 * 아니다 — 인터프리터가 파이프 스테이지를 이미 `childCtx`(격리된 state.env 사본)로
 * 돌리므로, `e.state.env[name] = ...`가 그 사본에만 쓰이고 밖으로 안 샌다(회귀는
 * read.test.ts의 exec() 통합 테스트가 확인한다).
 */

const isAlpha = (c: string): boolean => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/** bash 변수 식별자 규칙: `[A-Za-z_][A-Za-z0-9_]*`. RegExp 없이 문자 단위로 검사한다. */
function isValidName(name: string): boolean {
  if (name.length === 0) return false
  const first = name[0]!
  if (!isAlpha(first) && first !== '_') return false
  for (let i = 1; i < name.length; i++) {
    const c = name[i]!
    if (!isAlpha(c) && !isDigit(c) && c !== '_') return false
  }
  return true
}

const isIfsWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n'

// IFS 문자 집합 판정(미설정→기본 공백류, 빈 문자열→분할 없음, 그 외→서로 다른 문자들)은
// expand.ts 의 ifsChars 를 그대로 쓴다(M3 Part 4 task 4 B7) — 예전엔 이 파일에 똑같은
// 로직의 사본이 있었다.

interface LogicalLine { text: string; protectedIdx: boolean[]; hitNewline: boolean; consumed: number }

/**
 * stdin에서 논리 줄 하나를 읽는다(백슬래시 처리 포함). `protectedIdx[i]`는 `text[i]`가
 * 백슬래시로 이스케이프됐는지(그래서 IFS 분할 대상에서 빠지는지)를 나타낸다. `consumed`는
 * 이 논리 줄이 소비한 stdin 앞부분의 **문자 수**다(개행·줄이어짐 `\`+개행 포함) — `while
 * read` 커서(task 6)가 `stdin.slice(consumed)`로 다음 줄로 넘어가는 데 쓴다. 물리 줄과
 * 논리 줄이 다를 수 있어(줄이어짐) `text.length`로는 구할 수 없다.
 */
function readLogicalLine(stdin: string, raw: boolean): LogicalLine {
  let text = ''
  const protectedIdx: boolean[] = []
  let i = 0
  let hitNewline = false
  while (i < stdin.length) {
    const ch = stdin[i]!
    if (ch === '\n') { hitNewline = true; i++; break }
    if (!raw && ch === '\\') {
      const next = stdin[i + 1]
      if (next === '\n') { i += 2; continue } // 줄이어짐: \+개행 둘 다 버리고 계속
      if (next === undefined) { i += 1; continue } // 끝에 홀로 남은 \: 버림(EOF)
      text += next
      protectedIdx.push(true)
      i += 2
      continue
    }
    text += ch
    protectedIdx.push(false)
    i += 1
  }
  return { text, protectedIdx, hitNewline, consumed: i }
}

/**
 * 필드 하나(선행 IFS-공백 스킵 → 다음 구분자까지) + 그 뒤 논리적 구분자 하나(IFS-공백
 * 실행 → 선택적 비공백 하나 → 뒤따르는 IFS-공백 실행, expand.ts scanSegment 와 동일 규칙)를
 * 소비하고 필드 값과 갱신된 pos 를 돌려준다. splitForRead(마지막 아닌 변수)와
 * splitForReadArray(-a, 모든 원소가 이 규칙)가 공유하는 스캔 단위다.
 */
function consumeIfsField(
  text: string,
  n: number,
  posIn: number,
  isDelim: (p: number) => boolean,
  isWsDelim: (p: number) => boolean,
  isNonWsDelim: (p: number) => boolean,
): { field: string; pos: number } {
  let pos = posIn
  while (pos < n && isWsDelim(pos)) pos++
  const start = pos
  while (pos < n && !isDelim(pos)) pos++
  const field = text.slice(start, pos)
  if (pos < n) {
    while (pos < n && isWsDelim(pos)) pos++
    if (pos < n && isNonWsDelim(pos)) {
      pos++
      while (pos < n && isWsDelim(pos)) pos++
    }
  }
  return { field, pos }
}

function delimPredicates(text: string, protectedIdx: boolean[], ifs: string[]) {
  const ifsSet = new Set(ifs)
  const isDelim = (p: number): boolean => !protectedIdx[p] && ifsSet.has(text[p]!)
  const isWsDelim = (p: number): boolean => isDelim(p) && isIfsWhitespace(text[p]!)
  const isNonWsDelim = (p: number): boolean => isDelim(p) && !isIfsWhitespace(text[p]!)
  return { isDelim, isWsDelim, isNonWsDelim }
}

/** 논리 줄을 nVars 개로 나눈다(마지막이 나머지). RegExp 없이 문자 단위 스캔(ReDoS 무관). */
function splitForRead(text: string, protectedIdx: boolean[], ifs: string[], nVars: number): string[] {
  const n = text.length
  const { isDelim, isWsDelim, isNonWsDelim } = delimPredicates(text, protectedIdx, ifs)

  let pos = 0
  const results: string[] = []
  for (let v = 0; v < nVars - 1; v++) {
    const r = consumeIfsField(text, n, pos, isDelim, isWsDelim, isNonWsDelim)
    results.push(r.field)
    pos = r.pos
  }

  if (nVars >= 1) {
    while (pos < n && isWsDelim(pos)) pos++
    let end = n
    while (end > pos && isWsDelim(end - 1)) end--
    results.push(text.slice(pos, end))
  }
  return results
}

/**
 * `read -a`(M3 Part 4 task 2) 전용: 논리 줄 전체를 필드로 나누되, splitForRead 와 달리
 * "마지막 필드는 나머지 전체(비공백 구분자는 후행이라도 안 벗김)" 규칙이 없다 — 모든
 * 필드가 consumeIfsField 의 같은 스캔 단위(마지막 아닌 변수와 동일 규칙)를 쓴다. docker로
 * 확인: 후행 비공백 구분자 하나(`a:` + IFS=:)는 유령 빈 원소를 안 만들고(구분자로 그냥
 * 소비됨), 인접한 두 비공백 구분자(`a::b`)만 그 사이에 빈 원소를 만든다(`a`,``,`b`).
 */
function splitForReadArray(text: string, protectedIdx: boolean[], ifs: string[]): string[] {
  const n = text.length
  const { isDelim, isWsDelim, isNonWsDelim } = delimPredicates(text, protectedIdx, ifs)

  const results: string[] = []
  let pos = 0
  while (pos < n) {
    const r = consumeIfsField(text, n, pos, isDelim, isWsDelim, isNonWsDelim)
    results.push(r.field)
    pos = r.pos
  }
  return results
}

/**
 * `-r`/`-a NAME` 을 지원한다. `--` 이후는 전부 변수 이름. 그 외 플래그는 error 로 얌전히
 * 거부.
 *
 * `-a` 는 getopt 스타일 "부착 인자"를 받는다 — docker 로 `read -ar arr`/`read -aXYZ extra`/
 * `read -ra arr` 세 가지를 다 실측(task-2-report.md "Fix: -a attached-argument parsing"
 * 참고):
 *  - 같은 토큰 안에서 `a` 뒤에 문자가 **남아 있으면**(`-ar`, `-aXYZ`) 그 나머지 전체가
 *    배열 이름이고, 그 문자들은 플래그로 재해석되지 않는다 — `read -ar arr` 은 "r"이
 *    배열 이름이 되어 배열 **r**이 만들어지고(raw 는 안 켜짐 — 그 r 은 -r 플래그가 아니라
 *    이름의 일부였으니까), 두 번째 인자 "arr" 은 그대로 남아 있다가(스칼라 이름 취급)
 *    -a 가 이겨서 무시된다 → arr 은 unset. `read -aXYZ extra` 도 마찬가지로 배열 이름은
 *    "XYZ", "extra" 는 unset.
 *  - `a` 가 토큰의 **마지막 글자**면(`-ra`, `-a` 단독) 이름은 다음 argv 토큰에서 온다 —
 *    `read -ra arr` 은 r 다음 a 라 raw 켜짐 + 이름은 다음 토큰 "arr". 다음 토큰이
 *    없으면(`read -a` 단독) exit 2 "option requires an argument"(docker 확인).
 */
function parseArgs(
  args: string[],
): { raw: boolean; names: string[]; arrayName?: string } | { error: string } | { missingArg: string } {
  let raw = false
  let arrayName: string | undefined
  const names: string[] = []
  let optionsEnded = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (optionsEnded) { names.push(arg); continue }
    if (arg === '--') { optionsEnded = true; continue }
    if (arg === '-' || !arg.startsWith('-')) { names.push(arg); continue }
    for (let j = 1; j < arg.length; j++) {
      const ch = arg[j]!
      if (ch === 'r') { raw = true; continue }
      if (ch === 'a') {
        const suffix = arg.slice(j + 1)
        if (suffix.length > 0) {
          // 같은 토큰에 남은 문자는 배열 이름 전체다(getopt 부착 인자) — 더 이상 이
          // 토큰을 플래그로 스캔하지 않는다(`-ar`의 "r"이 -r 로 재해석되지 않음).
          arrayName = suffix
          break
        }
        i++
        if (i >= args.length) return { missingArg: '-a' }
        arrayName = args[i] // i 는 바깥 for 의 갱신식이 다시 +1 하므로, 다음 바깥 순회는 그 다음 토큰부터.
        continue
      }
      return { error: arg }
    }
  }
  return { raw, names, arrayName }
}

export const read: CommandFn = (e): CommandOutput => {
  const parsed = parseArgs(e.args)
  if ('error' in parsed) {
    return {
      stdout: '',
      stderr: `bash: read: ${parsed.error}: invalid option\nread: usage: read [-r] [-a array] [name ...]\n`,
      exitCode: 2,
    }
  }
  if ('missingArg' in parsed) {
    return {
      stdout: '',
      stderr: `bash: read: ${parsed.missingArg}: option requires an argument\nread: usage: read [-r] [-a array] [name ...]\n`,
      exitCode: 2,
    }
  }
  const { raw, names, arrayName } = parsed

  // 커서가 주입됐으면(while/for 루프 본문, task 6) `e.stdin`이 아니라 커서의 남은 입력에서
  // 읽고, 소비한 만큼 커서를 앞에서 잘라 갱신한다 — 그래서 같은 커서를 공유하는 다음
  // 반복의 read 가 그 다음 줄을 읽는다. 커서가 없으면(단독 `read v < file`, 파이프
  // `echo x | read v`) 예전대로 `e.stdin`을 한 번만 읽는다. 갱신은 REPLY(이름 0개)/일반
  // 분기보다 먼저 해 두 경로 모두 커서를 전진시킨다.
  const cursor = e.stdinCursor
  const source = cursor ? cursor.rest : e.stdin
  const line = readLogicalLine(source, raw)
  if (cursor) cursor.rest = source.slice(line.consumed)
  const exitCode = line.hitNewline ? 0 : 1

  if (arrayName !== undefined) {
    // -a 가 있으면 배열이 이긴다: 뒤에 남는 이름들(예: `read -a arr extra`)은 통째로
    // 무시된다(docker 확인 — extra 는 대입은커녕 unset 인 채로 남는다). 모든 필드가
    // 원소가 된다 — 스칼라 read 의 "마지막 변수가 나머지" 규칙이 없다.
    if (!isValidName(arrayName)) {
      return { stdout: '', stderr: `bash: read: \`${arrayName}': not a valid identifier\n`, exitCode: 1 }
    }
    const fields = splitForReadArray(line.text, line.protectedIdx, ifsChars(e.state.env))
    e.state.arrays.set(arrayName, fields)
    return { stdout: '', stderr: '', exitCode }
  }

  if (names.length === 0) {
    // 인자 없음: 전체 논리 줄을 가공 없이(트림/분할 없이) REPLY 에 넣는다.
    e.state.env.REPLY = line.text
    return { stdout: '', stderr: '', exitCode }
  }

  const values = splitForRead(line.text, line.protectedIdx, ifsChars(e.state.env), names.length)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    if (!isValidName(name)) {
      return { stdout: '', stderr: `bash: read: \`${name}': not a valid identifier\n`, exitCode: 1 }
    }
    e.state.env[name] = values[i] ?? ''
  }
  return { stdout: '', stderr: '', exitCode }
}
