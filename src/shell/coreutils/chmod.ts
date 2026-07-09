import type { CommandFn } from '../types'
import { errnoText } from './shared'

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
  const who = whoRaw === '' ? 'a' : whoRaw

  let mask = 0
  const bit = { r: 4, w: 2, x: 1 } as const
  for (const perm of permsRaw) {
    const value = bit[perm as 'r' | 'w' | 'x']
    if (who.includes('u') || who.includes('a')) mask |= value << 6
    if (who.includes('g') || who.includes('a')) mask |= value << 3
    if (who.includes('o') || who.includes('a')) mask |= value
  }

  if (op === '+') return mode | mask
  if (op === '-') return mode & ~mask

  // '=': 지정된 who 범위의 비트를 통째로 교체한다 — 먼저 그 범위를 전부 지우고
  // mask(이번에 세팅할 비트)만 켠다. 지정 안 된 who 범위는 손대지 않는다.
  let scope = 0
  if (who.includes('u') || who.includes('a')) scope |= 0o700
  if (who.includes('g') || who.includes('a')) scope |= 0o070
  if (who.includes('o') || who.includes('a')) scope |= 0o007
  return (mode & ~scope) | mask
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

    // GNU 실제 문구는 이 뒤에 "Try 'chmod --help' for more information."이라는
    // 둘째 줄이 더 붙지만(docker coreutils 9.7 실측), 이 태스크가 명시한 기대
    // 문구엔 그 줄이 없다 — 다른 코어유틸(sort/grep 등) 어디에도 그런 도움말 줄을
    // 흉내 내지 않는 것과 일관되게, 의도적으로 생략하고 여기 기록해둔다.
    if (next === null) { stderr += `chmod: invalid mode: '${spec}'\n`; exitCode = 1; continue }
    try { fs.chmod(abs, next) } catch (e) { stderr += `chmod: ${target}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
