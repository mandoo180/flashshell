import type { CommandFn } from '../types'
import { errnoText } from './shared'

/**
 * flashshell이 모델링하는 게임 컨테이너의 기본 umask. 실제 VFS/ShellState엔 umask
 * 개념이 없고(파일 생성 시 항상 고정 mode) 이 상수도 chmod 심볼릭 연산(+/-/=)에서
 * "who 생략" 케이스에만 쓴다 — VFS나 ShellState에 umask 필드를 추가하지 않는다
 * (review finding 2 요구사항, 이 게임 범위엔 chmod 하나면 충분하다).
 *
 * docker debian:stable-slim `umask` 실측값 022. GNU chmod는 who(u/g/o/a)를 생략한
 * 심볼릭 연산에서 umask가 가리는 비트를 건드리지 않는다 — `+`/`-`/`=` 셋 다 그렇다
 * (아래에서 세 연산자 전부 docker로 실측·검증했다, mutate.test.ts 'chmod — who
 * 생략 시 umask' 블록 참고). who를 명시하면(`u+w`, `a+w`, `go-w` 등) umask를 전혀
 * 참조하지 않는다.
 */
const UMASK = 0o022

/**
 * `+x`, `-w`, `a+r`, `u+x`, `go-rwx`, 그리고 `=`(예: `u=rwx`, `o=`)까지 지원한다.
 * 콤마로 여러 절을 묶는 형태(`u=rwx,g=r,o=`)는 지원하지 않는다 — task-11 브리프가
 * 요구한 범위(+x -w a+r u+x go-rwx)엔 콤마 절이 없고, 콤마까지 파싱하려면 spec을
 * 여러 조각으로 나눠 순차 적용하는 별도 루프가 필요해 이 태스크 범위를 넘어간다.
 * 이건 명시적으로 미구현으로 남긴다(문서화, task-11 trap 13).
 *
 * `=`는 GNU에선 있지만 브리프 원본엔 없었다 — 결정: 넣는다. `+`/`-`와 대칭적이라
 * 구현 비용이 낮고(해당 who 범위의 비트를 지운 뒤 mask를 세팅), 플레이어가 흔히
 * 마주치는 `chmod u=rwx,go=` 류 문제의 단순한 단일 절 버전(`chmod u=rwx a.txt`)엔
 * 이미 대응할 수 있다.
 */
function applySymbolic(mode: number, spec: string): number | null {
  const match = /^([ugoa]*)([+\-=])([rwx]*)$/.exec(spec)
  if (!match) return null
  const [, whoRaw, op, permsRaw] = match as unknown as [string, string, '+' | '-' | '=', string]
  // `+`/`-`는 최소 한 글자가 있어야 한다(GNU도 `chmod +` 같은 빈 연산은 거부한다).
  // `=`만 빈 permsRaw를 허용한다 — `o=`처럼 "이 범위의 권한을 전부 지운다"는 뜻이다.
  if (op !== '=' && permsRaw === '') return null
  // review finding 2: who가 생략됐는지(whoRaw === '') 여부를 기억해둔다 — GNU는
  // who를 명시적으로 안 주면(기본값 'a'로 확장은 하되) umask가 가리는 비트를
  // 건드리지 않는다. who를 명시하면(예: a+w) umask는 전혀 관여하지 않는다.
  const whoOmitted = whoRaw === ''
  const who = whoOmitted ? 'a' : whoRaw

  let mask = 0
  const bit = { r: 4, w: 2, x: 1 } as const
  for (const perm of permsRaw) {
    const value = bit[perm as 'r' | 'w' | 'x']
    if (who.includes('u') || who.includes('a')) mask |= value << 6
    if (who.includes('g') || who.includes('a')) mask |= value << 3
    if (who.includes('o') || who.includes('a')) mask |= value
  }

  if (op === '+' || op === '-') {
    // who 생략 시에만 umask로 가려진 비트를 연산 대상에서 뺀다. docker 실측:
    // `chmod 644 f; chmod +w f` → 644(그룹/기타 쓰기 비트는 umask가 가려 안 켜짐),
    // `chmod 664 f; chmod -w f` → 464(그룹 쓰기 비트는 umask가 가려 안 지워짐),
    // 반면 `chmod +x`(644→755)나 `chmod +r`(600→644), `chmod -r`(666→222)는
    // umask 022가 r/x 비트를 안 가리므로 영향이 없다 — r/x는 원래 의도대로 적용된다.
    const usable = whoOmitted ? mask & ~UMASK : mask
    return op === '+' ? mode | usable : mode & ~usable
  }

  // '=': 지정된 who 범위의 비트를 통째로 교체한다 — 먼저 그 범위를 전부 지우고
  // mask(이번에 세팅할 비트)만 켠다. 지정 안 된 who 범위는 손대지 않는다.
  let scope = 0
  if (who.includes('u') || who.includes('a')) scope |= 0o700
  if (who.includes('g') || who.includes('a')) scope |= 0o070
  if (who.includes('o') || who.includes('a')) scope |= 0o007
  // who 생략 시 umask로 가려진 비트는 "지우고 다시 세팅하는" 대상에서 아예 뺀다 —
  // 그 비트는 원래 값 그대로 남는다(지워지지도, 세팅되지도 않는다). docker 실측:
  // `chmod 644 f; chmod =w f` → 200. 소유자는 umask가 안 가려 rwx를 전부 지운 뒤
  // w만 세팅(→2). 그룹/기타는 umask가 쓰기 비트를 가려 그 비트는 손 안 대고(원래도
  // 0), 안 가려진 읽기 비트만 지운다(원래 있던 r이 지워져 →0).
  const clearMask = whoOmitted ? scope & ~UMASK : scope
  return (mode & ~clearMask) | (mask & clearMask)
}

export const chmod: CommandFn = ({ args, fs, state }) => {
  // 첫 인자(모드 스펙)는 `-w`처럼 대시로 시작할 수 있으므로 parseFlags를 통과시키면
  // 안 된다 — parseFlags는 그걸 플래그로 오인한다. 브리프 원본처럼 위치 인자로
  // 직접 받는다.
  const [spec, ...targets] = args
  if (!spec || targets.length === 0) return { stdout: '', stderr: 'usage: chmod MODE FILE...\n', exitCode: 1 }

  let stderr = ''
  let exitCode = 0

  for (const target of targets) {
    const abs = fs.resolve(target, state.cwd)
    const node = fs.lstat(abs)
    if (!node) { stderr += `chmod: cannot access '${target}': No such file or directory\n`; exitCode = 1; continue }

    let next: number | null
    if (/^[0-7]{3,4}$/.test(spec)) next = parseInt(spec, 8)
    else next = applySymbolic(node.mode, spec)

    // review finding 3: GNU 실제 문구는 이 뒤에 "Try 'chmod --help' for more
    // information."이라는 둘째 줄이 더 붙는다 — task-11 구현 당시엔 이 태스크가
    // 명시한 기대 문구 밖이라 판단해 의도적으로 생략했으나, docker debian:stable-slim
    // coreutils 9.7 실측(od -c로 바이트까지 확인)을 그대로 맞추라는 요구가 와서
    // 둘째 줄을 추가한다. exit code는 그대로 1(기존과 동일, docker로 재확인).
    if (next === null) { stderr += `chmod: invalid mode: '${spec}'\nTry 'chmod --help' for more information.\n`; exitCode = 1; continue }
    try { fs.chmod(abs, next) } catch (e) { stderr += `chmod: ${target}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
