//
// 서브셋: 단일 명령 스크립트. s/re/repl/[g], -n+p (Np, /re/p, p), Nd, /re/d.
// -e / ; 로 여러 명령 잇기, hold space, 그 밖의 sed 언어 전체는 미지원.
import type { CommandFn } from '../types'
import { errnoText, isDirectoryError, parseFlags, readSources, toLines } from './shared'

type Op =
  | { kind: 'subst'; re: RegExp; repl: string; global: boolean }
  | { kind: 'print'; addr: Addr }
  | { kind: 'delete'; addr: Addr }
type Addr = { kind: 'line'; n: number } | { kind: 're'; re: RegExp } | { kind: 'all' }

/**
 * 파싱 실패는 두 갈래다: `scope: 'flashshell'`은 서브셋 밖(여러 명령, 미지원
 * 플래그, 모르는 명령 문자)이라 GNU 흉내를 내지 않고 정직하게 거부하는 경우고,
 * `scope: 'regex'`는 정규식 자체가 컴파일에 실패한 경우라 GNU 스러운 문구를 쓴다.
 */
type ParseError = { error: true; scope: 'flashshell' | 'regex'; detail: string }

const outOfScope = (detail: string): ParseError => ({ error: true, scope: 'flashshell', detail })
const badRegex = (detail: string): ParseError => ({ error: true, scope: 'regex', detail })

/** sed repl 의 &, \N, \& 를 JS String.replace 의 $&, $N, & 로 옮긴다. */
function toJsReplacement(repl: string): string {
  let out = ''
  for (let i = 0; i < repl.length; i++) {
    const ch = repl[i]!
    if (ch === '\\') {
      const next = repl[i + 1]
      if (next === '&') { out += '&'; i++ }        // \& → 리터럴 &
      else if (next && /[1-9]/.test(next)) { out += `$${next}`; i++ } // \1 → $1
      else if (next === 'n') { out += '\n'; i++ }
      else if (next === '\\') { out += '\\'; i++ }
      else out += '\\'
    } else if (ch === '&') out += '$&'             // & → 매치 전체
    else if (ch === '$') out += '$$'               // 리터럴 $ 보호
    else out += ch
  }
  return out
}

/**
 * `/pattern/cmd` 형태의 주소를 수동으로 왼쪽부터 스캔한다. 정규식 기반 파싱
 * (`/^\/(.*)\/([pd])$/`)은 `.*`가 탐욕적이라 `/hello/p;/goodbye/d` 같은
 * 두-명령 스크립트를 "패턴이 `hello/p;/goodbye`인 단일 명령"으로 잘못 통과시켜
 * 버린다(끝에서부터 역추적해 마지막 `/`+단일문자를 찾아버림 — 브리프 코드의
 * 실제 결함, Nd/s///와 달리 테스트로는 못 잡았다). sed 는 이스케이프되지 않은
 * 첫 `/`를 닫는 구분자로 보므로, 그와 똑같이 왼쪽에서부터 스캔해 첫 닫는
 * 구분자를 찾고, 그 뒤에 명령 문자(`p`/`d`) 하나만 남아있는지 확인해야 한다 —
 * 더 남은 게 있으면(예: `;`로 이어진 두 번째 명령) 서브셋 밖으로 거부한다.
 */
function parseAddressCommand(script: string): Op | ParseError | undefined {
  if (!script.startsWith('/')) return undefined
  let i = 1
  let pattern = ''
  while (i < script.length && script[i] !== '/') {
    if (script[i] === '\\' && script[i + 1] === '/') { pattern += '/'; i += 2; continue }
    pattern += script[i]
    i++
  }
  if (script[i] !== '/') return badRegex('unterminated address regex')
  i++ // 닫는 '/' 넘김
  const cmdChar = script[i]
  if ((cmdChar !== 'p' && cmdChar !== 'd') || i !== script.length - 1) {
    return outOfScope(script) // 남은 문자가 더 있다 — 여러 명령을 이었다는 뜻.
  }
  let re: RegExp
  try { re = new RegExp(pattern) } catch { return badRegex('invalid regex') }
  const addr: Addr = { kind: 're', re }
  return cmdChar === 'p' ? { kind: 'print', addr } : { kind: 'delete', addr }
}

function parseScript(script: string): Op | ParseError {
  // s/re/repl/flags
  if (script.startsWith('s') && script.length > 1) {
    const delim = script[1]!
    const parts: string[] = ['']
    for (let i = 2; i < script.length; i++) {
      if (script[i] === '\\' && script[i + 1] === delim) { parts[parts.length - 1] += delim; i++; continue }
      if (script[i] === delim) { parts.push(''); continue }
      parts[parts.length - 1] += script[i]!
    }
    if (parts.length < 3) return badRegex(`unterminated \`s' command`)
    // parts.length 가 3보다 크면 flags 자리에 구분자가 더 있었다는 뜻이다 — 보통
    // `;`로 이어붙인 두 번째 s 명령이 flags 자리에 섞여든 경우다
    // (예: `s/a/b/;s/c/d/` → parts = ['a','b',';s','c','d','']). 이 서브셋의 flags 는
    // ''(첫 매치만) 또는 'g'(전역) 딱 두 가지만 지원하므로, 그 밖의 어떤 내용이든
    // (여분의 구분자로 쪼개졌든 한 조각 안에 `;`로 뭉쳐있든) 그대로 거부한다.
    // 브리프 코드는 parts[2] 만 보고 나머지를 조용히 버렸다 — 그 결함의 수정.
    const [pattern, repl, ...flagParts] = parts
    const flags = flagParts.join(delim)
    if (flags !== '' && flags !== 'g') return outOfScope(script)
    let re: RegExp
    try { re = new RegExp(pattern!, flags === 'g' ? 'g' : '') } catch { return badRegex('invalid regex') }
    return { kind: 'subst', re, repl: toJsReplacement(repl!), global: flags === 'g' }
  }
  // Np / Nd
  const numMatch = /^(\d+)([pd])$/.exec(script)
  if (numMatch) {
    const addr: Addr = { kind: 'line', n: Number(numMatch[1]) }
    return numMatch[2] === 'p' ? { kind: 'print', addr } : { kind: 'delete', addr }
  }
  // /re/p , /re/d
  const addrOp = parseAddressCommand(script)
  if (addrOp) return addrOp
  // 벌거벗은 p / d
  if (script === 'p') return { kind: 'print', addr: { kind: 'all' } }
  if (script === 'd') return { kind: 'delete', addr: { kind: 'all' } }
  return outOfScope(script)
}

function addrMatches(addr: Addr, line: string, lineNo: number): boolean {
  if (addr.kind === 'all') return true
  if (addr.kind === 'line') return lineNo === addr.n
  return addr.re.test(line)
}

export const sed: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  // -e 는 "여러 -e 로 명령을 잇는" 용도라 서브셋 밖이다(계약: 단일 명령 스크립트만).
  // 단일 -e 사용도 함께 거부한다 — parseFlags 는 -e 가 값을 받는지 모르므로,
  // 여러 -e 를 허용하면 두 번째 스크립트 조각이 파일명으로 잘못 읽힌다.
  if (flags.has('e')) {
    return { stdout: '', stderr: 'flashshell: sed: -e 옵션은 이 환경에서 지원하지 않습니다\n', exitCode: 127 }
  }
  const quiet = flags.has('n')
  const script = rest[0]
  if (script === undefined) return { stdout: '', stderr: 'sed: no script\n', exitCode: 1 }

  const op = parseScript(script)
  if ('error' in op) {
    if (op.scope === 'flashshell') {
      return {
        stdout: '',
        stderr: `flashshell: sed: 이 환경이 지원하지 않는 스크립트입니다: ${op.detail}\n`,
        exitCode: 127,
      }
    }
    return { stdout: '', stderr: `sed: -e expression #1, char 0: ${op.detail}\n`, exitCode: 1 }
  }

  // GNU sed 의 파일 에러 문구·종료코드는 cat/head/grep 과 다르다. docker
  // debian:stable-slim sed 4.9 실측:
  //   `sed 's/a/b/' missing.txt` -> "sed: can't read missing.txt: No such file or directory" exit=2
  //   `sed 's/a/b/' somedir`     -> "sed: read error on somedir: Is a directory" exit=4 (ENOENT 보다 우선)
  // readSources 의 기본 포매터(`${e.name}: ${file}: ${msg}`)를 쓰면 문구도 종료코드도
  // 다 틀린다 — sawDirError 로 실제로 EISDIR 을 만났는지 추적해 종료코드를 고른다.
  let sawDirError = false
  const formatReadError = (file: string, err: unknown): string => {
    if (isDirectoryError(err)) {
      sawDirError = true
      return `sed: read error on ${file}: ${errnoText(err)}`
    }
    return `sed: can't read ${file}: ${errnoText(err)}`
  }
  const { sources, stderr, failed } = readSources(e, rest.slice(1), formatReadError)
  let stdout = ''
  let lineNo = 0
  for (const source of sources) {
    for (const line of toLines(source.text)) {
      lineNo++
      if (op.kind === 'subst') {
        const replaced = line.replace(op.re, op.repl)
        if (!quiet) stdout += `${replaced}\n`
      } else if (op.kind === 'delete') {
        if (!addrMatches(op.addr, line, lineNo) && !quiet) stdout += `${line}\n`
      } else {
        // print
        if (!quiet) stdout += `${line}\n`
        if (addrMatches(op.addr, line, lineNo)) stdout += `${line}\n`
      }
    }
  }
  const exitCode = failed ? (sawDirError ? 4 : 2) : 0
  return { stdout, stderr, exitCode }
}
