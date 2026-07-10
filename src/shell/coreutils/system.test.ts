import { describe, it, expect, beforeEach } from 'vitest'
import { createShell, VFS } from '../index'
import type { Shell } from '../types'

let fs: VFS
let sh: Shell
beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/w/sub', { recursive: true })
  fs.writeFile('/w/a.txt', 'a\n')
  fs.writeFile('/w/b.log', 'bb\n')
  fs.writeFile('/w/sub/c.txt', 'ccc\n')
  fs.writeFile('/w/sub/d.log', 'd\n')
  fs.writeFile('/w/items.txt', 'x\ny\n')
  sh = createShell({ fs, cwd: '/w', home: '/w' })
})
const out = async (line: string) => (await sh.exec(line)).stdout

describe('find', () => {
  it('-name 글롭 (정렬해서 대조)', async () => {
    expect(await out('find . -name "*.txt" | sort')).toBe('./a.txt\n./items.txt\n./sub/c.txt\n')
  })
  it('-type f', async () => {
    expect(await out('find . -type f | sort')).toBe('./a.txt\n./b.log\n./items.txt\n./sub/c.txt\n./sub/d.log\n')
  })
  it('-type d', async () => { expect(await out('find . -type d | sort')).toBe('.\n./sub\n') })
  it('경로 인자', async () => { expect(await out('find sub | sort')).toBe('sub\nsub/c.txt\nsub/d.log\n') })
  it('-exec 로 매치마다 실행', async () => {
    await sh.exec('find . -name "*.log" -exec rm {} \\;')
    expect(fs.exists('/w/b.log')).toBe(false)
    expect(fs.exists('/w/sub/d.log')).toBe(false)
    expect(fs.exists('/w/a.txt')).toBe(true)
  })

  // docker debian:stable-slim coreutils 9.7 로 확인한 경계 케이스들.

  it('경로 인자 없으면 기본값 .', async () => {
    expect(await out('find -type d | sort')).toBe('.\n./sub\n')
  })

  it('"." 자기 자신은 -name 매칭 시 basename이 "." — 다른 이름과 매치 안 됨', async () => {
    // docker: `cd /w; find . -name "w"` → 아무것도 안 나옴 (실제 디렉터리 이름 "w"가 아니라
    // 리터럴 "." 이 basename이라서). 절대경로 인자를 주면 그 디렉터리의 실제 이름이 basename.
    expect(await out('find . -name "w"')).toBe('')
    expect(await out('find /w -name "w"')).toBe('/w\n')
  })

  it('"." 은 -name "*" 에 매치된다 (fnmatch 는 선행 점을 특별 취급 안 함)', async () => {
    // docker: `find . -name "*"` 는 `.` 자신도 낸다 — bash 글롭(matchSegment)의
    // "선행 점은 * 에 안 걸림" 규칙과 다르다. find 는 dotglob 처럼 매치한다.
    expect(await out('find . -name "*" | sort')).toBe(
      ['.', './a.txt', './b.log', './items.txt', './sub', './sub/c.txt', './sub/d.log'].sort().join('\n') + '\n',
    )
  })

  it('숨김 파일도 -name "*" 에 매치된다 (dotglob 동작)', async () => {
    fs.writeFile('/w/.hidden', 'h\n')
    expect(await out('find . -name "*.hidden" | sort')).toBe('./.hidden\n')
  })

  it('존재하지 않는 경로 인자는 에러 + exit 1, 나머지 경로는 계속 처리', async () => {
    const r = await sh.exec('find nope sub')
    expect(r.stderr).toBe("find: 'nope': No such file or directory\n")
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe('sub\nsub/c.txt\nsub/d.log\n')
  })

  it('-exec 서브커맨드가 실패해도 find 자체의 exit code 는 안 바뀐다 (GNU 실측)', async () => {
    const r = await sh.exec('find . -name "*.txt" -exec false {} \\;')
    expect(r.exitCode).toBe(0)
  })

  it('{} 는 인자 안에 끼어 있어도 치환된다', async () => {
    expect(await out('find . -name "a.txt" -exec echo "file:{}" \\;')).toBe('file:./a.txt\n')
  })

  it('지원하지 않는 술어는 거절한다', async () => {
    const r = await sh.exec('find . -foo')
    expect(r.stderr).toBe('flashshell: find: 지원하지 않는 술어입니다: -foo\n')
    expect(r.exitCode).toBe(2)
  })
})

describe('xargs', () => {
  it('stdin 토큰을 명령 인자로', async () => {
    expect(await out('find . -name "*.txt" | sort | xargs wc -l')).toBe(' 1 ./a.txt\n 2 ./items.txt\n 1 ./sub/c.txt\n 4 total\n')
  })
  it('-I 로 줄마다 치환 실행', async () => {
    expect(await out('find . -name "*.txt" | sort | xargs -I {} echo got {}')).toBe('got ./a.txt\ngot ./items.txt\ngot ./sub/c.txt\n')
  })
  it('CMD 생략 시 기본 echo', async () => {
    expect(await out('echo hi | xargs')).toBe('hi\n')
  })
  it('빈 stdin 이어도 CMD 는 한 번 실행된다 (GNU 기본, -r 아님)', async () => {
    expect(await out('echo -n "" | xargs echo hello')).toBe('hello\n')
  })
  it('-I 는 빈 stdin 이면 아예 실행하지 않는다', async () => {
    expect(await out('echo -n "" | xargs -I{} echo got {}')).toBe('')
  })
  it('서브커맨드가 1~125 로 실패하면 xargs exit code 는 123 (GNU 실측)', async () => {
    const r = await sh.exec('echo hi | xargs false')
    expect(r.exitCode).toBe(123)
  })
  it('-I{} 붙인 형태로 줄마다 치환 실행 (GNU 와 동일)', async () => {
    expect(await out('cat items.txt | xargs -I{} echo got {}')).toBe('got x\ngot y\n')
  })
  it('회귀: -I {} 띄어쓰기 형태도 계속 작동', async () => {
    expect(await out('cat items.txt | xargs -I {} echo got {}')).toBe('got x\ngot y\n')
  })
  it('회귀: xargs echo 토큰 붙임', async () => {
    expect(await out('cat items.txt | xargs echo')).toBe('x y\n')
  })
  it('회귀: xargs 기본 echo', async () => {
    expect(await out('cat items.txt | xargs')).toBe('x y\n')
  })
})

describe('diff', () => {
  beforeEach(() => {
    fs.writeFile('/w/x.txt', 'one\ntwo\nthree\n')
    fs.writeFile('/w/y.txt', 'one\n2\nthree\n')
    fs.writeFile('/w/z.txt', 'one\ntwo\nthree\n')
  })
  it('같으면 exit 0, 출력 없음', async () => {
    const r = await sh.exec('diff x.txt z.txt'); expect(r.exitCode).toBe(0); expect(r.stdout).toBe(''); expect(r.stderr).toBe('')
  })
  it('-q 다르면 differ 한 줄, exit 1', async () => {
    const r = await sh.exec('diff -q x.txt y.txt')
    expect(r.exitCode).toBe(1); expect(r.stdout).toBe('Files x.txt and y.txt differ\n')
  })
  it('-q 같으면 출력 없음 exit 0', async () => {
    const r = await sh.exec('diff -q x.txt z.txt'); expect(r.exitCode).toBe(0); expect(r.stdout).toBe('')
  })
  it('파일 없으면 exit 2', async () => {
    const r = await sh.exec('diff x.txt nope.txt'); expect(r.exitCode).toBe(2); expect(r.stderr).toContain('diff')
  })

  // Regression guard: bare diff on differing files must fail closed (no guessed hunk output)
  it('(-q 없이) 다른 파일은 flashshell 거절 메시지, exit 1, stdout 공백', async () => {
    const r = await sh.exec('diff x.txt y.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })

  // Missing operand: one file argument only
  it('인자 하나만 주면 missing operand, exit 2', async () => {
    const r = await sh.exec('diff x.txt')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('missing operand')
  })

  // Extra operand: three file arguments
  it('인자 세 개면 extra operand, exit 2', async () => {
    const r = await sh.exec('diff x.txt y.txt z.txt')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('extra operand')
  })
})
