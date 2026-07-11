import type { CommandFn, CommandOutput } from '../types'

/**
 * `read` 빌트인(단일 라인, M3 Part 3 task 4). `while read`용 mutable stdin 커서는
 * task 6 — 여기서는 `e.stdin` 위에서 한 번만 읽는다(파이프/리다이렉션에서 온 그대로).
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
 *  - 변수 이름이 1개 이상이면 IFS로 단어분할한다: 마지막 변수 앞까지는 각 변수가
 *    "선행 IFS-공백 스킵 → 다음 구분자까지" 한 단어씩 먹고, 구분자가 IFS-공백이면
 *    뒤따르는 연속 IFS-공백도 함께 삼킨다(런 전체가 구분자 하나), IFS-비공백이면 그
 *    한 글자만 삼킨다(연속 비공백은 그 사이에 빈 필드를 만든다). 마지막 변수는 남은
 *    전체를 갖되 선행 IFS-공백만 스킵하고 후행 IFS-**공백**만 벗긴다(비공백 구분자는
 *    후행이라도 안 벗겨짐 — `IFS=: read a b`, 입력 ":x:y:" → a='' b='x:y:').
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

/** IFS 문자 집합. 미설정→기본 공백류, 빈 문자열→분할 없음, 그 외→서로 다른 문자들. */
function ifsChars(env: Record<string, string>): string[] {
  const raw = env.IFS
  if (raw === undefined) return [' ', '\t', '\n']
  if (raw === '') return []
  const out: string[] = []
  for (const c of raw) if (!out.includes(c)) out.push(c)
  return out
}

interface LogicalLine { text: string; protectedIdx: boolean[]; hitNewline: boolean }

/**
 * stdin에서 논리 줄 하나를 읽는다(백슬래시 처리 포함). `protectedIdx[i]`는 `text[i]`가
 * 백슬래시로 이스케이프됐는지(그래서 IFS 분할 대상에서 빠지는지)를 나타낸다.
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
  return { text, protectedIdx, hitNewline }
}

/** 논리 줄을 nVars 개로 나눈다(마지막이 나머지). RegExp 없이 문자 단위 스캔(ReDoS 무관). */
function splitForRead(text: string, protectedIdx: boolean[], ifs: string[], nVars: number): string[] {
  const ifsSet = new Set(ifs)
  const n = text.length
  const isDelim = (p: number): boolean => !protectedIdx[p] && ifsSet.has(text[p]!)
  const isWsDelim = (p: number): boolean => isDelim(p) && isIfsWhitespace(text[p]!)

  let pos = 0
  const skipLeadingWs = (): void => { while (pos < n && isWsDelim(pos)) pos++ }

  const results: string[] = []
  for (let v = 0; v < nVars - 1; v++) {
    skipLeadingWs()
    if (pos >= n) { results.push(''); continue }
    const start = pos
    while (pos < n && !isDelim(pos)) pos++
    results.push(text.slice(start, pos))
    if (pos < n) {
      if (isWsDelim(pos)) { pos++; while (pos < n && isWsDelim(pos)) pos++ }
      else pos++
    }
  }

  if (nVars >= 1) {
    skipLeadingWs()
    let end = n
    while (end > pos && isWsDelim(end - 1)) end--
    results.push(text.slice(pos, end))
  }
  return results
}

/** `-r`만 지원한다. `--` 이후는 전부 변수 이름. 그 외 플래그는 error 로 얌전히 거부. */
function parseArgs(args: string[]): { raw: boolean; names: string[] } | { error: string } {
  let raw = false
  const names: string[] = []
  let optionsEnded = false
  for (const arg of args) {
    if (optionsEnded) { names.push(arg); continue }
    if (arg === '--') { optionsEnded = true; continue }
    if (arg === '-' || !arg.startsWith('-')) { names.push(arg); continue }
    for (let j = 1; j < arg.length; j++) {
      const ch = arg[j]!
      if (ch === 'r') { raw = true; continue }
      return { error: arg }
    }
  }
  return { raw, names }
}

export const read: CommandFn = (e): CommandOutput => {
  const parsed = parseArgs(e.args)
  if ('error' in parsed) {
    return {
      stdout: '',
      stderr: `bash: read: ${parsed.error}: invalid option\nread: usage: read [-r] [name ...]\n`,
      exitCode: 2,
    }
  }
  const { raw, names } = parsed

  const line = readLogicalLine(e.stdin, raw)
  const exitCode = line.hitNewline ? 0 : 1

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
