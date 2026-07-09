import type { CommandFn } from '../types'
import type { VFS } from '../vfs'
import { parseFlags, errnoText } from './shared'

function basename(abs: string): string {
  return abs.split('/').filter(Boolean).pop()!
}

function joinAbs(dir: string, name: string): string {
  return `${dir === '/' ? '' : dir}/${name}`
}

/**
 * 재귀 복사. lstat 만 쓴다 — 즉 심볼릭 링크는 절대 따라가지 않고 링크 자체를
 * 복사한다(재귀 트리 안에서 만난 링크는 항상 보존, task-11 trap 4). docker
 * debian:stable-slim coreutils 9.7 실측: `cp -r` 로 심볼릭 링크가 든 디렉터리를
 * 복사하면 그 안의 링크는 목적지에서도 심볼릭 링크로 남는다(내용을 따라가
 * 복사하지 않는다) — `-r` 최상위 인자가 심볼릭 링크 자체여도 마찬가지다
 * (`cp -r linkToDir dst` → dst 자체가 심볼릭 링크가 된다, 디렉터리 복사가 아니다).
 *
 * 디렉터리 mode 도 원본 그대로 옮긴다 — `fs.mkdir()`은 mode 인자를 받지 않으므로
 * (0o755 고정) mkdir 직후 `fs.chmod()`로 맞춘다. 실측: `chmod 700 d; cp -r d dst;
 * stat -c %a dst` → 700 (브리프 원본은 이 chmod 호출이 없어 항상 755로 나왔다 —
 * task-11 trap 3, 디렉터리 mode 보존 결함).
 */
function copyTree(fs: VFS, from: string, to: string): void {
  const node = fs.lstat(from)!
  if (node.kind === 'symlink') { fs.symlink(node.target, to); return }
  if (node.kind !== 'dir') { fs.writeFile(to, node.content, node.mode); return }
  fs.mkdir(to, { recursive: true })
  fs.chmod(to, node.mode)
  for (const name of fs.readdir(from)) copyTree(fs, `${from}/${name}`, `${to}/${name}`)
}

export const cp: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const recursive = flags.has('r') || flags.has('R')

  const dest = rest[rest.length - 1]
  const sources = rest.slice(0, -1)
  if (dest === undefined || sources.length === 0) return { stdout: '', stderr: 'usage: cp SOURCE... DEST\n', exitCode: 1 }

  const destAbs = fs.resolve(dest, state.cwd)
  // isDir()는 lookup() 기반이라 심볼릭 링크도 따라간다 — dest 가 디렉터리를 가리키는
  // 링크여도 진짜 디렉터리처럼 취급한다(GNU와 동일, 실측 확인).
  const destIsDir = fs.isDir(destAbs)

  // task-11 finding: 브리프 원문은 "cp: target 'X' is not a directory"였지만 docker
  // coreutils 9.7 실측은 "cp: target 'X': Not a directory" (콜론, "is" 없음,
  // errnoText(ENOTDIR) 문구 그대로) — od -c로 바이트까지 확인했다(보고서 참고).
  // 브리프 Step 1 테스트의 `.toContain('is not a directory')` 는 이 실측과 모순되어
  // 테스트 쪽을 고쳤다(주장은 "대상이 디렉터리가 아니면 실패" 그대로, 문구만 실측에 맞춤).
  if (sources.length > 1 && !destIsDir) {
    return { stdout: '', stderr: `cp: target '${dest}': Not a directory\n`, exitCode: 1 }
  }

  let stderr = ''
  let exitCode = 0

  for (const source of sources) {
    const sourceAbs = fs.resolve(source, state.cwd)
    const raw = fs.lstat(sourceAbs)
    if (!raw) { stderr += `cp: cannot stat '${source}': No such file or directory\n`; exitCode = 1; continue }

    const name = basename(sourceAbs)
    const target = destIsDir ? joinAbs(destAbs, name) : destAbs
    const displayTarget = destIsDir ? `${dest}/${name}` : dest

    // -r 없이 디렉터리(또는 디렉터리를 가리키는 심볼릭 링크)를 복사하려 하면 거부.
    // isDir()로 판정해야 심볼릭 링크-투-디렉터리도 잡는다(실측: `cp linkdir dst` →
    // "-r not specified; omitting directory 'linkdir'", 진짜 디렉터리와 문구가 같다).
    if (!recursive && fs.isDir(sourceAbs)) {
      stderr += `cp: -r not specified; omitting directory '${source}'\n`
      exitCode = 1
      continue
    }

    // task-11 trap: 브리프에 없던 "같은 파일" 검사. 실측(coreutils 9.7):
    // `cp s.txt s.txt` → "cp: 's.txt' and 's.txt' are the same file" exit 1.
    // 지금 이 시점엔 소스가 진짜 디렉터리(-r 없이)인 경우는 이미 위에서 걸러졌으므로,
    // 여기 도달했다면 파일/심볼릭 링크 또는 -r 붙은 디렉터리다.
    //
    // review finding 1: 여기 원래 `${dest}`(raw 인자)를 그대로 박아 넣었는데, dest 가
    // 디렉터리면 GNU는 raw dest 가 아니라 계산된 target(dest/basename)을 문구에
    // 쓴다 — 바로 아래 "into itself" 분기가 이미 displayTarget 을 쓰는 것과 같은
    // 이유. docker debian:stable-slim coreutils 9.7 실측(LANG 비움, od -c 확인):
    //   `cp a.txt .` → "cp: 'a.txt' and './a.txt' are the same file" exit 1
    // (raw dest 였다면 "'a.txt' and '.'"가 됐을 텐데 실제로는 './a.txt'.)
    if (target === sourceAbs) {
      stderr += `cp: '${source}' and '${displayTarget}' are the same file\n`
      exitCode = 1
      continue
    }

    // task-11 trap 1: 디렉터리를 자기 자신의 하위 경로로 복사. copyTree는 순수하게
    // lstat 기반 트리 순회라 가드가 없으면 `cp -r src src/sub`에서 매 단계 자신의
    // 방금 만든 하위 디렉터리를 또 원본인 척 순회해 무한 재귀에 빠진다(브리프
    // 원본 코드로 직접 추적 확인, 보고서 참고) — 브라우저 탭을 멈춘다. 여기서
    // 재귀를 아예 시작하지 않고 미리 차단한다: 대상 경로가 원본과 같거나(위에서
    // 이미 처리) 원본의 진짜 하위 경로면 즉시 에러.
    //
    // 실측(coreutils 9.7): `cp -r src src/sub` →
    //   "cp: cannot copy a directory, 'src', into itself, 'src/sub'" exit 1.
    // GNU는 실제로는 부분 복사를 남기고서(예: src/sub/inner.txt까지 만든 뒤) 이
    // 에러를 낸다 — docker로 직접 확인했다. 우리는 재귀를 아예 시작하지 않아
    // 부분 상태를 남기지 않는다(고의적 이탈, 보고서에 기록). 메시지 문구와 exit
    // 코드는 정확히 맞춘다.
    if (raw.kind === 'dir' && target.startsWith(sourceAbs + '/')) {
      stderr += `cp: cannot copy a directory, '${source}', into itself, '${displayTarget}'\n`
      exitCode = 1
      continue
    }

    try {
      if (recursive) {
        copyTree(fs, sourceAbs, target)
      } else if (raw.kind === 'symlink') {
        // -r 없이 심볼릭 링크를 복사하면 GNU는 따라간다(대상의 내용과 mode를
        // 복사한다) — 브리프 원본은 이 분기가 없어 항상 lstat 기준으로 처리했고,
        // 그러면 심볼릭 링크 노드 자체의 content(항상 '')와 mode(항상 0o777
        // 고정, vfs.ts symlink() 참고)를 그대로 써서 빈 파일이 생겼을 것이다
        // (task-11 trap 4 결함). 실측: `chmod 600 target; ln -s target link;
        // cp link dest; stat -c %a dest` → 600 (mode도 대상 것을 따른다).
        const resolved = fs.lookup(sourceAbs)
        if (!resolved) { stderr += `cp: cannot stat '${source}': No such file or directory\n`; exitCode = 1; continue }
        fs.writeFile(target, fs.readFile(sourceAbs), resolved.mode)
      } else {
        fs.writeFile(target, raw.content, raw.mode)
      }
    } catch (e) {
      stderr += `cp: ${source}: ${errnoText(e)}\n`
      exitCode = 1
    }
  }

  return { stdout: '', stderr, exitCode }
}
