import { describe, it, expect, beforeEach } from 'vitest'
import { createShell, VFS } from '../index'
import type { Shell } from '../types'

let fs: VFS
let sh: Shell

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/w/sub', { recursive: true })
  fs.writeFile('/w/a.txt', 'one\ntwo\nthree\n')
  fs.writeFile('/w/b.txt', 'BETA\nbeta\n')
  fs.writeFile('/w/.hidden', 'x')
  fs.writeFile('/w/nums', '10\n9\n100\n')
  fs.chmod('/w/a.txt', 0o644)
  sh = createShell({ fs, cwd: '/w', home: '/w' })
})

const out = async (line: string) => (await sh.exec(line)).stdout

describe('ls', () => {
  it('한 줄에 하나씩, 정렬해서 낸다', async () => {
    expect(await out('ls')).toBe('a.txt\nb.txt\nnums\nsub\n')
  })
  it('숨김파일을 숨긴다', async () => {
    expect(await out('ls')).not.toContain('.hidden')
  })
  it('-a 는 숨김파일과 . .. 를 보여준다', async () => {
    expect(await out('ls -a')).toBe('.\n..\n.hidden\na.txt\nb.txt\nnums\nsub\n')
  })
  it('디렉터리를 인자로 주면 그 안을 본다', async () => {
    expect(await out('ls sub')).toBe('')
  })
  it('파일을 인자로 주면 그 이름을 낸다', async () => {
    expect(await out('ls a.txt')).toBe('a.txt\n')
  })
  it('-l 은 모드와 크기를 낸다', async () => {
    expect(await out('ls -l a.txt')).toBe('-rw-r--r-- 1 player player 14 a.txt\n')
  })
  it('-l 은 디렉터리를 d 로 표시한다', async () => {
    // 주의: 브리프 원문 테스트는 `ls -l sub`(sub 는 빈 디렉터리) 였지만, 실측한 실제
    // GNU ls 는 -d 없이 빈 디렉터리를 인자로 주면 "total 0"만 내고 그 디렉터리
    // 자신의 d-줄은 절대 내지 않는다 — docker debian:stable-slim coreutils 9.7:
    // `ls -l emptydir` -> "total 0"뿐, `ls -l -d emptydir` -> "drwxr-xr-x ... emptydir".
    // 이는 브리프의 참조 구현(디렉터리 인자를 받으면 "그 안"을 나열한다)과도 맞다 —
    // 즉 원문 테스트 자체가 자기 구현과도 모순이었다. d-표시를 보려면 하위
    // 디렉터리를 담은 "부모"를 나열해야 한다: `ls -l /w2`(sub 포함) -> 각 자식 줄에
    // "drwxr-xr-x ... sub"가 나온다(docker로 확인). 그래서 sub 를 담은 cwd(/w)를
    // 나열하도록 고쳤다 — 검증하려는 속성(디렉터리는 d)은 그대로다.
    expect(await out('ls -l')).toContain('drwxr-xr-x')
  })
  it('없는 경로는 stderr 와 exit 2', async () => {
    const r = await sh.exec('ls nope')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toBe("ls: cannot access 'nope': No such file or directory\n")
  })

  // debian:stable-slim GNU ls 9.7 실측 추가분.
  it('바이트 순 정렬 — 대문자가 소문자보다 앞선다 (localeCompare 금지)', async () => {
    fs.writeFile('/w/A.txt', 'x')
    expect(await out('ls')).toBe('A.txt\na.txt\nb.txt\nnums\nsub\n')
  })
  it('-l 은 심볼릭 링크를 l 로 표시한다', async () => {
    fs.symlink('a.txt', '/w/link')
    expect(await out('ls -l link')).toContain('l')
    expect((await out('ls -l link')).charAt(0)).toBe('l')
  })
  it('깨진 심볼릭 링크도 이름은 낸다 (실제 GNU ls: exit 0)', async () => {
    fs.symlink('/w/does-not-exist', '/w/broken')
    const r = await sh.exec('ls broken')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe('broken\n')
  })
  it('여러 인자: 파일은 먼저 정렬해 모으고, 디렉터리는 주어진 순서대로 헤더를 붙인다', async () => {
    // docker: `ls -1 a.txt sub` -> "a.txt\n\nsub:\n" (sub 는 비어있음)
    expect(await out('ls a.txt sub')).toBe('a.txt\n\nsub:\n')
  })
  it('여러 디렉터리 인자는 각각 헤더와 빈 줄로 구분한다', async () => {
    fs.mkdir('/w/sub2')
    fs.writeFile('/w/sub2/z.txt', 'z')
    // docker: `ls -1 sub sub2` -> "sub:\n\nsub2:\nz.txt\n"
    expect(await out('ls sub sub2')).toBe('sub:\n\nsub2:\nz.txt\n')
  })
  it('단일 인자는 여러 개여도 하나뿐이면 헤더가 없다', async () => {
    expect(await out('ls sub')).toBe('')
  })
})

describe('cat', () => {
  it('파일 내용을 낸다', async () => {
    expect(await out('cat a.txt')).toBe('one\ntwo\nthree\n')
  })
  it('여러 파일을 이어붙인다', async () => {
    expect(await out('cat a.txt b.txt')).toBe('one\ntwo\nthree\nBETA\nbeta\n')
  })
  it('인자가 없으면 stdin 을 낸다', async () => {
    expect(await out('echo hi | cat')).toBe('hi\n')
  })
  it('-n 은 줄번호를 붙인다', async () => {
    expect(await out('cat -n b.txt')).toBe('     1\tBETA\n     2\tbeta\n')
  })
  it('없는 파일은 계속 진행하되 exit 1', async () => {
    const r = await sh.exec('cat nope a.txt')
    expect(r.stdout).toBe('one\ntwo\nthree\n')
    expect(r.exitCode).toBe(1)
  })

  // task-10 finding 1 회귀 가드: cat 의 에러 문구는 손대지 않는다 (이미 GNU 와 일치).
  // docker: `cat nope` -> "cat: nope: No such file or directory" exit=1.
  it('회귀 가드 — 없는 파일 에러 문구는 그대로다', async () => {
    const r = await sh.exec('cat nope')
    expect(r.stderr).toBe('cat: nope: No such file or directory\n')
    expect(r.exitCode).toBe(1)
  })
})

describe('head / tail', () => {
  it('head 는 기본 10줄', async () => {
    expect(await out('head a.txt')).toBe('one\ntwo\nthree\n')
  })
  it('head -n 2', async () => {
    expect(await out('head -n 2 a.txt')).toBe('one\ntwo\n')
  })
  it('head -2 축약형', async () => {
    expect(await out('head -2 a.txt')).toBe('one\ntwo\n')
  })
  it('tail -n 1', async () => {
    expect(await out('tail -n 1 a.txt')).toBe('three\n')
  })
  it('stdin 에서도 동작한다', async () => {
    expect(await out('cat a.txt | head -n 1')).toBe('one\n')
  })

  // debian:stable-slim GNU coreutils 9.7 실측 추가분.
  it('head -n 0 은 아무것도 안 내고 exit 0', async () => {
    const r = await sh.exec('head -n 0 a.txt')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })
  it('tail -n 0 은 아무것도 안 낸다', async () => {
    expect(await out('tail -n 0 a.txt')).toBe('')
  })
  it('후행 개행이 없는 파일 전체를 head 로 다 뽑으면 마지막 줄에도 개행을 안 붙인다', async () => {
    fs.writeFile('/w/notrail.txt', 'a\nb\nc')
    // docker: `head -n 5 notrail.txt` -> "a\nb\nc" (마지막 줄 뒤 개행 없음)
    expect(await out('head -n 5 notrail.txt')).toBe('a\nb\nc')
  })
  it('후행 개행이 없어도 마지막 줄에 못 미치면 그 줄엔 개행이 있다', async () => {
    fs.writeFile('/w/notrail.txt', 'a\nb\nc')
    expect(await out('head -n 2 notrail.txt')).toBe('a\nb\n')
  })
  it('tail 도 후행 개행 없는 파일의 마지막 줄엔 개행을 안 붙인다', async () => {
    fs.writeFile('/w/notrail.txt', 'a\nb\nc')
    // docker: `tail -n 1 notrail.txt` -> "c" / `tail -n 2 notrail.txt` -> "b\nc"
    expect(await out('tail -n 1 notrail.txt')).toBe('c')
    expect(await out('tail -n 2 notrail.txt')).toBe('b\nc')
  })
  it('여러 파일이면 ==> 이름 <== 헤더를 붙이고 빈 줄로 구분한다', async () => {
    // docker: `head -n 1 a.txt b.txt` -> "==> a.txt <==\none\n\n==> b.txt <==\nBETA\n"
    expect(await out('head -n 1 a.txt b.txt')).toBe('==> a.txt <==\none\n\n==> b.txt <==\nBETA\n')
    expect(await out('tail -n 1 a.txt b.txt')).toBe('==> a.txt <==\nthree\n\n==> b.txt <==\nbeta\n')
  })
  it('파일 하나뿐이면 헤더가 없다', async () => {
    expect(await out('head -n 1 a.txt')).toBe('one\n')
  })

  // task-10 finding 1: head/tail 의 "없는 파일" 에러 문구는 cat/wc/grep 과 다르다.
  // docker debian:stable-slim coreutils 9.7 실측:
  //   `head missing.txt` -> "head: cannot open 'missing.txt' for reading: No such file or directory" exit=1
  //   `tail missing.txt` -> "tail: cannot open 'missing.txt' for reading: No such file or directory" exit=1
  it('head 의 없는 파일 에러는 GNU 문구 그대로다 ("cannot open ... for reading")', async () => {
    const r = await sh.exec('head missing.txt')
    expect(r.stderr).toBe("head: cannot open 'missing.txt' for reading: No such file or directory\n")
    expect(r.exitCode).toBe(1)
  })
  it('tail 의 없는 파일 에러는 GNU 문구 그대로다 ("cannot open ... for reading")', async () => {
    const r = await sh.exec('tail missing.txt')
    expect(r.stderr).toBe("tail: cannot open 'missing.txt' for reading: No such file or directory\n")
    expect(r.exitCode).toBe(1)
  })
  it('여러 인자 중 하나가 없으면, 생존한 파일에도 헤더가 붙고 stderr 엔 GNU 문구가 남는다', async () => {
    // docker: `head a.txt missing.txt` -> stdout "==> a.txt <==\none\ntwo\nthree\n",
    // stderr "head: cannot open 'missing.txt' for reading: No such file or directory\n", exit=1.
    const r = await sh.exec('head a.txt missing.txt')
    expect(r.stdout).toBe('==> a.txt <==\none\ntwo\nthree\n')
    expect(r.stderr).toBe("head: cannot open 'missing.txt' for reading: No such file or directory\n")
    expect(r.exitCode).toBe(1)
  })
})

// 기대값은 전부 debian:stable-slim 의 GNU coreutils 에서 실측한 것이다.
// a.txt = 3줄 14바이트, b.txt = 2줄 10바이트.
describe('wc', () => {
  it('카운터도 입력도 하나면 패딩이 없다', async () => {
    expect(await out('wc -l a.txt')).toBe('3 a.txt\n')
    expect(await out('wc -c a.txt')).toBe('14 a.txt\n')
  })
  it('카운터가 여럿이면 총 바이트의 자릿수만큼 우측정렬한다', async () => {
    expect(await out('wc a.txt')).toBe(' 3  3 14 a.txt\n')
    expect(await out('wc -lc a.txt')).toBe(' 3 14 a.txt\n')
  })
  it('stdin 이면 파일명이 없다', async () => {
    expect(await out('cat a.txt | wc -l')).toBe('3\n')
  })
  it('파이프는 크기를 모르므로 폭이 7이다', async () => {
    expect(await out('cat a.txt | wc')).toBe('      3       3      14\n')
  })
  it('< 리다이렉션은 크기를 아므로 파이프와 폭이 다르다', async () => {
    expect(await out('wc < a.txt')).toBe(' 3  3 14\n')
    expect(await out('wc -l < a.txt')).toBe('3\n')
  })
  it('여러 파일이면 total 을 더하고 폭은 총 바이트 자릿수다', async () => {
    expect(await out('wc -l a.txt b.txt')).toBe(' 3 a.txt\n 2 b.txt\n 5 total\n')
  })

  // debian:stable-slim GNU coreutils 9.7 실측 추가분.
  it('-c 는 진짜 바이트를 센다 (UTF-8, .length 아님)', async () => {
    fs.writeFile('/w/kr.txt', '한')
    // docker: `printf '한' | wc -c` -> 3
    expect(await out('wc -c kr.txt')).toBe('3 kr.txt\n')
  })
  it('후행 개행이 없는 파일은 그만큼 줄 수가 하나 적다 (개행 문자 개수를 센다)', async () => {
    fs.writeFile('/w/notrail.txt', 'a')
    // docker: `printf 'a' | wc -l` -> 0 (toLines() 로 세면 1이 나와 틀린다)
    expect(await out('wc -l notrail.txt')).toBe('0 notrail.txt\n')
    fs.writeFile('/w/notrail2.txt', 'a\nb')
    // docker: `printf 'a\\nb'` 는 개행이 1개뿐이다
    expect(await out('wc -l notrail2.txt')).toBe('1 notrail2.txt\n')
  })
  it('-w 는 연속 공백도 한 단어 경계로 본다', async () => {
    fs.writeFile('/w/sp.txt', 'a   b  c\n')
    expect(await out('wc -w sp.txt')).toBe('3 sp.txt\n')
  })
  it('빈 파일은 전부 0', async () => {
    fs.writeFile('/w/empty.txt', '')
    expect(await out('wc empty.txt')).toBe('0 0 0 empty.txt\n')
  })
  it('없는 파일은 exit 1, total 없음', async () => {
    const r = await sh.exec('wc missing.txt')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(1)
  })
  it('파일 여럿 중 하나가 없어도, 요청한 파일이 둘 이상이면 total 이 나온다', async () => {
    // docker: `wc -l missing.txt a.txt` -> " 3 a.txt\n 3 total\n" (exit 1)
    const r = await sh.exec('wc -l missing.txt a.txt')
    expect(r.stdout).toBe(' 3 a.txt\n 3 total\n')
    expect(r.exitCode).toBe(1)
  })
  it('둘 다 없어도 total 0 은 나온다', async () => {
    // docker: `wc missing1.txt missing2.txt` -> "0 0 0 total\n" (exit 1)
    const r = await sh.exec('wc missing1.txt missing2.txt')
    expect(r.stdout).toBe('0 0 0 total\n')
    expect(r.exitCode).toBe(1)
  })

  // task-10 finding 1 회귀 가드: wc 의 에러 문구는 손대지 않는다 (이미 GNU 와 일치).
  // docker: `wc missing.txt` -> "wc: missing.txt: No such file or directory" exit=1.
  it('회귀 가드 — 없는 파일 에러 문구는 그대로다', async () => {
    const r = await sh.exec('wc missing.txt')
    expect(r.stderr).toBe('wc: missing.txt: No such file or directory\n')
    expect(r.exitCode).toBe(1)
  })
})

describe('stat', () => {
  it('크기와 8진 모드를 낸다', async () => {
    expect(await out('stat -c %s a.txt')).toBe('14\n')
    expect(await out('stat -c %a a.txt')).toBe('644\n')
  })

  // debian:stable-slim GNU coreutils 9.7 실측 추가분.
  it('%F 는 종류를 사람이 읽는 말로 낸다', async () => {
    expect(await out('stat -c %F a.txt')).toBe('regular file\n')
    expect(await out('stat -c %F sub')).toBe('directory\n')
    fs.symlink('a.txt', '/w/link')
    expect(await out('stat -c %F link')).toBe('symbolic link\n')
  })
  it('없는 파일은 exit 1', async () => {
    const r = await sh.exec('stat -c %s missing.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe("stat: cannot statx 'missing.txt': No such file or directory\n")
  })

  // task-10 finding 3: 단일 훑음 정규식(/%[nsaF]/g)이 %% 를 모른다. docker debian:stable-slim
  // coreutils 9.7 실측: `stat -c '%n%%end' a.txt` -> "a.txt%end" (exit 0). 우리 구현은
  // "a.txt%%end" 를 냈었다.
  it('%% 는 리터럴 % 하나로 치환된다', async () => {
    expect(await out('stat -c %n%%end a.txt')).toBe('a.txt%end\n')
  })
})

describe('grep', () => {
  it('매칭되는 줄만 낸다', async () => {
    expect(await out('grep t a.txt')).toBe('two\nthree\n')
  })
  it('-i 는 대소문자를 무시한다', async () => {
    expect(await out('grep -i beta b.txt')).toBe('BETA\nbeta\n')
  })
  it('-v 는 반전한다', async () => {
    expect(await out('grep -v t a.txt')).toBe('one\n')
  })
  it('-c 는 개수만 낸다', async () => {
    expect(await out('grep -c t a.txt')).toBe('2\n')
  })
  it('-n 은 줄번호를 붙인다', async () => {
    expect(await out('grep -n two a.txt')).toBe('2:two\n')
  })
  it('여러 파일이면 파일명을 접두사로 붙인다', async () => {
    expect(await out('grep beta a.txt b.txt')).toBe('b.txt:beta\n')
  })
  it('매칭이 없으면 exit 1', async () => {
    expect((await sh.exec('grep zzz a.txt')).exitCode).toBe(1)
  })
  it('stdin 에서 동작한다', async () => {
    expect(await out('cat a.txt | grep one')).toBe('one\n')
  })

  // debian:stable-slim GNU grep 3.11 실측 추가분.
  it('없는 파일은 exit 2', async () => {
    const r = await sh.exec('grep foo missing.txt')
    expect(r.exitCode).toBe(2)
  })
  it('잘못된 정규식은 exit 2 이고 예외를 던지지 않는다', async () => {
    const r = await sh.exec('grep [ a.txt')
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toBe('')
  })
  it('-c 는 매칭이 없어도 0 을 내고 exit 1', async () => {
    const r = await sh.exec('grep -c zzz a.txt')
    expect(r.stdout).toBe('0\n')
    expect(r.exitCode).toBe(1)
  })
  it('-c 와 -n 을 같이 주면 -n 은 무시된다 (개수만 나온다)', async () => {
    expect(await out('grep -c -n t a.txt')).toBe('2\n')
  })

  // task-10 finding 1 회귀 가드: grep 의 에러 문구는 손대지 않는다 (이미 GNU 와 일치).
  // docker: `grep t missing.txt` -> "grep: missing.txt: No such file or directory" exit=2.
  it('회귀 가드 — 없는 파일 에러 문구는 그대로다', async () => {
    const r = await sh.exec('grep t missing.txt')
    expect(r.stderr).toBe('grep: missing.txt: No such file or directory\n')
    expect(r.exitCode).toBe(2)
  })

  // task-10 finding 4: 잘못된 정규식의 에러 문구가 GNU 와 다르다. docker debian:stable-slim
  // grep 3.11 실측: `echo x | grep '['` -> stderr "grep: Invalid regular expression" exit=2
  // (패턴 문자열은 메세지에 포함되지 않는다 — 예전 우리 구현은 "grep: [: invalid regular
  // expression" 이라 패턴을 끼워 넣고 문구도 소문자였다).
  it('잘못된 정규식 메세지는 GNU 문구 그대로다', async () => {
    const r = await sh.exec('grep [ a.txt')
    expect(r.stderr).toBe('grep: Invalid regular expression\n')
    expect(r.exitCode).toBe(2)
  })
})

describe('sort', () => {
  it('사전순으로 정렬한다', async () => {
    expect(await out('sort nums')).toBe('10\n100\n9\n')
  })
  it('-n 은 수치순', async () => {
    expect(await out('sort -n nums')).toBe('9\n10\n100\n')
  })
  it('-r 은 역순', async () => {
    expect(await out('sort -nr nums')).toBe('100\n10\n9\n')
  })
  it('-u 는 중복을 없앤다', async () => {
    expect(await out('cat nums nums | sort -u -n')).toBe('9\n10\n100\n')
  })

  // debian:stable-slim GNU coreutils 9.7 실측 추가분.
  it('대문자가 소문자보다 앞선다 (기본 정렬, localeCompare 금지)', async () => {
    fs.writeFile('/w/case.txt', 'apple\nApple\nHELLO\nhello\nWORLD\n')
    expect(await out('sort case.txt')).toBe('Apple\nHELLO\nWORLD\napple\nhello\n')
  })
  it('-n 에서 숫자가 아닌 줄은 0 취급하고, 동점이면 바이트 순으로 정한다', async () => {
    // docker: `sort -n` on "xyz\nabc\n5\n" 와 "abc\nxyz\n5\n" 둘 다 -> "abc\nxyz\n5" (입력 순서 무관)
    fs.writeFile('/w/tie.txt', 'xyz\nabc\n5\n')
    expect(await out('sort -n tie.txt')).toBe('abc\nxyz\n5\n')
  })
  it('-n 에서 숫자가 아닌 줄은 0 이지 NaN 이 아니다 — 실수 숫자와 비교해도 맞다', async () => {
    // docker: `sort -n` on "-5\nabc\n3\n-1\n" -> "-5\n-1\nabc\n3" (abc 는 0 으로 -1 과 3 사이)
    fs.writeFile('/w/negs.txt', '-5\nabc\n3\n-1\n')
    expect(await out('sort -n negs.txt')).toBe('-5\n-1\nabc\n3\n')
  })
  it('-n 은 줄 맨 앞의 숫자만 읽는다 (전체가 숫자일 필요 없음)', async () => {
    // docker: `sort -n` on "3abc\nabc3\n2xyz\n" -> "abc3\n2xyz\n3abc"
    fs.writeFile('/w/leadnum.txt', '3abc\nabc3\n2xyz\n')
    expect(await out('sort -n leadnum.txt')).toBe('abc3\n2xyz\n3abc\n')
  })
  it('-ru 는 정렬 후 중복 제거하고 뒤집는다 (역시 뒤집고 중복 제거해도 같은 결과)', async () => {
    fs.writeFile('/w/letters.txt', 'b\na\nb\nc\na\n')
    expect(await out('sort -ru letters.txt')).toBe('c\nb\na\n')
  })

  // task-10 finding 2: -n 의 숫자 키는 parseFloat 이 아니라 GNU 문법(선행 `-`만 허용,
  // `+`와 지수표기 `e` 는 불허)을 따라야 한다. docker debian:stable-slim coreutils 9.7 실측:
  // `printf -- "-3\n+2\nx5\n.5\n1e3\n5x\n10\n" | LC_ALL=C sort -n`
  //   -> "-3\n+2\nx5\n.5\n1e3\n5x\n10\n" (입력 순서 그대로 — 이미 오름차순이었다)
  // parseFloat 였다면 +2 는 2, 1e3 는 1000 으로 읽혀 순서가 달라진다
  // ("-3\nx5\n.5\n+2\n5x\n10\n1e3\n").
  it('-n 은 선행 + 와 지수표기(e)를 받아들이지 않는다 (GNU 실측)', async () => {
    fs.writeFile('/w/mixed.txt', '-3\n+2\nx5\n.5\n1e3\n5x\n10\n')
    expect(await out('sort -n mixed.txt')).toBe('-3\n+2\nx5\n.5\n1e3\n5x\n10\n')
  })

  // task-10 finding 1: sort 의 "없는 파일" 에러 문구도 head/tail 처럼 cat/wc/grep 과
  // 다르고, exit 코드도 다르다(2). docker debian:stable-slim coreutils 9.7 실측:
  // `sort missing.txt` -> "sort: cannot read: missing.txt: No such file or directory" exit=2.
  it('sort 의 없는 파일 에러는 GNU 문구 그대로다 ("cannot read: ...") 이고 exit 2다', async () => {
    const r = await sh.exec('sort missing.txt')
    expect(r.stderr).toBe('sort: cannot read: missing.txt: No such file or directory\n')
    expect(r.exitCode).toBe(2)
  })
})
