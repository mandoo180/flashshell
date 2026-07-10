import type { CommandFn, ExecResult } from '../types'

/**
 * GNU xargs 는 서브커맨드의 raw exit code 를 그대로 돌려주지 않는다 — docker
 * debian:stable-slim coreutils 9.7 로 확인한 자체 규약:
 *   - 0                         → 0
 *   - 1~125 (서브커맨드가 정말 그 코드로 종료)           → 123
 *   - 255                                              → 124 (그리고 즉시 중단)
 *   - 명령을 아예 못 찾음(우리 셸에서는 127)             → 127 (그리고 즉시 중단)
 * 우리 셸에서 127 은 오직 "command not found"/"미구현 명령"에서만 나오므로(어떤
 * coreutil 도 진짜 실행 결과로 127 을 exit code 로 쓰지 않는다) exitCode===127 을
 * "실행 자체가 안 됐다"는 신호로 그대로 믿고 GNU 처럼 즉시 멈춘다.
 */
function translateExitCode(code: number): number {
  if (code === 0) return 0
  if (code === 127) return 127
  if (code === 255) return 124
  return 123
}

/** 이 결과가 남은 반복을 중단시켜야 하는가(GNU: 255 종료 또는 명령 못 찾음은 즉시 중단). */
function shouldAbort(code: number): boolean {
  return code === 255 || code === 127
}

/**
 * `xargs [-I REPL] [CMD [ARG...]]` — stdin 의 각 토큰(공백/개행 분할)을 CMD 뒤에
 * 이어붙여 한 번 실행한다. CMD 생략 시 기본 `echo`. `-I REPL` 이면 입력을 줄 단위로
 * 쪼개 줄마다 CMD 를 한 번씩 돌리고 REPL 을 그 줄로 치환한다(토큰 전체가 아니라
 * 토큰 안에 끼어 있어도 치환됨 — GNU 와 동일, docker로 확인).
 */
export const xargs: CommandFn = async (e) => {
  if (!e.runLine) return { stdout: '', stderr: 'xargs: unavailable\n', exitCode: 1 }
  const args = [...e.args]
  let replace: string | undefined

  // Handle -I flag: both -I REPL (separate) and -IREPL (attached) forms.
  if (args[0] === '-I') {
    replace = args[1]
    args.splice(0, 2)
  } else if (args[0]?.startsWith('-I') && args[0].length > 2) {
    replace = args[0].slice(2)
    args.splice(0, 1)
  }

  const cmd = args.length > 0 ? args : ['echo']

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  if (replace !== undefined) {
    // -I: 입력을 줄 단위로 쪼갠다. GNU 는 각 줄의 "선행" 공백/탭만 지우고(빈 줄은
    // 건너뜀) 후행 공백은 보존한다 — docker로 확인: `printf "  a  \n" | xargs -I{}
    // echo "[{}]"` → "[a  ]" (뒤 공백 둘 살아있음). trim() 을 쓰면 뒤 공백까지
    // 지워져 GNU 와 어긋난다.
    const lines = e.stdin.split('\n')
      .map((l) => l.replace(/^[ \t]+/, ''))
      .filter((l) => l !== '')
    for (const inputLine of lines) {
      const line = cmd.map((tok) => tok.split(replace!).join(inputLine)).join(' ')
      const r: ExecResult = await e.runLine(line)
      stdout += r.stdout
      stderr += r.stderr
      if (r.exitCode !== 0) {
        exitCode = translateExitCode(r.exitCode)
        if (shouldAbort(r.exitCode)) break
      }
    }
  } else {
    // 모든 토큰을 명령 뒤에 이어붙여 한 번 실행한다. stdin 이 비어 있어도(또는
    // 공백뿐이어도) GNU 기본 동작대로 한 번은 돈다(-r/--no-run-if-empty 없음) —
    // docker로 확인: `printf "" | xargs echo hello` → "hello". 게임 규모에선 GNU의
    // ARG_MAX 분할은 무의미해 생략한다.
    const tokens = e.stdin.split(/\s+/).filter((t) => t !== '')
    const line = [...cmd, ...tokens].join(' ')
    const r: ExecResult = await e.runLine(line)
    stdout = r.stdout
    stderr = r.stderr
    exitCode = translateExitCode(r.exitCode)
  }
  return { stdout, stderr, exitCode }
}
