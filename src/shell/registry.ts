import type { CommandFn } from './types'
import { ok, fail } from './types'
import { builtins } from './builtins/index'
import { coreutils } from './coreutils/index'

/**
 * `type` 은 두 표를 모두 조회해야 하므로 여기에 산다.
 * builtins/ 안에 두면 index → type → index 순환 import가 된다.
 */
const typeCmd: CommandFn = ({ args }) => {
  const name = args[0]
  if (!name) return ok()
  if (name in builtins) return ok(`${name} is a shell builtin\n`)
  if (name in coreutils) return ok(`${name} is /usr/bin/${name}\n`)
  return fail(`type: ${name}: not found\n`)
}

const extras: Record<string, CommandFn> = { type: typeCmd }

/**
 * 진짜 리눅스에는 있지만 FlashShell이 구현하지 않은 명령들.
 * 이 목록에 있으면 `command not found`가 아니라 "이 환경에는 없다"고 정직하게 말한다.
 * 사용자가 자기 오타를 의심하며 시간을 낭비하지 않게 하려는 것이다.
 */
const KNOWN_UNIMPLEMENTED = new Set([
  'sed', 'awk', 'find', 'xargs', 'diff', 'comm', 'tee',
  'nl', 'rev', 'basename', 'dirname', 'realpath', 'seq', 'du', 'df',
  'ps', 'kill', 'top', 'chown', 'chgrp', 'tar', 'gzip', 'zip', 'unzip',
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'git', 'make', 'gcc',
  'vim', 'vi', 'nano', 'emacs', 'less', 'more', 'man',
  'python', 'python3', 'node', 'perl', 'ruby',
  'sudo', 'su', 'mount', 'umount', 'systemctl', 'service',
])

/**
 * 조회 순서: 빌트인 → coreutil → extras(type). 빌트인이 항상 이긴다 — `??` 는
 * 왼쪽이 값을 반환하면 오른쪽을 아예 평가하지 않으므로, coreutils 표에 나중에
 * 같은 이름(예: echo)이 추가되어도 그 항목에는 절대 도달하지 않는다. 지금은
 * coreutils 표에 빌트인과 겹치는 이름이 없어 이 우선순위가 관측되지 않지만,
 * commandNames()는 세 표를 합칠 때 Set으로 중복을 제거해 자동완성 목록에
 * 같은 이름이 두 번 뜨는 일이 없도록 미리 막아둔다.
 */
export function lookupCommand(name: string): CommandFn | undefined {
  return builtins[name] ?? coreutils[name] ?? extras[name]
}

export function isKnownUnimplemented(name: string): boolean {
  if (lookupCommand(name)) return false
  return KNOWN_UNIMPLEMENTED.has(name)
}

export function commandNames(): string[] {
  const names = new Set<string>([
    ...Object.keys(builtins),
    ...Object.keys(coreutils),
    ...Object.keys(extras),
  ])
  return [...names].sort()
}
