import type { CommandFn } from '../types'
import { errnoText } from './shared'

function basename(abs: string): string {
  return abs.split('/').filter(Boolean).pop()!
}

function joinAbs(dir: string, name: string): string {
  return `${dir === '/' ? '' : dir}/${name}`
}

export const mv: CommandFn = ({ args, fs, state }) => {
  const dest = args[args.length - 1]
  const sources = args.slice(0, -1)
  if (dest === undefined || sources.length === 0) return { stdout: '', stderr: 'usage: mv SOURCE... DEST\n', exitCode: 1 }

  const destAbs = fs.resolve(dest, state.cwd)
  const destIsDir = fs.isDir(destAbs)

  // cp.ts와 같은 이유로 "is not a directory"가 아니라 "Not a directory" (콜론,
  // errnoText(ENOTDIR) 그대로) — docker coreutils 9.7 실측, od -c로 바이트까지 확인.
  if (sources.length > 1 && !destIsDir) {
    return { stdout: '', stderr: `mv: target '${dest}': Not a directory\n`, exitCode: 1 }
  }

  let stderr = ''
  let exitCode = 0

  for (const source of sources) {
    const sourceAbs = fs.resolve(source, state.cwd)
    const node = fs.lstat(sourceAbs)
    if (!node) {
      stderr += `mv: cannot stat '${source}': No such file or directory\n`
      exitCode = 1
      continue
    }

    const name = basename(sourceAbs)
    const target = destIsDir ? joinAbs(destAbs, name) : destAbs
    const displayTarget = destIsDir ? `${dest}/${name}` : dest

    // task-11 trap 6. vfs.rename()의 EINVAL 가드(`to === from || to.startsWith(from
    // + '/')`)는 무한루프를 막아주지만 GNU 문구와는 다르다 — GNU는 "같은 파일"과
    // "자기 하위로 이동"을 서로 다른 문구로 구분한다. docker coreutils 9.7 실측:
    //   `mv c.txt ./c.txt`      → "mv: 'c.txt' and './c.txt' are the same file" exit 1
    //   `mv sub .`  (sub 이미 cwd 바로 아래)
    //                           → "mv: 'sub' and './sub' are the same file" exit 1
    //   `mv sub sub` (sub 이 이미 존재하는 디렉터리라 목적지가 sub/sub 로 중첩됨)
    //                           → "mv: cannot move 'sub' to a subdirectory of itself, 'sub/sub'" exit 1
    // 즉 "정확히 같은 경로"면 same-file 문구, "진짜 하위 경로(같지는 않음)"면
    // subdirectory 문구 — 순서가 중요하다(완전 일치를 먼저 검사해야
    // `mv sub .`가 subdirectory 문구로 잘못 빠지지 않는다).
    if (target === sourceAbs) {
      stderr += `mv: '${source}' and '${dest}' are the same file\n`
      exitCode = 1
      continue
    }
    if (node.kind === 'dir' && target.startsWith(sourceAbs + '/')) {
      stderr += `mv: cannot move '${source}' to a subdirectory of itself, '${displayTarget}'\n`
      exitCode = 1
      continue
    }

    try { fs.rename(sourceAbs, target) } catch (e) { stderr += `mv: ${source}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
