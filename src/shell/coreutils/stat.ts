import type { CommandFn } from '../types'
import { parseFlags, byteLength } from './shared'

const KIND_NAME: Record<'file' | 'dir' | 'symlink', string> = {
  file: 'regular file',
  dir: 'directory',
  symlink: 'symbolic link',
}

/**
 * 형식 문자열을 한 번의 훑음으로 치환한다. `.replace(/%n/g,...).replace(/%s/g,...)`
 * 처럼 체이닝하면, 앞선 치환이 끼워 넣은 값(예: 파일명에 우연히 "%s"라는 글자가
 * 있는 경우) 이 뒤의 치환에 또 걸릴 수 있다. 콜백 하나로 원본 문자열만 한 번 훑어
 * 그런 재귀적 치환을 원천적으로 막는다.
 *
 * task-10 finding 3: `%%` 는 리터럴 `%` 하나로 접혀야 한다 — 예전 정규식
 * (`/%[nsaF]/g`) 은 `%` 자체를 토큰 집합에 안 넣어서 `%%end` 를 그대로 흘려보냈다.
 * docker debian:stable-slim coreutils 9.7 실측: `stat -c '%n%%end' a.txt` -> "a.txt%end".
 * 정규식이 `%%` 를 먼저 시도하도록 앞에 둬서(대안 순서), `%%n` 같은 입력이
 * `%%` + `n`(리터럴 n) 이 아니라 `%` 다음에 별개의 `%n` 토큰으로 잘못 묶이지
 * 않게 한다.
 *
 * `%z`, `%q` 처럼 우리가 모르는 토큰은 문자 집합(`[nsaF]`)에 없으므로 애초에
 * 정규식이 매칭하지 않는다 — 즉 손대지 않고 원문 그대로 남긴다. GNU 실제로는
 * (docker 실측) 모르는 한 글자 토큰을 "?" 로 접거나(`%q` -> "?"), 진짜로 정의된
 * 토큰이면 그 값을 낸다(`%z` 는 사실 GNU 의 정식 토큰 — 상태변경시각 — 이라
 * "모르는 토큰"의 예로 부적절했다). 우리 골든 테스트 범위(`%n %s %a %F %%`)엔
 * 없는 경우라, "?" 로 접는 두 번째 표까지 만들기보다 안전한 항등(그대로 둠)을
 * 택했다 — 문서화만 해둔다.
 */
function formatOne(format: string, tokens: Record<string, string>): string {
  return format.replace(/%%|%[nsaF]/g, (token) => (token === '%%' ? '%' : (tokens[token] ?? token)))
}

/**
 * GNU `stat` 기본 형식(- c 없이)은 접근/수정/생성 시각까지 여러 줄로 낸다. 우리는
 * 실제 시각이 없는 논리 시계 위에서 돌아가므로(ls -l 이 날짜를 안 내는 것과 같은
 * 이유), -c 없이 부를 때는 `%n %s %a` 로 뭉뚱그린 한 줄만 낸다. 골든 테스트는
 * 항상 -c 를 명시한다.
 */
export const stat: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args, ['c'])
  const format = flags.get('c') ?? '%n %s %a'

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const target of rest) {
    const abs = fs.resolve(target, state.cwd)
    const node = fs.lstat(abs)
    if (!node) {
      stderr += `stat: cannot statx '${target}': No such file or directory\n`
      exitCode = 1
      continue
    }
    const size = node.kind === 'dir' ? 0 : byteLength(node.content)
    const tokens: Record<string, string> = {
      '%n': target,
      '%s': String(size),
      '%a': node.mode.toString(8),
      '%F': KIND_NAME[node.kind],
    }
    stdout += formatOne(format, tokens) + '\n'
  }
  return { stdout, stderr, exitCode }
}
