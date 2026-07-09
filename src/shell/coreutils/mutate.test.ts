import { describe, it, expect, beforeEach } from 'vitest'
import { createShell, VFS } from '../index'
import type { Shell } from '../types'

let fs: VFS
let sh: Shell

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/w/src/deep', { recursive: true })
  fs.mkdir('/w/empty')
  fs.writeFile('/w/a.txt', 'alpha\n')
  fs.writeFile('/w/src/inner.txt', 'inner\n')
  fs.writeFile('/w/src/deep/deep.txt', 'deep\n')
  sh = createShell({ fs, cwd: '/w', home: '/w' })
})

describe('cp', () => {
  it('파일을 복사한다', async () => {
    await sh.exec('cp a.txt b.txt')
    expect(fs.readFile('/w/b.txt')).toBe('alpha\n')
    expect(fs.exists('/w/a.txt')).toBe(true)
  })
  it('디렉터리를 대상으로 주면 그 안에 넣는다', async () => {
    await sh.exec('cp a.txt empty')
    expect(fs.readFile('/w/empty/a.txt')).toBe('alpha\n')
  })
  it('-r 없이 디렉터리를 복사하면 실패한다', async () => {
    const r = await sh.exec('cp src dst')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('omitting directory')
  })
  it('-r 은 하위 전체를 복사한다', async () => {
    await sh.exec('cp -r src dst')
    expect(fs.readFile('/w/dst/inner.txt')).toBe('inner\n')
    expect(fs.readFile('/w/dst/deep/deep.txt')).toBe('deep\n')
  })
  it('여러 파일을 디렉터리로 복사한다', async () => {
    await sh.exec('cp a.txt src/inner.txt empty')
    expect(fs.exists('/w/empty/a.txt')).toBe(true)
    expect(fs.exists('/w/empty/inner.txt')).toBe(true)
  })
  it('여러 파일인데 대상이 디렉터리가 아니면 실패한다', async () => {
    const r = await sh.exec('cp a.txt src/inner.txt b.txt')
    expect(r.exitCode).toBe(1)
    // 브리프 원문은 `.toContain('is not a directory')`였다. docker debian:stable-slim
    // coreutils 9.7 실측(od -c로 바이트까지 확인, task-11 리포트 참고): 실제 문구는
    // "cp: target 'b.txt': Not a directory"(콜론, "is" 없음, errnoText(ENOTDIR)
    // 그대로) — "is not a directory"라는 부분 문자열 자체가 없다. 주장("대상이
    // 디렉터리가 아니면 실패한다")은 그대로 두고 실측 문구로 고쳤다.
    expect(r.stderr).toBe("cp: target 'b.txt': Not a directory\n")
  })
  it('cp a.txt . 처럼 목적지가 디렉터리면 same-file 문구는 raw dest 가 아니라 계산된 target(dest/basename)을 쓴다 (task-11 review finding 1)', async () => {
    // docker debian:stable-slim coreutils 9.7 실측(LANG 비움, 컨테이너 기본 환경):
    //   `cp a.txt .` → "cp: 'a.txt' and './a.txt' are the same file" exit 1
    const r = await sh.exec('cp a.txt .')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("cp: 'a.txt' and './a.txt' are the same file\n")
  })
})

describe('mv', () => {
  it('이름을 바꾼다', async () => {
    await sh.exec('mv a.txt renamed.txt')
    expect(fs.exists('/w/a.txt')).toBe(false)
    expect(fs.readFile('/w/renamed.txt')).toBe('alpha\n')
  })
  it('디렉터리 안으로 옮긴다', async () => {
    await sh.exec('mv a.txt empty')
    expect(fs.readFile('/w/empty/a.txt')).toBe('alpha\n')
  })
  it('디렉터리도 옮긴다', async () => {
    await sh.exec('mv src moved')
    expect(fs.readFile('/w/moved/inner.txt')).toBe('inner\n')
  })
  it('없는 파일은 실패한다', async () => {
    expect((await sh.exec('mv nope x')).exitCode).toBe(1)
  })
})

describe('rm', () => {
  it('파일을 지운다', async () => {
    await sh.exec('rm a.txt')
    expect(fs.exists('/w/a.txt')).toBe(false)
  })
  it('-r 없이 디렉터리를 지우면 실패한다', async () => {
    const r = await sh.exec('rm empty')
    expect(r.exitCode).toBe(1)
    // 브리프 원문은 소문자 `.toContain('is a directory')`였다. docker 실측(및
    // errors.ts의 ERRNO_TEXT.EISDIR)은 대문자로 시작하는 "Is a directory" —
    // `rm: cannot remove 'adir': Is a directory` (task-11 리포트 참고). 주장은
    // 그대로, 대소문자만 실측/기존 errno 표기에 맞춘다.
    expect(r.stderr).toContain('Is a directory')
  })
  it('-r 은 디렉터리를 통째로 지운다', async () => {
    await sh.exec('rm -r src')
    expect(fs.exists('/w/src')).toBe(false)
  })
  it('없는 파일은 실패하지만 -f 면 조용하다', async () => {
    expect((await sh.exec('rm nope')).exitCode).toBe(1)
    const r = await sh.exec('rm -f nope')
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toBe('')
  })
  it('글롭으로 여러 개를 지운다', async () => {
    await sh.exec('rm *.txt')
    expect(fs.exists('/w/a.txt')).toBe(false)
  })
})

describe('mkdir / rmdir', () => {
  it('디렉터리를 만든다', async () => {
    await sh.exec('mkdir fresh')
    expect(fs.isDir('/w/fresh')).toBe(true)
  })
  it('중첩 경로는 -p 가 있어야 한다', async () => {
    expect((await sh.exec('mkdir a/b')).exitCode).toBe(1)
    await sh.exec('mkdir -p a/b')
    expect(fs.isDir('/w/a/b')).toBe(true)
  })
  it('이미 있으면 실패하지만 -p 면 조용하다', async () => {
    expect((await sh.exec('mkdir empty')).exitCode).toBe(1)
    expect((await sh.exec('mkdir -p empty')).exitCode).toBe(0)
  })
  it('rmdir 은 빈 디렉터리만 지운다', async () => {
    await sh.exec('rmdir empty')
    expect(fs.exists('/w/empty')).toBe(false)
    const r = await sh.exec('rmdir src')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('Directory not empty')
  })
})

describe('touch', () => {
  it('없으면 빈 파일을 만든다', async () => {
    await sh.exec('touch new.txt')
    expect(fs.readFile('/w/new.txt')).toBe('')
  })
  it('있으면 내용을 보존한다', async () => {
    await sh.exec('touch a.txt')
    expect(fs.readFile('/w/a.txt')).toBe('alpha\n')
  })
})

describe('ln -s', () => {
  it('심볼릭 링크를 만든다', async () => {
    await sh.exec('ln -s a.txt link')
    expect(fs.lstat('/w/link')!.kind).toBe('symlink')
    expect(fs.readFile('/w/link')).toBe('alpha\n')
  })
  it('-s 없이는 실패한다 (하드링크 미지원)', async () => {
    const r = await sh.exec('ln a.txt link')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('hard links')
  })
})

describe('chmod', () => {
  it('8진 모드를 적용한다', async () => {
    await sh.exec('chmod 755 a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o755)
  })
  it('+x 는 실행 비트를 켠다', async () => {
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod +x a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o755)
  })
  it('숫자가 아니고 심볼도 아니면 실패한다 (task-11 review finding 3: GNU 둘째 줄까지)', async () => {
    const r = await sh.exec('chmod zzz a.txt')
    expect(r.exitCode).toBe(1)
    // docker debian:stable-slim coreutils 9.7 실측(od -c로 바이트까지 확인,
    // task-11-report.md 참고): 실제로는 두 줄이다 —
    //   chmod: invalid mode: 'zzz'
    //   Try 'chmod --help' for more information.
    // task-11 구현 당시엔 이 둘째 줄을 의도적으로 생략했었다(chmod.ts 주석 참고,
    // 당시엔 이 태스크가 요구한 문구 밖이라 판단) — review finding 3 에서 GNU와
    // 정확히 맞추라는 요구가 와서 둘째 줄을 추가하고 이 assertion을 실측에 맞게 고쳤다.
    expect(r.stderr).toBe("chmod: invalid mode: 'zzz'\nTry 'chmod --help' for more information.\n")
  })
  it('= 는 해당 범위의 권한을 통째로 교체한다 (GNU에 있지만 브리프엔 없던 기능, 결정: 추가)', async () => {
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod u=rwx a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o744)
    await sh.exec('chmod o= a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o740)
  })
  it('없는 파일에는 접근할 수 없다는 문구를 낸다', async () => {
    const r = await sh.exec('chmod 644 nope.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("chmod: cannot access 'nope.txt': No such file or directory\n")
  })
  it('부분 실패: 있는 파일 둘 사이에 없는 파일이 껴 있어도 있는 파일들은 chmod 된다', async () => {
    fs.writeFile('/w/x1.txt', 'x')
    fs.writeFile('/w/y1.txt', 'y')
    const r = await sh.exec('chmod 700 x1.txt nope.txt y1.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('nope.txt')
    expect(fs.lstat('/w/x1.txt')!.mode).toBe(0o700)
    expect(fs.lstat('/w/y1.txt')!.mode).toBe(0o700)
  })
})

describe('chmod — who 생략 시 umask(022)를 반영한다 (task-11 review finding 2)', () => {
  // 컨테이너(debian:stable-slim) 기본 umask 는 022 — docker `umask` 실측.
  // GNU chmod 는 who(u/g/o/a)를 생략한 심볼릭 연산(+/-/=)에서 umask 가 가리는
  // 비트는 건드리지 않는다. who 를 명시하면(u+w, a+w, go-w 등) umask 를 전혀
  // 참조하지 않는다 — 아래에서 둘 다 실측·검증한다.
  it('+w: 644 에서 그대로다 (그룹/기타 쓰기 비트는 umask 022 가 가려서 안 켜진다)', async () => {
    // docker 실측: `chmod 644 f; chmod +w f; stat -c %a f` → 644
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod +w a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o644)
  })
  it('-w: 664 에서 464 가 된다 (그룹 쓰기 비트는 umask 가 가려서 안 지워진다)', async () => {
    // docker 실측: `chmod 664 f; chmod -w f; stat -c %a f` → 464
    fs.chmod('/w/a.txt', 0o664)
    await sh.exec('chmod -w a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o464)
  })
  it('-w: 666 에서 466 이 된다', async () => {
    // docker 실측: `chmod 666 f; chmod -w f; stat -c %a f` → 466
    fs.chmod('/w/a.txt', 0o666)
    await sh.exec('chmod -w a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o466)
  })
  it('+x: 644 에서 755 가 된다 (실행 비트는 umask 022 에 안 걸린다 — l2-08 퍼즐 정합성)', async () => {
    // docker 실측: `chmod 644 f; chmod +x f; stat -c %a f` → 755. 이 결과는
    // l2-08 퍼즐의 explanation("644 에서 시작하면 +x 로도 755 가 된다")과
    // 정확히 일치한다 — umask 022 는 x 비트를 가리지 않기 때문이다.
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod +x a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o755)
  })
  it('+r: 600 에서 644 가 된다 (읽기 비트는 umask 022 에 안 걸린다)', async () => {
    // docker 실측: `chmod 600 f; chmod +r f; stat -c %a f` → 644
    fs.chmod('/w/a.txt', 0o600)
    await sh.exec('chmod +r a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o644)
  })
  it('-r: 666 에서 222 가 된다 (읽기 비트는 umask 에 안 걸리므로 전부 지워진다)', async () => {
    // docker 실측: `chmod 666 f; chmod -r f; stat -c %a f` → 222
    fs.chmod('/w/a.txt', 0o666)
    await sh.exec('chmod -r a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o222)
  })
  it('=w: 644 에서 200 이 된다 (= 도 umask 를 반영한다 — 그룹/기타는 마스크된 비트를 그대로 둔다)', async () => {
    // docker 실측: `chmod 644 f; chmod =w f; stat -c %a f` → 200.
    // 소유자는 umask 가 안 가리므로 전부(rwx) 지운 뒤 w 만 세팅 → 2.
    // 그룹/기타는 umask 가 쓰기 비트를 가려 그 비트는 손대지 않고(원래도 0),
    // 안 가려진 읽기/실행 비트만 지운다(원래 있던 r 이 지워짐) → 0.
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod =w a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o200)
  })
  it('who 를 명시하면(a+w) umask 를 전혀 참조하지 않는다', async () => {
    // docker 실측: `chmod 644 f; chmod a+w f; stat -c %a f` → 666 (같은 조건의
    // 위 bare `+w` 테스트는 umask 때문에 644 에 머물렀다 — 대비 확인).
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod a+w a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o666)
  })
  it('who 를 명시하면(u+w) umask 를 전혀 참조하지 않는다 (이미 켜져 있어 무변화)', async () => {
    // docker 실측: `chmod 644 f; chmod u+w f; stat -c %a f` → 644
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod u+w a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o644)
  })
  it('who 를 명시하면(go-w) umask 를 전혀 참조하지 않는다', async () => {
    // docker 실측: `chmod 666 f; chmod go-w f; stat -c %a f` → 644 (같은 조건의
    // 위 bare `-w` 테스트는 umask 때문에 466 에 머물렀다 — 대비 확인).
    fs.chmod('/w/a.txt', 0o666)
    await sh.exec('chmod go-w a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o644)
  })
})

describe('cp — trap 1: 자기 자신의 하위 경로로 재귀 복사 (행 방지, 가장 중요)', () => {
  it('cp -r src src/sub 는 무한루프 없이 GNU 문구 그대로 실패한다', async () => {
    const r = await sh.exec('cp -r src src/sub')
    expect(r.exitCode).toBe(1)
    // docker coreutils 9.7 실측: "cp: cannot copy a directory, 'src', into itself, 'src/sub'"
    expect(r.stderr).toBe("cp: cannot copy a directory, 'src', into itself, 'src/sub'\n")
    // GNU는 이 에러를 내기 전에 실제로는 src/sub 를 부분적으로 만들어 버린다(docker로
    // 확인, 보고서 참고) — 우리는 재귀를 아예 시작하지 않는 고의적 이탈을 택했다.
    // 그러므로 src 트리는 전혀 변형되지 않아야 한다(부분 상태가 안 남는다).
    expect(fs.exists('/w/src/sub')).toBe(false)
    expect(fs.readdir('/w/src').sort()).toEqual(['deep', 'inner.txt'])
  })
  it('cp -r src src (목적지가 이미 자기 자신인 디렉터리) 도 안전하게 실패한다', async () => {
    const r = await sh.exec('cp -r src src')
    expect(r.exitCode).toBe(1)
    // docker 실측: dest 가 이미 존재하는 디렉터리(=src 자신)라 목적지가 src/src 로
    // 계산된다. "cp: cannot copy a directory, 'src', into itself, 'src/src'"
    expect(r.stderr).toBe("cp: cannot copy a directory, 'src', into itself, 'src/src'\n")
    expect(fs.exists('/w/src/src')).toBe(false)
  })
  it('깊이 중첩된 목적지(src/deep/deeper)로도 무한루프 없이 실패한다', async () => {
    const r = await sh.exec('cp -r src src/deep/deeper')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('into itself')
    expect(fs.exists('/w/src/deep/deeper')).toBe(false)
  })
})

describe('ln -s — trap 2: target 을 있는 그대로 저장한다(절대경로로 바꾸지 않는다)', () => {
  it('상대 target 문자열이 vfs 노드에 그대로 저장된다', async () => {
    await sh.exec('ln -s sub link')
    // fs.lstat().target 은 vfs 내부 표현 — symlink() 가 target 을 verbatim 저장한다는
    // 계약을 직접 검증한다(readlink 커맨드가 없으므로 vfs 레벨에서 확인).
    expect(fs.lstat('/w/link')!.target).toBe('sub')
  })
  it('디렉터리 밑에서 상대 target 도 그대로 저장된다(절대경로로 미리 계산하지 않는다)', async () => {
    await sh.exec('ln -s ../a.txt src/link2')
    expect(fs.lstat('/w/src/link2')!.target).toBe('../a.txt')
    // vfs 조회 시점에는 "링크가 실제로 놓인 디렉터리" 기준으로 상대 target 을
    // 해석하므로(Task 6) 여전히 올바른 파일을 가리킨다.
    expect(fs.readFile('/w/src/link2')).toBe('alpha\n')
  })
  it('이미 있는 이름 위에 만들면 File exists 로 실패한다', async () => {
    await sh.exec('ln -s a.txt link')
    const r = await sh.exec('ln -s a.txt link')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("ln: failed to create symbolic link 'link': File exists\n")
  })
})

describe('cp — trap 3: mode 보존', () => {
  it('파일 mode 를 보존한다', async () => {
    fs.chmod('/w/a.txt', 0o755)
    await sh.exec('cp a.txt b.txt')
    expect(fs.lstat('/w/b.txt')!.mode).toBe(0o755)
  })
  it('-r 로 복사한 디렉터리도 mode 를 보존한다', async () => {
    fs.chmod('/w/src', 0o700)
    await sh.exec('cp -r src dst')
    expect(fs.lstat('/w/dst')!.mode).toBe(0o700)
  })
})

describe('cp — trap 4: 심볼릭 링크', () => {
  it('-r 없이 심볼릭 링크를 복사하면 대상 내용을 따라간다(dereference)', async () => {
    fs.chmod('/w/a.txt', 0o600)
    await sh.exec('ln -s a.txt link')
    await sh.exec('cp link copy.txt')
    expect(fs.lstat('/w/copy.txt')!.kind).toBe('file')
    expect(fs.readFile('/w/copy.txt')).toBe('alpha\n')
    // 대상(target)의 mode 를 따른다 — 심볼릭 링크 노드 자체의 고정 mode(0o777)가 아니다.
    expect(fs.lstat('/w/copy.txt')!.mode).toBe(0o600)
  })
  it('-r 로 디렉터리를 복사하면 안의 심볼릭 링크는 보존된다(따라가지 않는다)', async () => {
    await sh.exec('ln -s inner.txt src/link3')
    await sh.exec('cp -r src dst')
    expect(fs.lstat('/w/dst/link3')!.kind).toBe('symlink')
    expect(fs.lstat('/w/dst/link3')!.target).toBe('inner.txt')
  })
  it('-r 로 심볼릭 링크 자체를 최상위 인자로 주면 링크로만 복사된다(디렉터리로 안 따라간다)', async () => {
    await sh.exec('ln -s src linkdir')
    await sh.exec('cp -r linkdir dst2')
    expect(fs.lstat('/w/dst2')!.kind).toBe('symlink')
    expect(fs.lstat('/w/dst2')!.target).toBe('src')
  })
  it('깨진 심볼릭 링크를 -r 없이 복사하면 대상을 stat 할 수 없어 실패한다', async () => {
    await sh.exec('ln -s doesnotexist broken')
    const r = await sh.exec('cp broken dest.txt')
    expect(r.exitCode).toBe(1)
    // docker 실측: `cp brokenlink dest` → "cp: cannot stat 'brokenlink': No such
    // file or directory" — 링크 자신은 존재하지만(lstat 성공) GNU 는 dereference
    // 하려다 실패한 것이므로 문구가 "존재하지 않는 소스"와 동일하다.
    expect(r.stderr).toBe("cp: cannot stat 'broken': No such file or directory\n")
    expect(fs.exists('/w/dest.txt')).toBe(false)
  })
  it('깨진 심볼릭 링크를 -r 로 복사하면 링크 그대로 보존된다(exit 0)', async () => {
    await sh.exec('ln -s doesnotexist broken')
    const r = await sh.exec('cp -r broken dest2.txt')
    expect(r.exitCode).toBe(0)
    expect(fs.lstat('/w/dest2.txt')!.kind).toBe('symlink')
    expect(fs.lstat('/w/dest2.txt')!.target).toBe('doesnotexist')
  })
})

describe('cp/mv — trap 14: target 문구는 GNU 그대로 (콜론, "is" 없음)', () => {
  it('cp: 여러 소스인데 대상이 파일이면 "Not a directory"', async () => {
    const r = await sh.exec('cp a.txt src/inner.txt a.txt')
    expect(r.stderr).toBe("cp: target 'a.txt': Not a directory\n")
  })
  it('mv: 여러 소스인데 대상이 파일이면 "Not a directory"', async () => {
    fs.writeFile('/w/c.txt', 'c\n')
    const r = await sh.exec('mv a.txt src/inner.txt c.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("mv: target 'c.txt': Not a directory\n")
  })
})

describe('mv — trap 5: 디렉터리 이동 규칙', () => {
  it('목적지가 이미 있는 디렉터리면 그 안으로 들어간다', async () => {
    await sh.exec('mv src empty')
    expect(fs.readFile('/w/empty/src/inner.txt')).toBe('inner\n')
  })
  it('목적지가 없으면 그 이름으로 개명(rename)된다', async () => {
    await sh.exec('mv src renamed_dir')
    expect(fs.exists('/w/src')).toBe(false)
    expect(fs.readFile('/w/renamed_dir/inner.txt')).toBe('inner\n')
  })
  it('목적지가 기존 파일이면 덮어쓴다', async () => {
    fs.writeFile('/w/dest.txt', 'old\n')
    await sh.exec('mv a.txt dest.txt')
    expect(fs.readFile('/w/dest.txt')).toBe('alpha\n')
    expect(fs.exists('/w/a.txt')).toBe(false)
  })
})

describe('mv — trap 6: 같은 경로로 옮기기', () => {
  it('mv a.txt a.txt 는 "같은 파일" 에러를 낸다', async () => {
    const r = await sh.exec('mv a.txt a.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("mv: 'a.txt' and 'a.txt' are the same file\n")
    expect(fs.readFile('/w/a.txt')).toBe('alpha\n')
  })
  it('디렉터리를 이미 그 자리(자기 자신인 디렉터리)로 옮기면 "same file" (task-11 review finding 1)', async () => {
    // src 는 cwd(/w) 바로 아래 있으므로 `mv src .` 는 정확히 같은 경로가 된다.
    // docker debian:stable-slim coreutils 9.7 실측(LANG 비움, od -c로 확인):
    //   `mv sub .` → "mv: 'sub' and './sub' are the same file" exit 1
    // 즉 문구는 raw dest('.')가 아니라 계산된 target('./sub', 여기선 './src')을
    // 쓴다 — 예전 assertion은 raw dest를 그대로 넣은 결함을 그대로 굳혀놨었다.
    const r = await sh.exec('mv src .')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("mv: 'src' and './src' are the same file\n")
  })
  it('디렉터리 안의 파일을 그 디렉터리로 다시 옮기면(경로가 되접힌다) "same file" — mv d/f.txt d 형태 (task-11 review finding 1)', async () => {
    // docker 실측: `mv d/f.txt d` → "mv: 'd/f.txt' and 'd/f.txt' are the same
    // file" exit 1 — dest(d)가 이미 있는 디렉터리라 target이 d/basename으로
    // 계산되고, 이게 d/f.txt로 되접혀 source와 같아진다. src/inner.txt 를
    // src 로 옮기는 것으로 동일한 모양을 재현한다.
    const r = await sh.exec('mv src/inner.txt src')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("mv: 'src/inner.txt' and 'src/inner.txt' are the same file\n")
    expect(fs.readFile('/w/src/inner.txt')).toBe('inner\n')
  })
  it('디렉터리를 자기 자신의 하위(이미 존재하는 자기 이름)로 옮기면 subdirectory 에러', async () => {
    const r = await sh.exec('mv src src')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("mv: cannot move 'src' to a subdirectory of itself, 'src/src'\n")
    expect(fs.exists('/w/src/src')).toBe(false)
  })
})

describe('rm — trap 7: 없는 경로 조합', () => {
  it('rm -rf 로 없는 경로 + 있는 디렉터리를 함께 지우면 있는 쪽만 지워지고 exit 0', async () => {
    const r = await sh.exec('rm -rf nope src')
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toBe('')
    expect(fs.exists('/w/src')).toBe(false)
  })
  it('rm a nope b: 부분 실패 — a, b 는 지워지고 nope 만 에러, exit 1', async () => {
    fs.writeFile('/w/one.txt', '1\n')
    fs.writeFile('/w/two.txt', '2\n')
    const r = await sh.exec('rm one.txt nope.txt two.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("rm: cannot remove 'nope.txt': No such file or directory\n")
    expect(fs.exists('/w/one.txt')).toBe(false)
    expect(fs.exists('/w/two.txt')).toBe(false)
  })
})

describe('rm — trap 8: 심볼릭 링크는 링크만 지운다', () => {
  it('rm 은 대상 파일이 아니라 링크 자체를 지운다', async () => {
    await sh.exec('ln -s a.txt link')
    const r = await sh.exec('rm link')
    expect(r.exitCode).toBe(0)
    expect(fs.exists('/w/link')).toBe(false)
    expect(fs.readFile('/w/a.txt')).toBe('alpha\n')
  })
})

describe('mkdir — trap 9: 세부 케이스', () => {
  it('중첩 경로 에러 문구는 GNU 그대로다', async () => {
    const r = await sh.exec('mkdir a/b')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("mkdir: cannot create directory 'a/b': No such file or directory\n")
  })
  it('이미 있는 이름(파일) 위에 mkdir -p 하면 실패한다(File exists)', async () => {
    const r = await sh.exec('mkdir -p a.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("mkdir: cannot create directory 'a.txt': File exists\n")
  })
  it('부분 실패: 있는 이름 사이에도 나머지 디렉터리는 만들어진다', async () => {
    const r = await sh.exec('mkdir ok1 empty ok2')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('empty')
    expect(fs.isDir('/w/ok1')).toBe(true)
    expect(fs.isDir('/w/ok2')).toBe(true)
  })
})

describe('rmdir — trap 10: 파일 위에 rmdir', () => {
  it('디렉터리가 아니라 파일이면 Not a directory', async () => {
    const r = await sh.exec('rmdir a.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("rmdir: failed to remove 'a.txt': Not a directory\n")
  })
})

describe('touch — trap 11: 세부 케이스', () => {
  it('없는 디렉터리 밑에 touch 하면 실패한다', async () => {
    const r = await sh.exec('touch nodir/f.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("touch: cannot touch 'nodir/f.txt': No such file or directory\n")
  })
  it('기존 파일의 mtime 을 갱신한다(내용은 그대로)', async () => {
    const before = fs.lstat('/w/a.txt')!.mtime
    await sh.exec('touch a.txt')
    const after = fs.lstat('/w/a.txt')!.mtime
    expect(after).toBeGreaterThan(before)
    expect(fs.readFile('/w/a.txt')).toBe('alpha\n')
  })
  it('부분 실패: 없는 디렉터리가 껴 있어도 나머지는 touch 된다', async () => {
    const r = await sh.exec('touch t1.txt nodir2/t2.txt t3.txt')
    expect(r.exitCode).toBe(1)
    expect(fs.exists('/w/t1.txt')).toBe(true)
    expect(fs.exists('/w/t3.txt')).toBe(true)
  })
})

describe('cp — 부분 실패 (trap 16)', () => {
  it('cp a nope dir: dir 안에 a 는 복사되고 nope 만 에러', async () => {
    const r = await sh.exec('cp a.txt nope.txt empty')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("cp: cannot stat 'nope.txt': No such file or directory\n")
    expect(fs.readFile('/w/empty/a.txt')).toBe('alpha\n')
  })
})
