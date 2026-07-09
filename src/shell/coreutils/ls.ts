import type { CommandFn } from '../types'
import type { VFS } from '../vfs'
import { parseFlags, errnoText, byteLength } from './shared'

function modeString(kind: 'file' | 'dir' | 'symlink', mode: number): string {
  const type = kind === 'dir' ? 'd' : kind === 'symlink' ? 'l' : '-'
  const bits = ['r', 'w', 'x']
  let out = ''
  for (let shift = 6; shift >= 0; shift -= 3) {
    const group = (mode >> shift) & 0o7
    for (let bit = 0; bit < 3; bit++) out += group & (4 >> bit) ? bits[bit]! : '-'
  }
  return type + out
}

function renderEntry(fs: VFS, long: boolean, name: string, abs: string): string {
  if (!long) return `${name}\n`
  const node = fs.lstat(abs)!
  const size = node.kind === 'dir' ? 0 : byteLength(node.content)
  return `${modeString(node.kind, node.mode)} 1 player player ${size} ${name}\n`
}

/** 디렉터리 하나의 내용을 렌더링한다 (헤더 없이, 방문 목록만). */
function renderDirBody(fs: VFS, long: boolean, showAll: boolean, target: string, abs: string): string {
  const names = fs.readdir(abs)
  const visible = showAll ? ['.', '..', ...names] : names.filter((n) => !n.startsWith('.'))
  let body = ''
  for (const name of visible) {
    const childAbs = name === '.' ? abs : name === '..' ? fs.resolve('..', abs) : `${abs === '/' ? '' : abs}/${name}`
    body += renderEntry(fs, long, name, childAbs)
  }
  return body
}

/**
 * GNU ls 는 인자를 두 그룹으로 나눈다: 디렉터리가 아닌 인자는 전부 모아 (바이트 순으로
 * 재정렬해서) 먼저 낸 뒤, 디렉터리 인자는 주어진 순서 그대로 각각 "이름:" 헤더를 붙여
 * 낸다. 헤더/빈줄 구분은 인자가 둘 이상일 때만 나온다 — docker debian:stable-slim
 * coreutils 9.7 로 확인:
 *   `ls -1 a.txt sub`      -> "a.txt\n\nsub:\n"              (sub 비어있음)
 *   `ls -1 sub sub2`       -> "sub:\n\nsub2:\nz.txt\n"        (파일 인자 없음)
 *   `ls -1 z2.txt a.txt sub` -> "a.txt\nz2.txt\n\nsub:\n"     (파일 그룹은 정렬됨)
 *   `ls -1 nope sub`       -> "sub:\n"                        (요청 개수 2 → 헤더는 여전히 붙음)
 *   `ls -1 a.txt z2.txt`   -> "a.txt\nz2.txt\n"               (디렉터리가 없으면 헤더 자체가 없음)
 * 실패한 인자(없는 경로)도 "요청한 인자 수"에는 들어간다 — 살아남은 게 하나뿐이어도
 * 헤더가 붙는다.
 */
export const ls: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const showAll = flags.has('a')
  const long = flags.has('l')
  const targets = rest.length > 0 ? rest : ['.']
  const showHeaders = targets.length > 1

  let stderr = ''
  let exitCode = 0

  const fileTargets: { name: string; abs: string }[] = []
  const dirTargets: { name: string; abs: string }[] = []

  for (const target of targets) {
    const abs = fs.resolve(target, state.cwd)
    // 존재 확인은 lstat 으로 한다(lookup 이 아니라) — 깨진 심볼릭 링크도 그 자체는
    // 존재하는 디렉터리 엔트리이기 때문이다. docker로 확인: 목적지가 없는 심볼릭
    // 링크에 `ls`를 걸어도 "cannot access"가 아니라 그 이름을 그대로 낸다(exit 0).
    if (!fs.lstat(abs)) {
      stderr += `ls: cannot access '${target}': No such file or directory\n`
      exitCode = 2
      continue
    }
    // 디렉터리인지는(심볼릭 링크 포함, 링크가 디렉터리를 가리키면 그 내용을 본다)
    // isDir 가 링크를 따라가 판단해준다. 깨진 링크는 isDir 가 false 를 준다.
    if (fs.isDir(abs)) dirTargets.push({ name: target, abs })
    else fileTargets.push({ name: target, abs })
  }

  fileTargets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const sections: string[] = []

  if (fileTargets.length > 0) {
    sections.push(fileTargets.map((f) => renderEntry(fs, long, f.name, f.abs)).join(''))
  }

  for (const dir of dirTargets) {
    let body: string
    try {
      body = renderDirBody(fs, long, showAll, dir.name, dir.abs)
    } catch (e) {
      stderr += `ls: ${dir.name}: ${errnoText(e)}\n`
      exitCode = 2
      continue
    }
    const header = showHeaders ? `${dir.name}:\n` : ''
    sections.push(header + body)
  }

  return { stdout: sections.join('\n'), stderr, exitCode }
}
