import type { CommandEnv, CommandFn } from '../types'
import { ok, fail } from '../types'

/**
 * `test` / `[` 서브셋. task-2-brief 가 정한 범위:
 *   파일: -e -f -d -r -w -x -s
 *   문자열: -z -n bare S1=S2 S1!=S2
 *   정수: -eq -ne -lt -le -gt -ge
 *   부정: ! EXPR
 * 2-인자 `-a`/`-o` 는 결합자가 아니라 단항이다(bash): `-a FILE`=파일 존재(-e), `-o OPT`=
 * 셸 옵션 검사 — `-a` 는 -e 로 구현, `-o` 는 옵션 미모델링이라 항상 거짓. 반면 3개 이상
 * 인자의 `-a`/`-o` 는 deprecated AND/OR 결합자이며 서브셋 밖 — flashshell: 로 거부한다.
 *
 * 모든 exit code/문구는 docker debian:stable-slim bash 5.2.37 실측이다
 * (task-2-report.md 참고). bash 자신도 test/[ 오류를 "bash: <name>: ..." 프리픽스로
 * 낸다(실제로는 "bash: line N: <name>: ..." 지만 우리는 라인 번호를 추적하지 않으므로
 * interpreter.ts 의 다른 bash 흉내 메시지들과 같은 규칙으로 그 부분만 뺀다) — 이 코드베이스
 * 관례상 "flashshell:" 은 우리가 만든 서브셋 제한 메시지에만 쓰고, 진짜 bash 문구를
 * 그대로 재현하는 메시지엔 "bash:" 를 쓴다(interpreter.ts 의 command-not-found 등과 동일).
 */

const UNARY_FILE_OPS = new Set(['-e', '-f', '-d', '-r', '-w', '-x', '-s'])
const UNARY_STRING_OPS = new Set(['-z', '-n'])
const BINARY_STRING_OPS = new Set(['=', '!='])
const BINARY_INT_OPS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge'])

type Outcome = { kind: 'value'; truth: boolean } | { kind: 'error'; message: string }

const value = (truth: boolean): Outcome => ({ kind: 'value', truth })
const error = (message: string): Outcome => ({ kind: 'error', message })

/** 3개 이상 인자의 -a/-o(deprecated AND/OR 결합자)를 거부한다. bash 는 정상 평가하지만
 *  우리 서브셋은 미구현이라 절대 반쪽으로 흉내내지 않는다. (2-인자 단항 -a/-o 는 위
 *  evalArgs 의 n===2 분기에서 따로 처리한다.) */
const combinatorRejected = (e: CommandEnv): Outcome =>
  error(`flashshell: ${e.name}: -a/-o 결합자는 이 환경에서 지원하지 않습니다\n`)

/**
 * 정수 피연산자 검증. docker 실측: 앞뒤 공백(" 3", "3 ")과 부호(+3, -3)는 허용하고,
 * 소수점(3.5)·16진수(0x10)·빈 문자열은 거부한다. 선행 0(010)은 8진수가 아니라
 * 10진수로 읽는다(010 -eq 10 → 참, docker 실측) — parseInt(..., 10) 이 그대로 맞다.
 */
function parseIntStrict(s: string): number | null {
  const m = /^\s*([+-]?\d+)\s*$/.exec(s)
  if (!m) return null
  return parseInt(m[1]!, 10)
}

function applyUnary(op: string, operand: string, e: CommandEnv): boolean {
  if (op === '-z') return operand === ''
  if (op === '-n') return operand !== ''

  // 파일 술어. lstat 사용(심볼릭 링크를 따라가지 않는다) — 브리프 지시대로.
  // 없으면(lstat null) 전부 거짓이다: `[ -f nonexistent ]` 는 오류가 아니라 1이다.
  const abs = e.fs.resolve(operand, e.state.cwd)
  const node = e.fs.lstat(abs)
  if (!node) return false
  switch (op) {
    case '-e': return true
    case '-f': return node.kind === 'file'
    case '-d': return node.kind === 'dir'
    // VFS 는 EACCES 를 절대 던지지 않는다(errors.ts 에 코드만 정의돼 있고 실제로
    // 발생시키는 곳이 없다) — 플레이어가 볼 수 있는 건 전부 읽기/쓰기 가능하다는
    // 게 이 엔진의 설계다. docker 로 root 로 확인해도(권한 비트 무시) 결과가 같다:
    // chmod 000 파일도 -r/-w 는 참이다. 그래서 -r/-w 는 사실상 존재 여부와 같다.
    case '-r': return true
    case '-w': return true
    // -x 만 실제 mode 비트를 본다(브리프 지시: mode & 0o111).
    case '-x': return (node.mode & 0o111) !== 0
    case '-s': return node.content.length > 0
    default: return false // 도달 불가(호출부에서 UNARY_FILE_OPS 로 이미 걸렀다)
  }
}

function applyBinary(a: string, op: string, b: string, e: CommandEnv): Outcome {
  if (op === '=') return value(a === b)
  if (op === '!=') return value(a !== b)

  // 정수 비교. 왼쪽부터 검증 — docker 실측: "3 -lt abc"는 abc를, "abc -lt 3"은 abc를
  // (즉 먼저 걸리는 피연산자를) 지목한다.
  const na = parseIntStrict(a)
  if (na === null) return error(`bash: ${e.name}: ${a}: integer expression expected\n`)
  const nb = parseIntStrict(b)
  if (nb === null) return error(`bash: ${e.name}: ${b}: integer expression expected\n`)

  switch (op) {
    case '-eq': return value(na === nb)
    case '-ne': return value(na !== nb)
    case '-lt': return value(na < nb)
    case '-le': return value(na <= nb)
    case '-gt': return value(na > nb)
    case '-ge': return value(na >= nb)
    default: return value(false) // 도달 불가
  }
}

/**
 * POSIX test 알고리즘을 우리 서브셋 범위로 축소한 버전. argc 로 분기한다(bash 의
 * 실제 test.c 도 이렇게 한다):
 *   0개 → 거짓(오류 아님)
 *   1개 → 빈 문자열이 아니면 참 (모양이 -f/-z/=/! 처럼 연산자 같아도 무조건 리터럴 —
 *          docker 실측: `[ -f ]`, `[ = ]`, `[ ! ]` 전부 참(0))
 *   앞이 '!' 면 → 나머지를 재귀 평가한 뒤 부정 (이 분기가 1개-인자 분기 "다음"에
 *          있어야 `[ ! ]`(단일 인자 "!")가 부정이 아니라 리터럴로 처리된다 — 순서 중요)
 *   2개 → 단항 연산자 + 피연산자
 *   3개 → 피연산자 + 이항 연산자 + 피연산자 (가운데가 연산자, docker 로 확인:
 *          `[ -f x y ]`도 가운데 x 를 이항 연산자 자리로 검사해 실패한다 — arg[0]이
 *          단항 연산자처럼 보여도 3개일 땐 절대 단항으로 안 푼다)
 *   4개+ → -a/-o 가 섞여 있으면 거부, 아니면 bash 그대로 "too many arguments"
 */
function evalArgs(args: string[], e: CommandEnv): Outcome {
  const n = args.length
  if (n === 0) return value(false)
  if (n === 1) return value(args[0] !== '')

  if (args[0] === '!') {
    const inner = evalArgs(args.slice(1), e)
    return inner.kind === 'error' ? inner : value(!inner.truth)
  }

  if (n === 2) {
    const [op, operand] = args as [string, string]
    // bash 의 2-인자 -a/-o 는 "결합자"가 아니라 단항이다(docker 실측):
    //   `-a FILE`    = 파일 존재(-e 의 동의어) → 0/1
    //   `-o OPTNAME` = 셸 옵션 검사 → 0/1
    // (-a/-o 의 deprecated 결합자 형태는 3개 이상 인자일 때만이며, 그건 아래에서 거부한다.)
    if (op === '-a') return value(applyUnary('-e', operand, e))
    // 셸 옵션을 모델링하지 않으므로 어떤 옵션도 미설정(거짓)으로 본다. docker: 옵션명이
    // 아니거나 꺼진 옵션에 대해 `[ -o X ]` → 1 과 일치한다(기본-on 옵션은 어긋나지만
    // L5 퍼즐에서 도달 불가).
    if (op === '-o') return value(false)
    if (!UNARY_FILE_OPS.has(op) && !UNARY_STRING_OPS.has(op)) {
      return error(`bash: ${e.name}: ${op}: unary operator expected\n`)
    }
    return value(applyUnary(op, operand, e))
  }

  if (n === 3) {
    const [a, op, b] = args as [string, string, string]
    if (op === '-a' || op === '-o') return combinatorRejected(e)
    if (!BINARY_STRING_OPS.has(op) && !BINARY_INT_OPS.has(op)) {
      return error(`bash: ${e.name}: ${op}: binary operator expected\n`)
    }
    return applyBinary(a, op, b, e)
  }

  // 4개 이상 — 우리 서브셋에 이 인자수를 정당하게 만드는 문법이 없다(부정은 이미 위
  // 분기에서 한 번 벗겨졌다). -a/-o 가 있으면 그게 이유일 가능성이 높으니 우리 메시지로,
  // 아니면 bash 그대로 "too many arguments".
  if (args.includes('-a') || args.includes('-o')) return combinatorRejected(e)
  return error(`bash: ${e.name}: too many arguments\n`)
}

export const testCmd: CommandFn = (e) => {
  let args = e.args

  // `[` 는 마지막 인자가 반드시 `]`여야 한다. docker 실측: 인자가 0개여도(그냥 `[`),
  // 마지막이 `]`가 아니어도 전부 exit 2 + "missing `]'" (평가 전에 이 검사가 먼저다).
  if (e.name === '[') {
    if (args.length === 0 || args[args.length - 1] !== ']') {
      return fail(`bash: [: missing \`]'\n`, 2)
    }
    args = args.slice(0, -1)
  }

  const outcome = evalArgs(args, e)
  if (outcome.kind === 'error') return fail(outcome.message, 2)
  return outcome.truth ? ok() : fail('', 1)
}
