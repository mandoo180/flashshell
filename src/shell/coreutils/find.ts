import type { CommandFn, ExecResult } from '../types'
import { matchSegment } from '../glob'

const UNSUPPORTED = (a: string): ExecResult => ({
  stdout: '',
  stderr: `flashshell: find: 지원하지 않는 술어입니다: ${a}\n`,
  exitCode: 2,
})

/**
 * `find [PATH...] [-name GLOB] [-type f|d] [-exec CMD {} ;]`.
 *
 * 출력 순서 divergence(문서화): GNU find 는 readdir 순서(임의)로 낸다. 우리 VFS의
 * readdir 는 바이트 정렬이므로 우리 find 는 바이트 정렬된 깊이우선(결정적) 순서로
 * 낸다 — ls 의 "항상 한 줄에 하나"와 같은 종류의 수용된 divergence. 순서가 걸리는
 * 골든/테스트는 `| sort` 로 감싼다.
 */
export const find: CommandFn = async (e) => {
  const paths: string[] = []
  let nameGlob: string | undefined
  let typeFilter: 'f' | 'd' | undefined
  let execCmd: string[] | undefined
  const args = e.args
  let i = 0
  // 선행 경로 인자(대시로 시작 안 하는 것들).
  while (i < args.length && !args[i]!.startsWith('-')) { paths.push(args[i]!); i++ }

  for (; i < args.length; i++) {
    const a = args[i]!
    if (a === '-name') {
      const pattern = args[++i]
      if (pattern === undefined) {
        return { stdout: '', stderr: 'flashshell: find: -name 뒤에 패턴이 필요합니다\n', exitCode: 1 }
      }
      nameGlob = pattern
    } else if (a === '-type') {
      const t = args[++i]
      if (t !== 'f' && t !== 'd') {
        return { stdout: '', stderr: 'flashshell: find: -type 뒤에는 f 또는 d 만 지원합니다\n', exitCode: 1 }
      }
      typeFilter = t
    } else if (a === '-exec') {
      execCmd = []
      i++
      while (i < args.length && args[i] !== ';') { execCmd.push(args[i]!); i++ }
      if (args[i] !== ';') {
        return { stdout: '', stderr: 'flashshell: find: -exec 명령은 ; 로 끝나야 합니다\n', exitCode: 1 }
      }
      // i 는 지금 ';' 를 가리킨다. for 문의 i++ 가 다음 반복에서 그 뒤로 넘어간다.
    } else {
      return UNSUPPORTED(a)
    }
  }
  if (paths.length === 0) paths.push('.')

  const results: string[] = []
  let stderr = ''
  let exitCode = 0

  // displayPath 는 사용자가 준 경로 인자를 그대로 접두사로 쓴 "표시용" 경로다
  // (resolve 된 절대경로가 아니다) — docker 로 확인: `find sub` 는 "sub", "sub/c.txt"
  // 를 내지 "/home/.../sub" 를 내지 않는다.
  const walk = (displayPath: string, absPath: string): void => {
    const node = e.fs.lstat(absPath)
    if (!node) return
    const isDir = node.kind === 'dir'
    // basename: displayPath 를 '/' 로 쪼개 마지막 조각을 쓴다. "." 은 이 로직으로도
    // 그대로 "." 이 나온다("." 를 split 하면 ["."] 이므로 filter(Boolean) 뒤에도
    // 살아남는다) — absPath 의 실제 디렉터리 이름을 쓰면 안 된다: docker로 확인,
    // `find . -name "w"`(cwd 의 실제 디렉터리 이름이 w 여도)는 매치 없음, 반면
    // `find /w -name "w"` 는 매치된다(경로 인자 자체가 "w"로 끝나므로).
    const base = displayPath.split('/').filter((s) => s !== '').pop() ?? displayPath
    // dotglob: true — find 의 -name 은 bash 글롭과 달리 선행 점을 특별 취급하지
    // 않는 plain fnmatch 다. docker로 확인: `find . -name "*"` 는 "."과 숨김 파일도
    // 낸다.
    const nameOk = nameGlob === undefined || matchSegment(nameGlob, base, { dotglob: true })
    const typeOk = typeFilter === undefined || (typeFilter === 'd' ? isDir : node.kind === 'file')
    if (nameOk && typeOk) results.push(displayPath)
    if (isDir) {
      for (const child of e.fs.readdir(absPath)) {
        const childDisplay = displayPath === '/' ? `/${child}` : `${displayPath}/${child}`
        const childAbs = absPath === '/' ? `/${child}` : `${absPath}/${child}`
        walk(childDisplay, childAbs)
      }
    }
  }

  for (const p of paths) {
    const abs = e.fs.resolve(p, e.state.cwd)
    if (!e.fs.lstat(abs)) {
      stderr += `find: '${p}': No such file or directory\n`
      exitCode = 1
      continue
    }
    walk(p, abs)
  }

  if (!execCmd) {
    return { stdout: results.map((r) => `${r}\n`).join(''), stderr, exitCode }
  }

  if (!e.runLine) return { stdout: '', stderr: `${stderr}find: -exec unavailable\n`, exitCode: 1 }

  // -exec: 매치마다 {} 를 경로로 치환(토큰 전체가 아니라 토큰 안에 끼어 있어도
  // 치환된다 — docker로 확인: `-exec echo "file:{}" \;` → "file:./a.txt") 후 실행.
  // GNU find 자신의 exit code 는 -exec 서브커맨드의 성패에 영향받지 않는다 — docker로
  // 확인: `find . -exec false {} \;` 도, `-exec nosuchcmd {} \;`(exec 자체가 실패)도
  // find exit=0 그대로다. 그래서 아래 루프는 stdout/stderr 만 누적하고 exitCode 는
  // (경로 탐색 단계에서 이미 정해진 값 그대로) 건드리지 않는다.
  let stdout = ''
  for (const match of results) {
    const line = execCmd.map((tok) => tok.split('{}').join(match)).join(' ')
    const r: ExecResult = await e.runLine(line)
    stdout += r.stdout
    stderr += r.stderr
  }
  return { stdout, stderr, exitCode }
}
