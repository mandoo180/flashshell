import { describe, it, expect, beforeEach } from 'vitest'
import { createShell } from './index'
import { run, childCtx } from './interpreter'
import { VFS } from './vfs'
import { VfsError } from './errors'
import type { Shell, ShellState } from './types'

let fs: VFS
let sh: Shell

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/home/player', { recursive: true })
  fs.writeFile('/home/player/a.txt', 'alpha\n')
  fs.writeFile('/home/player/b.txt', 'beta\n')
  sh = createShell({ fs, cwd: '/home/player', home: '/home/player' })
})

describe('기본 실행', () => {
  it('명령을 실행하고 stdout 을 준다', async () => {
    expect(await sh.exec('echo hi')).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 })
  })

  it('빈 줄은 exit code 0 이고 아무 출력이 없다', async () => {
    expect(await sh.exec('')).toEqual({ stdout: '', stderr: '', exitCode: 0 })
    expect(await sh.exec('   ')).toEqual({ stdout: '', stderr: '', exitCode: 0 })
  })

  it('없는 명령은 command not found 이고 exit 127', async () => {
    const r = await sh.exec('nosuchthing')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toBe('bash: nosuchthing: command not found\n')
  })

  it('미구현 명령은 다른 메시지를 준다', async () => {
    // find/diff는 각각 task-4/task-5에서 구현되어 이 목록에서 빠졌다 — 여전히
    // 미구현인 다른 이름(comm)으로 검증한다.
    const r = await sh.exec('comm 1')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toBe('flashshell: comm: 이 환경에는 없는 명령입니다\n')
  })

  it('문법 오류는 exit 2', async () => {
    const r = await sh.exec('echo >')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/syntax error/)
  })
})

describe('상태 유지', () => {
  it('cd 가 셸의 cwd 를 바꾸고 다음 명령에 이어진다', async () => {
    fs.mkdir('/home/player/docs')
    await sh.exec('cd docs')
    expect(sh.cwd).toBe('/home/player/docs')
    expect((await sh.exec('pwd')).stdout).toBe('/home/player/docs\n')
  })

  it('변수 대입이 다음 명령에 이어진다', async () => {
    await sh.exec('X=hello')
    expect((await sh.exec('echo $X')).stdout).toBe('hello\n')
  })

  it('명령 앞의 대입은 그 명령에만 적용되고 사라진다', async () => {
    await sh.exec('FOO=bar echo $FOO') // 확장이 먼저 일어나므로 빈 줄이 나온다
    expect(sh.env.FOO).toBeUndefined()
  })

  it('$? 가 직전 exit code 를 반영한다', async () => {
    await sh.exec('false')
    expect((await sh.exec('echo $?')).stdout).toBe('1\n')
  })
})

describe('환경 복사-되돌리기 (trap 1)', () => {
  it('이미 있던 변수를 명령 앞 대입이 가리면, 명령이 끝난 뒤 원래 값으로 남는다', async () => {
    await sh.exec('FOO=x')
    await sh.exec('FOO=y true') // true 는 아무것도 건드리지 않는 빌트인
    expect(sh.env.FOO).toBe('x')
  })

  it('unset 은 셸에서 변수를 실제로 지운다', async () => {
    await sh.exec('X=1')
    expect(sh.env.X).toBe('1')
    await sh.exec('unset X')
    expect(sh.env.X).toBeUndefined()
  })

  it('export A=1 은 다음 명령에도 남는다', async () => {
    await sh.exec('export A=1')
    expect(sh.env.A).toBe('1')
    expect((await sh.exec('echo $A')).stdout).toBe('1\n')
  })

  it('FOO=y unset FOO — 임시 대입이 unset 이 지운 값을 대신 남기지 않는다 (bash 확인됨)', async () => {
    // docker debian:stable-slim bash 5.2.37 로 확인: FOO=x; FOO=y unset FOO; echo $FOO → x
    // (프리픽스 대입은 그 명령의 셰도우 환경에서만 보이고, 명령이 끝나면 통째로 버려진다 —
    //  unset 이 그 섀도우 안에서 무엇을 했는지와 무관하게, 원래 값이 그대로 남는다.)
    await sh.exec('FOO=x')
    await sh.exec('FOO=y unset FOO')
    expect(sh.env.FOO).toBe('x')
  })

  it('FOO=y unset ZZZ — 원래 없던 변수라면 임시 대입도 남지 않는다', async () => {
    await sh.exec('unset FOO')
    await sh.exec('FOO=y unset ZZZ')
    expect(sh.env.FOO).toBeUndefined()
  })
})

describe('리다이렉션', () => {
  it('> 로 파일에 쓴다', async () => {
    await sh.exec('echo hi > out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('hi\n')
  })

  it('> 는 기존 내용을 덮어쓴다', async () => {
    await sh.exec('echo one > out.txt')
    await sh.exec('echo two > out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('two\n')
  })

  it('>> 는 이어붙인다', async () => {
    await sh.exec('echo one > out.txt')
    await sh.exec('echo two >> out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('one\ntwo\n')
  })

  it('< 로 stdin 을 읽는다', async () => {
    expect((await sh.exec('cat < a.txt')).stdout).toBe('alpha\n')
  })

  it('2> 는 stderr 만 잡고 stdout 은 통과시킨다', async () => {
    const r = await sh.exec('cat a.txt nope.txt 2> err.txt')
    expect(r.stdout).toBe('alpha\n')
    expect(r.stderr).toBe('')
    expect(fs.readFile('/home/player/err.txt')).toContain('No such file or directory')
  })

  it('2> 는 명령이 stderr 를 내지 않아도 파일을 비운다', async () => {
    fs.writeFile('/home/player/err.txt', 'old\n')
    await sh.exec('true 2> err.txt')
    expect(fs.readFile('/home/player/err.txt')).toBe('')
  })

  it('리다이렉션 대상이 여러 개로 확장되면 ambiguous redirect', async () => {
    const r = await sh.exec('echo hi > *.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toMatch(/ambiguous redirect/)
  })

  it('> 는 명령 실행 전에 파일을 비운다', async () => {
    await sh.exec('cat a.txt > a.txt')
    expect(fs.readFile('/home/player/a.txt')).toBe('')
  })

  it('< nonexistent 는 exit 1 이고 명령이 실행되지 않는다', async () => {
    const r = await sh.exec('cat < nope.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('No such file or directory')
  })
})

describe('리다이렉션 순서 (trap 4, docker 로 확인됨)', () => {
  it('> out < gone — out 을 먼저 비우고서 gone 이 없어서 실패한다', async () => {
    // docker: printf "old-A\n" > out; cat > out < gone.txt  →  out 은 빈 파일로 남는다
    fs.writeFile('/home/player/out.txt', 'old-A\n')
    const r = await sh.exec('cat > out.txt < gone.txt')
    expect(r.exitCode).toBe(1)
    expect(fs.readFile('/home/player/out.txt')).toBe('')
  })

  it('< gone > out — gone 이 없어서 먼저 실패하므로 out 은 건드리지 않는다', async () => {
    // docker: printf "old-B\n" > out; cat < gone.txt > out  →  out 은 old-B 그대로
    fs.writeFile('/home/player/out2.txt', 'old-B\n')
    const r = await sh.exec('cat < gone.txt > out2.txt')
    expect(r.exitCode).toBe(1)
    expect(fs.readFile('/home/player/out2.txt')).toBe('old-B\n')
  })

  it('같은 fd 로 두 번 리다이렉션되면 마지막 것만 내용을 받고, 앞선 것도 비워지긴 한다', async () => {
    // docker: echo hi > a > b  →  a=[](비워짐, 안 씌워짐) b=[hi](실제로 씌워짐)
    fs.writeFile('/home/player/ra.txt', 'keepA\n')
    fs.writeFile('/home/player/rb.txt', 'keepB\n')
    await sh.exec('echo hi > ra.txt > rb.txt')
    expect(fs.readFile('/home/player/ra.txt')).toBe('')
    expect(fs.readFile('/home/player/rb.txt')).toBe('hi\n')
  })

  it('앞선 리다이렉션의 파일 비우기는 뒤가 ambiguous 로 실패해도 되돌아가지 않는다', async () => {
    // docker: echo hi > keep.txt > *.txt (2개 매치) → keep.txt 는 빈 파일로 남는다
    fs.writeFile('/home/player/keep.txt', 'keep\n')
    const r = await sh.exec('echo hi > keep.txt > *.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toMatch(/ambiguous redirect/)
    expect(fs.readFile('/home/player/keep.txt')).toBe('')
  })
})

describe('리다이렉션 open/read 분리 (task 9, docker 로 확인됨)', () => {
  // docker: cd /tmp && printf "alpha\n" > a.txt && cat < a.txt > a.txt; echo "[$(cat a.txt)]"
  //   → []  (bash는 명령을 돌리기 전에 모든 리다이렉션을 먼저 연다: `<` 는 열기만 하고,
  //   내용은 `>` 가 같은 파일을 비운 *뒤에* 읽는다.)
  it('cat < a.txt > a.txt 는 a.txt 를 비운다 (같은 파일을 열고-나서-비우고-나서-읽는다)', async () => {
    const r = await sh.exec('cat < a.txt > a.txt')
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
    expect(r.exitCode).toBe(0)
    expect(fs.readFile('/home/player/a.txt')).toBe('')
  })

  it('회귀: cat > a.txt < a.txt (역순) 은 이미 비운 뒤라 그대로 비어있다', async () => {
    // docker: cd /tmp && printf "alpha\n" > a.txt && cat > a.txt < a.txt; echo "[$(cat a.txt)]"
    //   → []
    const r = await sh.exec('cat > a.txt < a.txt')
    expect(r.exitCode).toBe(0)
    expect(fs.readFile('/home/player/a.txt')).toBe('')
  })

  it('회귀: cat < gone.txt > out.txt 는 gone.txt 를 못 열어서 out.txt 를 아예 만들지 않는다', async () => {
    // docker: cd /tmp && cat < gone.txt > out.txt; echo exit=$?; ls out.txt
    //   → exit=1, ls: cannot access 'out.txt': No such file or directory (out.txt 없음)
    const r = await sh.exec('cat < gone.txt > out.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('gone.txt')
    expect(fs.exists('/home/player/out.txt')).toBe(false)
  })

  it('회귀: cat < a.txt (단독, > 없음) 은 a.txt 내용을 그대로 읽는다', async () => {
    const r = await sh.exec('cat < a.txt')
    expect(r.stdout).toBe('alpha\n')
    expect(r.exitCode).toBe(0)
  })

  it('< 로 없는 파일을 열면 확장된 원본 단어로 에러를 낸다 (해석된 절대경로 아님)', async () => {
    // docker: cd /tmp && cat < nope.txt; echo exit=$?
    //   → bash: line 1: nope.txt: No such file or directory (줄번호 접두는 bash -c 산물이라 뺀다)
    const r = await sh.exec('cat < nope.txt')
    expect(r.stderr).toBe('bash: nope.txt: No such file or directory\n')
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe('')
  })

  it('ambiguous redirect 메시지에 대상 단어(글롭 원문)가 들어가고, 두 파일 다 건드리지 않는다', async () => {
    // docker: cd /tmp && touch a.txt b.txt && echo hi > *.txt; echo exit=$?
    //   → bash: line 1: *.txt: ambiguous redirect (a.txt/b.txt 내용 그대로)
    const r = await sh.exec('echo hi > *.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe('bash: *.txt: ambiguous redirect\n')
    expect(fs.readFile('/home/player/a.txt')).toBe('alpha\n')
    expect(fs.readFile('/home/player/b.txt')).toBe('beta\n')
  })

  it('회귀: > 은 여전히 쓰고, 없는 명령도 파일을 만들며 exit 127, 여러 > 는 마지막만 내용을 받는다', async () => {
    await sh.exec('echo hi > out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('hi\n')

    const r = await sh.exec('nosuchcmd > n.txt')
    expect(r.exitCode).toBe(127)
    expect(fs.exists('/home/player/n.txt')).toBe(true)

    await sh.exec('echo hi > o1 > o2')
    expect(fs.readFile('/home/player/o1')).toBe('')
    expect(fs.readFile('/home/player/o2')).toBe('hi\n')
  })
})

describe('파이프라인', () => {
  it('stdout 을 다음 명령의 stdin 으로 넘긴다', async () => {
    expect((await sh.exec('echo hi | cat')).stdout).toBe('hi\n')
  })

  it('세 단계도 흐른다', async () => {
    expect((await sh.exec('echo hi | cat | cat')).stdout).toBe('hi\n')
  })

  it('exit code 는 마지막 명령의 것이다', async () => {
    expect((await sh.exec('false | true')).exitCode).toBe(0)
    expect((await sh.exec('true | false')).exitCode).toBe(1)
  })

  it('중간 단계의 stderr 는 파이프를 타지 않고 밖으로 나온다', async () => {
    const r = await sh.exec('cat nope.txt | cat')
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('No such file or directory')
  })
})

describe('파이프라인 안의 빌트인 (trap 2 — 실제 bash와 일치시키기로 결정)', () => {
  // docker: cd /tmp; echo hi | cd /; pwd  →  /tmp (파이프의 각 단계는 서브셸이라 부모 cwd 는 안 바뀐다)
  // docker: X=orig; echo hi | X=1; echo $X  →  X=orig
  // 우리 인터프리터도 이를 그대로 재현한다: 파이프라인 단계가 2개 이상이면 각 단계는 cwd/env 의
  // 얕은 복사본 위에서 실행되고, 그 변경은 바깥 셸로 새지 않는다. (단일 명령은 이 클론을 타지
  // 않으므로 `cd /tmp` 단독 실행은 여전히 셸을 옮긴다.)
  it('파이프 안의 cd 는 바깥 셸의 cwd 를 바꾸지 않는다', async () => {
    const before = sh.cwd
    await sh.exec('echo hi | cd /')
    expect(sh.cwd).toBe(before)
  })

  it('파이프 안의 대입은 바깥 셸에 남지 않는다', async () => {
    await sh.exec('unset X')
    await sh.exec('echo hi | X=1')
    expect(sh.env.X).toBeUndefined()
  })
})

describe('명령 치환 안의 cd (trap 3)', () => {
  it('$(cd /) 는 바깥 셸을 옮기지 않는다', async () => {
    const before = sh.cwd
    await sh.exec('echo $(cd /)')
    expect(sh.cwd).toBe(before)
  })
})

describe('연결자', () => {
  it('&& 는 앞이 성공해야 뒤를 실행한다', async () => {
    expect((await sh.exec('true && echo yes')).stdout).toBe('yes\n')
    expect((await sh.exec('false && echo yes')).stdout).toBe('')
  })

  it('|| 는 앞이 실패해야 뒤를 실행한다', async () => {
    expect((await sh.exec('false || echo yes')).stdout).toBe('yes\n')
    expect((await sh.exec('true || echo yes')).stdout).toBe('')
  })

  it('; 는 무조건 실행한다', async () => {
    expect((await sh.exec('false ; echo yes')).stdout).toBe('yes\n')
  })

  it('출력이 순서대로 이어붙는다', async () => {
    expect((await sh.exec('echo a ; echo b')).stdout).toBe('a\nb\n')
  })

  it('건너뛴 항목은 $? 를 갱신하지 않는다', async () => {
    // false && echo a || echo b — ||는 여전히 false의 exit code(1)를 보고 echo b를 실행한다
    expect((await sh.exec('false && echo a || echo b')).stdout).toBe('b\n')
  })
})

describe('확장 통합', () => {
  it('글롭이 인자로 펼쳐진다', async () => {
    expect((await sh.exec('echo *.txt')).stdout).toBe('a.txt b.txt\n')
  })

  it('명령치환이 동작한다', async () => {
    expect((await sh.exec('echo $(echo nested)')).stdout).toBe('nested\n')
  })

  it('명령치환 안의 파이프도 동작한다', async () => {
    expect((await sh.exec('echo $(echo hi | cat)')).stdout).toBe('hi\n')
  })

  it('중첩된 명령치환도 동작한다', async () => {
    expect((await sh.exec('echo $(echo $(echo hi))')).stdout).toBe('hi\n')
  })
})

describe('대입값 확장 — 단어분리·글롭 없음 (task 5, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // 대입값(NAME=VALUE 의 VALUE)은 단어분리도 글롭도 받지 않는다 — task 5 의 env IFS 변경이
  // 이 경로에 회귀를 만들지 않도록 고정한다(하드코딩 IFS 시절엔 우연히 안 깨졌을 뿐).
  // docker: IFS=:; IFS=:; echo "[$IFS]" => [:]
  it('IFS 가 이미 : 여도 IFS=: 재대입은 : 로 남는다 (값 : 가 IFS 로 잘리지 않음)', async () => {
    expect((await sh.exec('IFS=:; IFS=:; echo "[$IFS]"')).stdout).toBe('[:]\n')
  })
  // docker: IFS=:; x=a:b:c; echo "[$x]" => [a:b:c]
  it('IFS=: 이어도 대입값 안의 : 는 단어분리되지 않는다', async () => {
    expect((await sh.exec('IFS=:; x=a:b:c; echo "[$x]"')).stdout).toBe('[a:b:c]\n')
  })
  // docker: IFS=:; PATH2=/a:/b; echo "[$PATH2]" => [/a:/b]
  it('IFS=: 이어도 PATH 류 대입값이 안 잘린다', async () => {
    expect((await sh.exec('IFS=:; P=/a:/b; echo "[$P]"')).stdout).toBe('[/a:/b]\n')
  })
  // docker: y=*.txt; echo "[$y]" => [*.txt] (대입값은 글롭 안 함)
  it('대입값은 글롭으로 펼쳐지지 않는다', async () => {
    expect((await sh.exec('y=*.txt; echo "[$y]"')).stdout).toBe('[*.txt]\n')
  })
  // docker: IFS=:; z=$(echo a:b:c); echo "[$z]" => [a:b:c] (명령치환 결과도 대입값에선 안 잘린다)
  it('대입값의 명령치환 결과는 단어분리되지 않는다 (IFS=: 에서도)', async () => {
    expect((await sh.exec('IFS=:; z=$(echo a:b:c); echo "[$z]"')).stdout).toBe('[a:b:c]\n')
  })
})

describe('env IFS 통합 (task 5, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // docker: IFS=:; f() { echo "$*"; }; f a b c => a:b:c
  it('IFS=: 이면 함수 안 "$*" 가 : 로 조인된다', async () => {
    expect((await sh.exec('IFS=:; f() { echo "$*"; }; f a b c')).stdout).toBe('a:b:c\n')
  })
  // docker: IFS=:; f() { for a in $1; do echo "[$a]"; done; }; f "x:y:z" => [x] [y] [z]
  it('IFS=: 이면 비따옴표 확장이 : 에서 쪼개진다', async () => {
    expect((await sh.exec('IFS=:; f() { for a in $1; do echo "[$a]"; done; }; f "x:y:z"')).stdout).toBe('[x]\n[y]\n[z]\n')
  })
  // docker: IFS=:; echo a:b:c => a:b:c (리터럴은 IFS 로 안 잘린다 — 확장 결과만 분할)
  it('IFS=: 이어도 리터럴 인자는 분할되지 않는다', async () => {
    expect((await sh.exec('IFS=:; echo a:b:c')).stdout).toBe('a:b:c\n')
  })
  // docker: f() { for a in "$@"; do echo "[$a]"; done; }; f x "y z" w => [x] [y z] [w]
  it('"$@" 는 함수 인자를 개별 필드로 보존한다 (내부 공백 포함)', async () => {
    expect((await sh.exec('f() { for a in "$@"; do echo "[$a]"; done; }; f x "y z" w')).stdout).toBe('[x]\n[y z]\n[w]\n')
  })
  // docker: f() { for a in "pre$@post"; do echo "[$a]"; done; }; f A B C => [preA] [B] [Cpost]
  it('"pre$@post" 는 앞뒤 텍스트에 첫·마지막 인자를 붙인다', async () => {
    expect((await sh.exec('f() { for a in "pre$@post"; do echo "[$a]"; done; }; f A B C')).stdout).toBe('[preA]\n[B]\n[Cpost]\n')
  })
  // docker: f() { for a in "$@"; do echo x; done; }; f => (무출력)
  it('"$@" 는 인자가 없으면 루프가 한 번도 안 돈다', async () => {
    expect((await sh.exec('f() { for a in "$@"; do echo x; done; }; f')).stdout).toBe('')
  })
})

describe('"$@" 빈 인자 & 리뷰 수정 (task 5 fix, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // Issue 1: 빈 문자열 인자도 개별 필드로 보존
  // docker: f() { for w in "$@"; do echo "[$w]"; done; }; f "" => []
  it('"$@" 인자가 빈 문자열 하나면 빈 필드 하나', async () => {
    expect((await sh.exec('f() { for w in "$@"; do echo "[$w]"; done; }; f ""')).stdout).toBe('[]\n')
  })
  // docker: f a "" b => [a][][b]
  it('"$@" 중간 빈 인자 보존', async () => {
    expect((await sh.exec('f() { for w in "$@"; do echo "[$w]"; done; }; f a "" b')).stdout).toBe('[a]\n[]\n[b]\n')
  })
  // Issue 2: x="$@" 는 스페이스로 조인 (IFS=: 여도)
  // docker: f() { x="$@"; echo "[$x]"; }; f a b c => [a b c]
  it('x="$@" 대입은 스페이스로 조인한다', async () => {
    expect((await sh.exec('f() { x="$@"; echo "[$x]"; }; f a b c')).stdout).toBe('[a b c]\n')
  })
  it('IFS=: 이어도 x="$@" 는 스페이스 조인 (x="$*" 는 콜론)', async () => {
    expect((await sh.exec('IFS=:; f() { x="$@"; echo "[$x]"; }; f a b c')).stdout).toBe('[a b c]\n')
    expect((await sh.exec('IFS=:; f() { x="$*"; echo "[$x]"; }; f a b c')).stdout).toBe('[a:b:c]\n')
  })
  // docker: case "$@" in "a b c") ... => MATCH (space-join)
  it('case subject "$@" 도 스페이스로 조인해 매칭한다', async () => {
    expect((await sh.exec('h() { case "$@" in "a b c") echo MATCH;; *) echo NO;; esac; }; h a b c')).stdout).toBe('MATCH\n')
  })
  // Issue 3: 비공백 IFS 빈 필드 보존
  // docker: IFS=:; v="a::b"; for w in $v => [a][][b]
  it('IFS=: 인접 구분자는 빈 필드를 만든다', async () => {
    expect((await sh.exec('IFS=:; v="a::b"; for w in $v; do echo "[$w]"; done')).stdout).toBe('[a]\n[]\n[b]\n')
  })
  // docker: IFS=:; v=":a:b" => [][a][b]
  it('IFS=: 선행 구분자는 선행 빈 필드', async () => {
    expect((await sh.exec('IFS=:; v=":a:b"; for w in $v; do echo "[$w]"; done')).stdout).toBe('[]\n[a]\n[b]\n')
  })
  it('회귀: 기본 공백 IFS 는 연속 공백을 접는다 (변경 없음)', async () => {
    expect((await sh.exec('v="a  b"; for w in $v; do echo "[$w]"; done')).stdout).toBe('[a]\n[b]\n')
  })
})

describe('파라미터 확장 — 길이/기본값/대체 (task 3, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('${#NAME} 길이', async () => {
    const r = await sh.exec('NAME=world; echo ${#NAME}')
    expect(r.stdout).toBe('5\n')
  })

  it('${VAR:-fb} 계열이 명령 실행 경로에서도 동작한다', async () => {
    const r = await sh.exec('echo ${UNSET:-fb} ${NAME:-fb}')
    expect(r.stdout).toBe('fb fb\n') // 둘 다 이 셸에 미설정
  })

  it('${UNSET:=def} 대입 부작용이 셸 상태(env)에 남는다', async () => {
    const r = await sh.exec('echo ${UNSET:=def}; echo $UNSET')
    expect(r.stdout).toBe('def\ndef\n')
  })

  it('따옴표 없는 ${UNSET:-a b} 의 다중 단어 arg 가 확장 뒤 인자별로 분할된다 (docker: echo ${UNSET:-a b} → "a b")', async () => {
    const r = await sh.exec('echo ${UNSET:-a b}')
    expect(r.stdout).toBe('a b\n') // echo 가 두 인자 a, b 를 공백으로 이어 출력
  })

  it('for 루프에서도 다중 단어 arg 가 값별로 쪼개진다 (docker: for w in ${UNSET:-a b} → w=a / w=b)', async () => {
    const r = await sh.exec('for w in ${UNSET:-a b}; do echo $w; done')
    expect(r.stdout).toBe('a\nb\n')
  })

  it('큰따옴표로 감싸면 다중 단어 arg 는 한 인자로 남는다 (회귀, docker: echo "${UNSET:-a b}" → "a b")', async () => {
    const r = await sh.exec('echo "${UNSET:-a b}"')
    expect(r.stdout).toBe('a b\n')
  })

  it('${UNSET:?boom} 은 ExecResult(비-0 exit + stderr)로 surface 된다 — exec 은 절대 reject/hang 하지 않는다 (trap 12 와 같은 계약)', async () => {
    const r = await sh.exec('echo ${UNSET:?boom}')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('UNSET: boom')
    expect(r.stdout).toBe('')
  })

  it('오류가 난 명령 뒤로도 스크립트는 계속된다 (Task 1의 ArithError 와 같은 문서화된 단순화 — 진짜 bash 는 non-interactive 스크립트 전체를 fatal 로 끝낸다)', async () => {
    const r = await sh.exec('echo ${UNSET:?boom}; echo after')
    expect(r.stdout).toBe('after\n')
    expect(r.stderr).toContain('UNSET: boom')
  })
})

describe('무한루프 방어', () => {
  it('스텝 예산을 넘기면 중단하고 안내 메시지를 준다', async () => {
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 3 })
    const r = await tiny.exec('echo 1 ; echo 2 ; echo 3 ; echo 4 ; echo 5')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })

  it('스텝 예산은 서브셸과 공유되고 리셋되지 않는다 (trap 11)', async () => {
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 2 })
    const r = await tiny.exec('echo $(echo a) $(echo b) $(echo c)')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })

  it('예산 초과가 리다이렉션 대상의 명령치환 안에서 터지면 ambiguous redirect 로 둔갑하지 않는다', async () => {
    // 리다이렉션 대상 확장의 catch 가 ExecutionLimitError 까지 삼키던 버그를 고정한다.
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 1 })
    const r = await tiny.exec('echo hi > $(echo out.txt)')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })
})

describe('exec 은 절대 reject 하지 않는다 (trap 12)', () => {
  it('확장 도중 VfsError 가 터져도 rejected promise 대신 ExecResult 를 준다', async () => {
    const original = fs.readdir.bind(fs)
    fs.readdir = () => {
      throw new VfsError('EACCES', '/home/player')
    }
    try {
      const r = await sh.exec('echo *.txt')
      expect(r.exitCode).toBe(1)
      expect(r.stderr.length).toBeGreaterThan(0)
    } finally {
      fs.readdir = original
    }
  })
})

describe('위치 매개변수 (task 3) — run() 에 positional 을 직접 주입', () => {
  // docker: debian:stable-slim bash -c 'set -- a b c; echo $1 $#; echo "$*"; echo $@'
  //   => "a 3", "a b c", "a b c"
  function freshState(): ShellState {
    return { cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' }, lastExitCode: 0, home: '/home/player', functions: new Map(), arrays: new Map() }
  }

  it('$1 $2 가 인자로 치환된다', async () => {
    const r = await run('echo $1 $2', fs, freshState(), 100_000, ['a', 'b'])
    expect(r).toEqual({ stdout: 'a b\n', stderr: '', exitCode: 0 })
  })

  it('$# 는 위치 인자 개수', async () => {
    const r = await run('echo $#', fs, freshState(), 100_000, ['a', 'b', 'c'])
    expect(r.stdout).toBe('3\n')
  })

  it('"$*" 는 스페이스로 조인된 한 단어', async () => {
    const r = await run('echo "$*"', fs, freshState(), 100_000, ['a', 'b'])
    expect(r.stdout).toBe('a b\n')
  })

  it('$@ 는 따옴표 없이 쓰이면 인자별로 단어분할된다', async () => {
    const r = await run('echo $@', fs, freshState(), 100_000, ['x', 'y'])
    expect(r.stdout).toBe('x y\n')
  })

  it('${1}0 은 ${1} 확장 뒤 리터럴 0 이 그대로 이어붙는다', async () => {
    const r = await run('echo ${1}0', fs, freshState(), 100_000, ['7'])
    expect(r.stdout).toBe('70\n')
  })

  it('positional 이 빈 배열이면 $1 은 미설정 변수처럼 빈 문자열(단어가 사라져 빈 줄)', async () => {
    const r = await run('echo $1', fs, freshState(), 100_000, [])
    expect(r.stdout).toBe('\n')
  })

  it('positional 인자를 생략하면 기본값은 빈 배열 (5번째 인자는 선택)', async () => {
    const r = await run('echo [$1]', fs, freshState(), 100_000)
    expect(r.stdout).toBe('[]\n')
  })
})

describe('제어문 if (task 4, docker 로 확인됨)', () => {
  it('if COND(true); then BODY; fi 는 BODY 를 실행한다', async () => {
    expect(await sh.exec('if true; then echo yes; fi')).toEqual({ stdout: 'yes\n', stderr: '', exitCode: 0 })
  })

  it('if false; then ...; else ...; fi 는 else 를 실행한다', async () => {
    expect((await sh.exec('if false; then echo yes; else echo no; fi')).stdout).toBe('no\n')
  })

  it('elif 조건이 참이면 그 then 을 실행한다', async () => {
    expect((await sh.exec('if false; then :; elif true; then echo e; fi')).stdout).toBe('e\n')
  })

  it('조건이 거짓이고 else 가 없으면 아무것도 안 하고 exit 0', async () => {
    const r = await sh.exec('if false; then echo y; fi')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })

  it('가지 없이 끝난 if 뒤의 $? 는 0 이다', async () => {
    // docker: if false; then echo y; fi; echo after=$?  →  after=0
    expect((await sh.exec('if false; then echo y; fi; echo after=$?')).stdout).toBe('after=0\n')
  })

  it('조건 명령의 출력도 그대로 나온다', async () => {
    // docker: if echo cond; then echo body; fi  →  cond\nbody
    expect((await sh.exec('if echo cond; then echo body; fi')).stdout).toBe('cond\nbody\n')
  })

  it('then 안의 $? 는 조건의 exit code 를 본다', async () => {
    // docker: if true; then echo $?; fi → 0 ; if false; then :; else echo $?; fi → 1
    expect((await sh.exec('if true; then echo $?; fi')).stdout).toBe('0\n')
    expect((await sh.exec('if false; then :; else echo $?; fi')).stdout).toBe('1\n')
  })

  it('멀티라인 if 는 한 줄 세미콜론 버전과 동일하게 동작한다', async () => {
    const multi = await sh.exec('if true\nthen echo hi\nfi')
    const single = await sh.exec('if true; then echo hi; fi')
    expect(multi).toEqual(single)
    expect(multi.stdout).toBe('hi\n')
  })
})

describe('제어문 while / until (task 4, docker 로 확인됨)', () => {
  it('while 은 조건이 참인 동안 본문을 돈다 (파일 조건으로 종료)', async () => {
    // docker: touch flag; while [ -f flag ]; do echo x; rm flag; done  →  x (1회)
    expect((await sh.exec('touch flag; while [ -f flag ]; do echo x; rm flag; done')).stdout).toBe('x\n')
  })

  it('until 은 조건이 거짓인 동안 본문을 돈다', async () => {
    // docker: until [ -f flag ]; do touch flag; echo made; done  →  made (1회)
    expect((await sh.exec('until [ -f flag ]; do touch flag; echo made; done')).stdout).toBe('made\n')
  })

  it('조건이 처음부터 거짓이면 본문을 한 번도 안 돌고 exit 0', async () => {
    // docker: while false; do echo x; done; echo after=$?  →  after=0 (x 없음)
    const r = await sh.exec('while false; do echo x; done')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })

  it('무한 while 은 스텝 예산을 소진해 exit 130 + 실행 한도 초과', async () => {
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 50 })
    const r = await tiny.exec('while true; do :; done')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })
})

describe('산술 확장 $(( )) 통합 (task-1)', () => {
  it('카운터 루프가 산술로 종단한다 (헤드라인: 오늘까지 안 되던 것)', async () => {
    // docker: i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done  →  0 1 2
    const r = await run('i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done', fs, {
      cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' },
      lastExitCode: 0, home: '/home/player', functions: new Map(), arrays: new Map(),
    }, 100_000)
    expect(r.stdout).toBe('0\n1\n2\n')
    expect(r.exitCode).toBe(0)
  })

  it('명령 인자 자리의 산술', async () => {
    expect((await sh.exec('echo $((2**10))')).stdout).toBe('1024\n')
    expect((await sh.exec('echo $((10/3)) $(( (1+2)*3 ))')).stdout).toBe('3 9\n')
  })

  it('산술 대입이 셸 상태에 남는다', async () => {
    await sh.exec('x=5')
    expect((await sh.exec('echo $((x+=10))')).stdout).toBe('15\n')
    expect((await sh.exec('echo $x')).stdout).toBe('15\n')
  })

  it('0 나누기는 stderr + exit 1 로 surface (exec 은 reject 하지 않는다)', async () => {
    const r = await sh.exec('echo $((1/0))')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('division by 0')
    expect(r.stdout).toBe('')
  })
})

describe('산술 안 ${...}/$(...) 확장 (M3 Part 2 task 1, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('${#NAME} (docker: NAME=world; echo $(( ${#NAME} + 1 )) → 6)', async () => {
    const r = await sh.exec('NAME=world; echo $(( ${#NAME} + 1 ))')
    expect(r.stdout).toBe('6\n')
    expect(r.exitCode).toBe(0)
  })

  it('${x:-3} 기본값 (docker: unset x; echo $(( ${x:-3} * 2 )) → 6)', async () => {
    const r = await sh.exec('echo $(( ${x:-3} * 2 ))')
    expect(r.stdout).toBe('6\n')
    expect(r.exitCode).toBe(0)
  })

  it('$(...) 명령치환 (docker: echo $(( $(echo 5) + 1 )) → 6)', async () => {
    const r = await sh.exec('echo $(( $(echo 5) + 1 ))')
    expect(r.stdout).toBe('6\n')
    expect(r.exitCode).toBe(0)
  })

  it('회귀: n=${#NAME}; echo $((n+1)) 는 그대로 동작한다 (docker → 6)', async () => {
    const r = await sh.exec('NAME=world; n=${#NAME}; echo $((n+1))')
    expect(r.stdout).toBe('6\n')
  })

  it('역방향 회귀: ${x:-$((1+2))} (docker → 3)', async () => {
    const r = await sh.exec('echo ${x:-$((1+2))}')
    expect(r.stdout).toBe('3\n')
  })

  it('대입 부작용은 확장 후에도 셸 상태에 남는다 (docker: unset x y; echo $(( x = ${y:-0} + 1 )); echo $x → 1 / 1)', async () => {
    const r = await sh.exec('echo $(( x = ${y:-0} + 1 )); echo $x')
    expect(r.stdout).toBe('1\n1\n')
  })

  it('깨진 ${ 는 exec 을 reject 시키지 않고 exit 1 로 surface, 스크립트도 계속된다 (docker 확인: 해당 명령만 실패)', async () => {
    const r = await sh.exec('echo before; echo $(( ${ )); echo "mid=$?"; echo after')
    expect(r.stdout).toBe('before\nmid=1\nafter\n')
    expect(r.stderr).not.toBe('')
  })
})

describe('(( expr )) 산술 명령 (task-2, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('결과 ≠ 0 이면 참 → exit 0 (docker: (( 1+2 )); echo $? → 0)', async () => {
    const r = await sh.exec('(( 1 + 2 )); echo $?')
    expect(r.stdout).toBe('0\n')
  })

  it('결과 = 0 이면 거짓 → exit 1 (docker: (( 0 )); echo $? → 1)', async () => {
    const r = await sh.exec('(( 0 )); echo $?')
    expect(r.stdout).toBe('1\n')
  })

  it('비교 결과가 거짓이면 exit 1 (docker: (( 5 < 3 )); echo $? → 1)', async () => {
    const r = await sh.exec('(( 5 < 3 )); echo $?')
    expect(r.stdout).toBe('1\n')
  })

  it('비교 결과가 참이면 exit 0 (docker: (( 3 > 1 )); echo $? → 0)', async () => {
    const r = await sh.exec('(( 3 > 1 )); echo $?')
    expect(r.stdout).toBe('0\n')
  })

  it('후위 증감의 env 부작용이 셸 상태에 남는다 (docker: x=1; (( x++ )); echo $x → 2)', async () => {
    const r = await sh.exec('x=1; (( x++ )); echo $x')
    expect(r.stdout).toBe('2\n')
  })

  it('대입식의 env 부작용도 남는다 (docker: x=5; (( x = x * 2 )); echo $x → 10)', async () => {
    const r = await sh.exec('x=5; (( x = x * 2 )); echo $x')
    expect(r.stdout).toBe('10\n')
  })

  it('배경 버그 회귀: (( i < 5 )) 의 < 가 리다이렉트로 오인되지 않는다', async () => {
    const r = await sh.exec('i=2; (( i < 5 )); echo $?')
    expect(r.stdout).toBe('0\n')
  })

  it('0 나누기 등 산술 오류는 stderr + exit 1 로 surface (reject/hang 아님)', async () => {
    const r = await sh.exec('(( 1 / 0 )); echo $?')
    expect(r.stdout).toBe('1\n')
    expect(r.stderr).toContain('division by 0')
  })

  it('&& 로 다른 명령과 합성된다 (docker: (( 2 > 1 )) && echo yes → yes)', async () => {
    const r = await sh.exec('(( 2 > 1 )) && echo yes')
    expect(r.stdout).toBe('yes\n')
  })

  it('|| 는 참일 때 오른쪽을 건너뛴다', async () => {
    const r = await sh.exec('(( 1 )) || echo skip-me')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })

  it('회귀: 기존 리다이렉션(단일 ( 아님)은 영향받지 않는다', async () => {
    const r = await sh.exec('echo a > f; cat f')
    expect(r.stdout).toBe('a\n')
  })

  it('(M3 Part 2 task 1) ${...}/$(...) 는 (( )) 명령 안에서도 evalArith 전에 확장된다 (docker: NAME=world; (( ${#NAME} == 5 )); echo $? → 0)', async () => {
    const r = await sh.exec('NAME=world; (( ${#NAME} == 5 )); echo $?')
    expect(r.stdout).toBe('0\n')
  })

  it('(M3 Part 2 task 1) 대입 부작용이 확장 후에도 셸 상태에 남는다 (docker: unset x y; (( x = ${y:-0} + 1 )); echo $x → 1)', async () => {
    const r = await sh.exec('(( x = ${y:-0} + 1 )); echo $x')
    expect(r.stdout).toBe('1\n')
  })

  it('(M3 Part 2 task 1) 깨진 ${ 는 exec 을 reject 시키지 않고 exit 1 로 surface, 스크립트도 계속된다', async () => {
    const r = await sh.exec('echo before; (( ${ )); echo "mid=$?"; echo after')
    expect(r.stdout).toBe('before\nmid=1\nafter\n')
    expect(r.stderr).not.toBe('')
  })
})

describe('제어문 break / continue (task 4, docker 로 확인됨)', () => {
  it('break 은 가장 안쪽 루프를 즉시 끝낸다 (break 직전 출력은 보존)', async () => {
    // docker: while true; do echo x; break; done  →  x, exit 0
    const r = await sh.exec('while true; do echo x; break; done')
    expect(r.stdout).toBe('x\n')
    expect(r.exitCode).toBe(0)
  })

  it('continue 는 본문의 나머지를 건너뛰고 다음 반복으로 간다', async () => {
    // docker: touch a; while [ -f a ]; do echo before; rm a; continue; echo after; done  →  before
    expect((await sh.exec('touch a; while [ -f a ]; do echo before; rm a; continue; echo after; done')).stdout).toBe('before\n')
  })

  it('break 2 는 두 겹의 루프를 함께 벗어난다', async () => {
    // docker: while true; do while true; do echo inner; break 2; done; echo outer; done; echo done → inner\ndone
    const r = await sh.exec('while true; do while true; do echo inner; break 2; done; echo outer; done; echo done')
    expect(r.stdout).toBe('inner\ndone\n')
    expect(r.exitCode).toBe(0)
  })

  it('루프 밖의 break 은 무해한 no-op 이고 리스트의 나머지는 계속 실행된다', async () => {
    // docker: break; echo after → (stderr 경고) after, exit 0
    const r = await sh.exec('break; echo after')
    expect(r.stdout).toBe('after\n')
    expect(r.exitCode).toBe(0)
  })
})

describe('제어문 for (task 5, docker 로 확인됨)', () => {
  it('for 는 단어 목록을 순서대로 var 에 대입하며 body 를 돈다', async () => {
    // docker: for x in a b c; do echo $x; done  →  a\nb\nc
    expect((await sh.exec('for x in a b c; do echo $x; done')).stdout).toBe('a\nb\nc\n')
  })

  it('단어 목록은 글롭으로 펼쳐진다 (사전순 정렬)', async () => {
    // docker: touch a.txt b.txt; for f in *.txt; do echo $f; done  →  a.txt\nb.txt
    const r = await sh.exec('touch a.txt b.txt; for f in *.txt; do echo $f; done')
    expect(r.stdout).toBe('a.txt\nb.txt\n')
  })

  it('단어 목록은 변수 확장 뒤 단어분리된다', async () => {
    // docker: x='p q'; for i in $x; do echo $i; done  →  p\nq
    expect((await sh.exec("x='p q'; for i in $x; do echo $i; done")).stdout).toBe('p\nq\n')
  })

  it('빈 목록이면 body 를 한 번도 안 돌고 exit 0', async () => {
    // docker: for x in; do echo $x; done  →  (출력 없음), exit 0
    const r = await sh.exec('for x in; do echo $x; done')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })

  it('break 은 for 루프를 즉시 끝낸다', async () => {
    // docker: for x in a b c; do echo $x; break; done  →  a
    const r = await sh.exec('for x in a b c; do echo $x; break; done')
    expect(r.stdout).toBe('a\n')
    expect(r.exitCode).toBe(0)
  })

  it('continue 는 다음 값으로 건너뛴다', async () => {
    // docker: for x in a b c; do if [ $x = b ]; then continue; fi; echo $x; done  →  a\nc
    const r = await sh.exec('for x in a b c; do if [ $x = b ]; then continue; fi; echo $x; done')
    expect(r.stdout).toBe('a\nc\n')
  })

  it('루프 변수는 루프가 끝난 뒤에도 마지막 값으로 남는다', async () => {
    // docker: for x in a b; do :; done; echo $x  →  b
    const r = await sh.exec('for x in a b; do :; done; echo $x')
    expect(r.stdout).toBe('b\n')
  })

  it('중첩 for 는 안쪽/바깥쪽 변수를 독립적으로 순회한다', async () => {
    // docker: for x in 1 2; do for y in a b; do echo $x$y; done; done  →  1a\n1b\n2a\n2b
    const r = await sh.exec('for x in 1 2; do for y in a b; do echo $x$y; done; done')
    expect(r.stdout).toBe('1a\n1b\n2a\n2b\n')
  })
})

describe('do/then/else/in 뒤 개행 (newline_list) 허용 — 실행 동작 (task 5b, docker 로 확인됨)', () => {
  // 렉서는 개행을 무조건 ;로 접기 때문에(task 1), do/then/else/in 바로 뒤의 개행이
  // ;로 둔갑해 본문 parseList가 선행 ;를 문법 오류로 거부했었다. 이 태스크는 이 스캐폴딩
  // 한계를 parser.ts의 skipSeparators()로 고친다 — 아래는 그 전엔 syntax error 였던
  // 이디엄적인 멀티라인 형태가 한 줄 세미콜론 버전과 동일하게 실행됨을 확인한다.
  it('멀티라인 for 본문은 세미콜론 버전과 같은 출력을 낸다 (docker: a\\nb)', async () => {
    const r = await sh.exec('for f in a b; do\necho $f\ndone')
    expect(r.stdout).toBe('a\nb\n')
    expect(r.exitCode).toBe(0)
  })

  it('멀티라인 while 본문은 세미콜론 버전과 같은 출력을 낸다 (docker: x)', async () => {
    const r = await sh.exec('while true; do\necho x\nbreak\ndone')
    expect(r.stdout).toBe('x\n')
    expect(r.exitCode).toBe(0)
  })

  it('멀티라인 if 본문은 세미콜론 버전과 같은 출력을 낸다 (docker: hi)', async () => {
    const r = await sh.exec('if true; then\necho hi\nfi')
    expect(r.stdout).toBe('hi\n')
    expect(r.exitCode).toBe(0)
  })

  it('멀티라인 if/else 본문은 세미콜론 버전과 같은 출력을 낸다 (docker: no)', async () => {
    const r = await sh.exec('if false; then\n:\nelse\necho no\nfi')
    expect(r.stdout).toBe('no\n')
    expect(r.exitCode).toBe(0)
  })

  it('in 뒤 개행도 관대히 허용한다 (실제 bash는 여기서 문법 오류지만, 의도된 관대한 확장): a\\nb', async () => {
    const r = await sh.exec('for f in\na b\ndo\necho $f\ndone')
    expect(r.stdout).toBe('a\nb\n')
    expect(r.exitCode).toBe(0)
  })

  it('회귀: for x in; do echo empty; done (빈 목록)은 여전히 출력 없이 exit 0', async () => {
    const r = await sh.exec('for x in; do echo empty; done')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })

  it('중첩: while 본문과 안쪽 if 본문이 모두 다음 줄에 있어도 실행된다 (docker: done)', async () => {
    // docker: touch f; while true; do\nif [ -f f ]; then\nbreak\nfi\ndone; echo done  →  done
    fs.writeFile('/home/player/nlflag', '')
    const r = await sh.exec('while true; do\nif [ -f nlflag ]; then\nbreak\nfi\ndone\necho done')
    expect(r.stdout).toBe('done\n')
    expect(r.exitCode).toBe(0)
  })

  it('회귀: 모든 한 줄짜리 세미콜론 형태는 그대로 동작한다', async () => {
    expect((await sh.exec('for x in a b c; do echo $x; done')).stdout).toBe('a\nb\nc\n')
    expect((await sh.exec('while false; do echo x; done')).stdout).toBe('')
    expect((await sh.exec('if true; then echo yes; fi')).stdout).toBe('yes\n')
  })
})

describe('제어문 case (task 6, docker 로 확인됨)', () => {
  it('첫 매치 branch 의 body 를 실행한다', async () => {
    // docker: case hi in h*) echo H;; *) echo other;; esac  →  H
    expect((await sh.exec('case hi in h*) echo H;; *) echo other;; esac')).stdout).toBe('H\n')
  })

  it('매치되는 branch 가 없으면 출력 없이 exit 0', async () => {
    // docker: case foo in a) echo a;; b) echo b;; esac  →  (출력 없음)
    const r = await sh.exec('case foo in a) echo a;; b) echo b;; esac')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })

  it('`|` 로 이어진 alternation 은 어느 한쪽만 맞아도 매치한다', async () => {
    // docker: case cat in cat|dog) echo pet;; esac  →  pet
    expect((await sh.exec('case cat in cat|dog) echo pet;; esac')).stdout).toBe('pet\n')
  })

  it('dotglob: `*` 가 선행 점에도 걸린다(경로명 글롭과 다르다)', async () => {
    // docker: case .x in *) echo star;; esac  →  star (경로명 글롭이면 안 걸렸을 것)
    expect((await sh.exec('case .x in *) echo star;; esac')).stdout).toBe('star\n')
  })

  it('`?` 는 글자 하나에 매치한다', async () => {
    // docker: case abc in a?c) echo q;; esac  →  q
    expect((await sh.exec('case abc in a?c) echo q;; esac')).stdout).toBe('q\n')
  })

  it('WORD 는 변수 확장 후 문자열 하나로 매치한다', async () => {
    // docker: x=dog; case $x in cat) echo c;; dog) echo d;; esac  →  d
    expect((await sh.exec('x=dog; case $x in cat) echo c;; dog) echo d;; esac')).stdout).toBe('d\n')
  })

  it('catch-all `*)` 은 마지막 안전망으로 동작한다', async () => {
    // docker: case zzz in a) :;; *) echo default;; esac  →  default
    expect((await sh.exec('case zzz in a) :;; *) echo default;; esac')).stdout).toBe('default\n')
  })

  it('멀티라인(패턴/본문/;;가 각각 다른 줄)도 한 줄 버전과 동일하게 동작한다', async () => {
    // docker: case hi in\n  h*)\n    echo H\n    ;;\nesac  →  H
    const r = await sh.exec('case hi in\n  h*)\n    echo H\n    ;;\nesac')
    expect(r.stdout).toBe('H\n')
    expect(r.exitCode).toBe(0)
  })

  it('마지막 branch 의 `;;` 는 생략 가능하다(단일 `;` 로 esac 직전 종료해도 동일 결과)', async () => {
    // docker: case hi in h*) echo H;; esac → H ; case hi in h*) echo H; esac → H (동일)
    const withDoubleSemi = await sh.exec('case hi in h*) echo H;; esac')
    const withSingleSemi = await sh.exec('case hi in h*) echo H; esac')
    expect(withSingleSemi).toEqual(withDoubleSemi)
    expect(withSingleSemi.stdout).toBe('H\n')
  })

  it('여는 `(` 는 선택적이고 결과에 영향 없다', async () => {
    // docker: case hi in (h*) echo H;; esac → H
    expect((await sh.exec('case hi in (h*) echo H;; esac')).stdout).toBe('H\n')
  })

  it('첫 매치에서 멈춘다 — fallthrough 없음(뒤 branch 는 실행되지 않는다)', async () => {
    const r = await sh.exec('case a in a) echo first;; a) echo second;; esac')
    expect(r.stdout).toBe('first\n')
  })

  it('break/continue 는 바깥 루프까지 case 를 뚫고 전달된다', async () => {
    // docker: for x in a b c; do case $x in b) continue;; esac; echo $x; done  →  a\nc
    const r1 = await sh.exec('for x in a b c; do case $x in b) continue;; esac; echo $x; done')
    expect(r1.stdout).toBe('a\nc\n')
    // docker: while true; do case yes in yes) break;; esac; echo unreachable; done; echo after → after
    const r2 = await sh.exec('while true; do case yes in yes) break;; esac; echo unreachable; done; echo after')
    expect(r2.stdout).toBe('after\n')
  })

  it('branch 가 없어도(case WORD in esac) exit 0', async () => {
    // docker: case hi in esac; echo ok=$?  →  ok=0
    expect((await sh.exec('case hi in esac')).exitCode).toBe(0)
  })

  it('빈 body 도 허용한다: h*) ;; esac', async () => {
    // docker: case hi in h*) ;; esac; echo ok=$?  →  ok=0
    const r = await sh.exec('case hi in h*) ;; esac')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })
})

describe('registry 통합 — cat 이 등록되어 있다', () => {
  it('cat 으로 파일을 이어붙인다', async () => {
    expect((await sh.exec('cat a.txt b.txt')).stdout).toBe('alpha\nbeta\n')
  })

  it('없는 파일은 stderr 에 메시지, exit 1, 다른 파일은 계속 출력된다', async () => {
    const r = await sh.exec('cat a.txt nope.txt a.txt')
    expect(r.stdout).toBe('alpha\nalpha\n')
    expect(r.stderr).toBe('cat: nope.txt: No such file or directory\n')
    expect(r.exitCode).toBe(1)
  })

  it('cat -n 은 6칸 우측정렬 + 탭으로 번호를 매기고, 여러 파일에 걸쳐 이어진다', async () => {
    fs.writeFile('/home/player/n1.txt', 'a\nb\n')
    fs.writeFile('/home/player/n2.txt', 'c\nd\n')
    const r = await sh.exec('cat -n n1.txt n2.txt')
    expect(r.stdout).toBe('     1\ta\n     2\tb\n     3\tc\n     4\td\n')
  })

  it('cat -n 은 원본에 마지막 개행이 없으면 만들어 붙이지 않는다 (docker 확인됨)', async () => {
    fs.writeFile('/home/player/nonl.txt', 'a\nb')
    const r = await sh.exec('cat -n nonl.txt')
    expect(r.stdout).toBe('     1\ta\n     2\tb')
  })

  it('cat -n 은 개행 없이 끝난 파일 뒤에 다음 파일이 바로 이어붙는 실제 바이트 스트림 기준으로 번호를 매긴다', async () => {
    // docker: printf "a\nb" > f1; printf "c\nd\n" > f2; cat -n f1 f2
    //   →  "     1\ta\n     2\tbc\n     3\td\n" (b와 c가 한 줄로 이어붙는다)
    fs.writeFile('/home/player/f1.txt', 'a\nb')
    fs.writeFile('/home/player/f2.txt', 'c\nd\n')
    const r = await sh.exec('cat -n f1.txt f2.txt')
    expect(r.stdout).toBe('     1\ta\n     2\tbc\n     3\td\n')
  })

  it('cat 은 파일 인자가 없으면 stdin 을 읽는다', async () => {
    expect((await sh.exec('echo hi | cat')).stdout).toBe('hi\n')
  })
})

describe('함수 / 브레이스 그룹 / return (task 7, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('함수 정의 후 호출: 위치인자가 $1 로 전달된다', async () => {
    // docker: greet() { echo hi $1; }; greet bob → hi bob
    expect((await sh.exec('greet() { echo hi $1; }; greet bob')).stdout).toBe('hi bob\n')
  })

  it('return N 은 함수의 exit code 가 된다', async () => {
    // docker: f() { return 3; }; f; echo $? → 3
    expect((await sh.exec('f() { return 3; }; f; echo $?')).stdout).toBe('3\n')
  })

  it('return 은 본문의 나머지를 건너뛴다 (return 뒤 명령은 안 돈다)', async () => {
    // docker: f() { echo x; return; echo y; }; f → x (y 없음)
    expect((await sh.exec('f() { echo x; return; echo y; }; f')).stdout).toBe('x\n')
  })

  it('echo 뒤 return 은 그 echo 출력을 보존하고 exit code 를 싣는다', async () => {
    // docker: f() { echo x; return 2; echo y; }; f; echo end=$? → x\nend=2
    expect((await sh.exec('f() { echo x; return 2; echo y; }; f; echo end=$?')).stdout).toBe('x\nend=2\n')
  })

  it('return 무인자는 함수 본문 마지막 명령의 exit code 를 쓴다', async () => {
    // docker: f() { false; return; }; f; echo $? → 1
    expect((await sh.exec('f() { false; return; }; f; echo $?')).stdout).toBe('1\n')
  })

  it('return 코드는 0..255 로 감싼다', async () => {
    // docker: return 300 → 44, return -1 → 255
    expect((await sh.exec('f() { return 300; }; f; echo $?')).stdout).toBe('44\n')
    expect((await sh.exec('g() { return -1; }; g; echo $?')).stdout).toBe('255\n')
  })

  it('함수는 새 env 를 안 뜬다 — 함수 안의 대입이 호출자에게 남는다', async () => {
    // docker: setx() { x=5; }; setx; echo $x → 5
    expect((await sh.exec('setx() { x=5; }; setx; echo $x')).stdout).toBe('5\n')
  })

  it('위치인자는 호출 동안만 바뀌고 끝나면 복원된다', async () => {
    // docker: f() { echo $1; }; f a; echo done$1 → a\ndone (밖 $1 은 빈 문자열)
    expect((await sh.exec('f() { echo $1; }; f a; echo done$1')).stdout).toBe('a\ndone\n')
  })

  it('중첩 함수: 안쪽 호출이 자기 $1 을 보고, 바깥 $1 은 복원된다', async () => {
    // docker: outer() { inner() { echo $1; }; inner z; echo $1; }; outer q → z\nq
    expect((await sh.exec('outer() { inner() { echo $1; }; inner z; echo $1; }; outer q')).stdout).toBe('z\nq\n')
  })

  it('함수 안에서 정의한 함수는 전역이라 호출 후에도 보인다', async () => {
    // docker: f() { g() { echo inner; }; }; f; g → inner
    expect((await sh.exec('f() { g() { echo inner; }; }; f; g')).stdout).toBe('inner\n')
  })

  it('함수는 exec() 호출을 넘어 산다 — REPL 에서 한 줄 정의, 다음 Enter 에 호출 (task 11b)', async () => {
    // 게임의 인터랙티브 REPL 은 Enter 한 번 = Shell.exec() 한 번. 실제 bash 는 정의와
    // 호출이 서로 다른 줄(별도 REPL 입력)이어도 함수가 살아있다 — docker: 대화형 bash
    // 세션에서 `greet() { echo hi; }` 입력 후 Enter, 그다음 `greet` 입력 후 Enter → hi.
    // (env/cwd 는 이미 exec 호출을 넘어 남는다 — 위 '상태 유지' 스위트 참고. 함수도
    // 같아야 한다: ShellState.functions 가 createShell 클로저에서 exec 을 넘어 산다.)
    await sh.exec('greet() { echo hi; }')
    const r = await sh.exec('greet')
    expect(r).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 })
  })

  it('셸 인스턴스가 다르면 함수를 공유하지 않는다 (createShell 마다 독립된 functions 맵)', async () => {
    await sh.exec('greet() { echo hi; }')
    const other = createShell({ fs, cwd: '/home/player', home: '/home/player' })
    const r = await other.exec('greet')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toBe('bash: greet: command not found\n')
  })

  it('function 예약어 형태 (괄호 없이)', async () => {
    // docker: function hi { echo yo; }; hi → yo
    expect((await sh.exec('function hi { echo yo; }; hi')).stdout).toBe('yo\n')
  })

  it('function 예약어 + 괄호 형태', async () => {
    // docker: function greet() { echo hi; }; greet → hi
    expect((await sh.exec('function greet() { echo hi; }; greet')).stdout).toBe('hi\n')
  })

  it('NAME () (이름과 () 사이 공백) 형태', async () => {
    // docker: greet ()  { echo spaced; }; greet → spaced
    expect((await sh.exec('greet ()  { echo spaced; }; greet')).stdout).toBe('spaced\n')
  })

  it('NAME( ) (괄호 사이 공백) 형태', async () => {
    // docker: greet( ) { echo p1; }; greet → p1
    expect((await sh.exec('greet( ) { echo p1; }; greet')).stdout).toBe('p1\n')
  })

  it('멀티라인 함수 정의', async () => {
    const r = await sh.exec('f() {\n  echo one\n  echo two\n}\nf')
    expect(r.stdout).toBe('one\ntwo\n')
  })

  it('함수는 동명의 coreutil/빌트인을 가린다 (bash 우선순위)', async () => {
    // docker: ls() { echo faked; }; ls → faked
    expect((await sh.exec('ls() { echo faked; }; ls')).stdout).toBe('faked\n')
  })

  it('브레이스 그룹은 LIST 를 순서대로 실행한다', async () => {
    // docker: { echo a; echo b; } → a\nb
    expect((await sh.exec('{ echo a; echo b; }')).stdout).toBe('a\nb\n')
  })

  it('브레이스 그룹은 서브셸이 아니라 현재 env 를 공유한다', async () => {
    // docker: { x=7; }; echo $x → 7
    expect((await sh.exec('{ x=7; }; echo $x')).stdout).toBe('7\n')
    // docker: x=1; { x=2; y=3; }; echo $x $y → 2 3
    expect((await sh.exec('x=1; { x=2; y=3; }; echo $x $y')).stdout).toBe('2 3\n')
  })

  it('return 은 (함수 안) 브레이스 그룹을 뚫고 함수 전체를 벗어난다', async () => {
    // docker: f() { echo a; { echo b; return; echo c; }; echo d; }; f → a\nb
    expect((await sh.exec('f() { echo a; { echo b; return; echo c; }; echo d; }; f')).stdout).toBe('a\nb\n')
  })

  it('함수 밖 return 은 경고만 내고 리스트는 계속 진행한다 (exit 은 다음 명령이 결정)', async () => {
    // docker: return 2; echo after → (stderr 경고) after, exit 0
    const r = await sh.exec('return 2; echo after')
    expect(r.stdout).toBe('after\n')
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain("can only `return'")
  })

  it('함수 밖 return 단독은 exit 2 (bash 확인)', async () => {
    // docker: return 5 → 경고, exit 2
    const r = await sh.exec('return 5')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("can only `return'")
  })

  it('{ echo } (구분자 없음) 는 문법 오류다 (bash 도 unexpected EOF)', async () => {
    const r = await sh.exec('{ echo }')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/syntax error/)
  })

  it('컴팩트 f(){ echo hi; }; f (공백 없이) 도 정의·호출된다 (task 2 토큰화)', async () => {
    // docker: f(){ echo hi; }; f → hi
    expect((await sh.exec('f(){ echo hi; }; f')).stdout).toBe('hi\n')
  })

  it('컴팩트 f(){ 는 위치인자도 정상 전달한다', async () => {
    // docker: greet(){ echo hi $1; }; greet bob → hi bob
    expect((await sh.exec('greet(){ echo hi $1; }; greet bob')).stdout).toBe('hi bob\n')
  })

  it('{echo hi; } (여는 { 뒤 공백 없음) 는 그룹이 아니라 명령이라 command not found', async () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c '{echo hi; }'
    //   => syntax error near unexpected token `}' (bash 는 `{echo` 를 명령으로 본다)
    // 우리는 `{echo` 를 명령 이름으로 실행 → command not found (JS 크래시가 아니라 얌전한 실패).
    const r = await sh.exec('{echo hi; }')
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout).toBe('')
  })
})

// 선행 subshell `( )` 는 Task 3(SubshellNode) 범위 — 여기서는 토큰화만 하고 파서 규칙이 없어
// 얌전한 문법 오류로 끝난다(exec 는 절대 크래시하지 않는다). 기존에도 동작하지 않던 형태다.
describe('( list ) 서브셸: 격리된 childCtx (task 3, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('기본: LIST 를 순서대로 실행하고 출력을 그대로 낸다', async () => {
    // docker: ( echo a; echo b ) → a\nb
    expect((await sh.exec('( echo a; echo b )')).stdout).toBe('a\nb\n')
  })

  it('cwd 는 격리된다 — 서브셸 안의 cd 는 밖으로 안 샌다', async () => {
    // docker: cd /tmp; (cd /; echo $PWD); echo $PWD → 안 `/`, 밖 `/tmp`
    const sh2 = createShell({ fs, cwd: '/home/player', home: '/home/player' })
    const r = await sh2.exec('(cd /; echo $PWD); echo $PWD')
    expect(r.stdout).toBe('/\n/home/player\n')
  })

  it('env 는 격리된다 — 서브셸 안의 대입은 밖으로 안 샌다', async () => {
    // docker: (x=5); echo "[$x]" → []
    const r = await sh.exec('(x=5); echo "[$x]"')
    expect(r.stdout).toBe('[]\n')
  })

  it('fs 는 공유된다 — 서브셸 안의 파일시스템 변경은 부작용으로 남는다', async () => {
    // docker: (mkdir sub); ls → sub 가 존재
    const r = await sh.exec('(mkdir sub); ls')
    expect(r.stdout).toContain('sub')
    expect(fs.exists(fs.resolve('sub', '/home/player'))).toBe(true)
  })

  it('exit code 는 서브셸의 마지막 명령 것을 그대로 전파한다', async () => {
    // docker: (false); echo $? → 1 / (true); echo $? → 0
    expect((await sh.exec('(false); echo $?')).stdout).toBe('1\n')
    expect((await sh.exec('(true); echo $?')).stdout).toBe('0\n')
  })

  it('exit code 전파 + 서브셸 출력이 함께 보존된다', async () => {
    // docker: (echo a; false); echo $? → a\n1
    const r = await sh.exec('(echo a; false); echo $?')
    expect(r.stdout).toBe('a\n1\n')
  })

  it('함수 정의는 서브셸 안에서 부모 함수를 상속하되, 서브셸 안 정의는 밖으로 안 샌다', async () => {
    // docker: f(){ echo hi; }; ( f; g(){ echo g; }; g ); g
    //   → hi \n g \n bash: line 16: g: command not found (마지막 g 는 command not found)
    const r = await sh.exec('f(){ echo hi; }; ( f; g(){ echo g; }; g ); g')
    expect(r.stdout).toBe('hi\ng\n')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toContain('g: command not found')
  })

  it('중첩 서브셸: ( ( echo x ) ) 는 그대로 x 를 낸다', async () => {
    // docker: ( ( echo x ) ) → x
    expect((await sh.exec('( ( echo x ) )')).stdout).toBe('x\n')
  })

  it('중첩 서브셸 + 순차 명령: ( echo a; ( echo b ) ) → a\\nb', async () => {
    // docker: ( echo a; ( echo b ) ) → a\nb
    expect((await sh.exec('( echo a; ( echo b ) )')).stdout).toBe('a\nb\n')
  })

  it('예산은 공유된다 — 서브셸 안의 무한루프도 공유 예산에 걸려 종료한다(hang/crash 아님)', async () => {
    // docker 로는 확인 불가(무한 루프라 절대 안 끝남) — 엔진의 무한루프 방어(step budget)가
    // 서브셸 경계를 넘어 계속 같은 카운터를 깎는지가 이 테스트의 요점이다. childCtx 가
    // budget 객체(참조)를 그대로 공유하므로(fs 와 같은 원리), 서브셸 안 while 의 매 반복
    // spend(ctx) 가 부모/자식 구분 없이 같은 remaining 을 소진시킨다.
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 50 })
    const r = await tiny.exec('( while true; do :; done )')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })

  it('파이프: echo hi | (cat) — 서브셸이 파이프라인의 stdin 을 받는다', async () => {
    // docker: echo hi | (cat) → hi
    expect((await sh.exec('echo hi | (cat)')).stdout).toBe('hi\n')
  })

  it('파이프: 여러 줄 stdin 도 서브셸 첫 명령으로 그대로 전달된다', async () => {
    // docker: printf 'a\nb\n' | (cat) → a\nb (printf 빌트인이 이 엔진엔 없어 echo -e 로
    // 같은 다줄 stdin 을 재현한다 — echo -e 는 이미 구현돼 있다, builtins/echo.ts)
    expect((await sh.exec('echo -e "a\\nb" | (cat)')).stdout).toBe('a\nb\n')
  })

  it('닫는 )가 없는 미완성 서브셸은 얌전한 문법 오류(nonzero)로 끝나고 exec 를 리젝트하지 않는다', async () => {
    const sh2 = createShell({ fs, cwd: '/home/player', home: '/home/player' })
    const r = await sh2.exec('( echo sub')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/syntax error/)
  })

  it('exit 빌트인이 없어 (exit 3) 은 command not found — 서브셸 자체의 결함이 아니다', async () => {
    // 이 엔진엔 exit 빌트인이 없다(브리프 note). (exit 3) 은 "exit" 를 명령으로 찾다가
    // 실패해 127 이 된다 — 서브셸의 exit-code 전파 자체는 위 false/true 테스트로 이미
    // 검증했다(핵심 시맨틱), 이건 그 사실을 명시적으로 남겨두는 문서화용 테스트다.
    const r = await sh.exec('(exit 3); echo $?')
    expect(r.stdout).toBe('127\n')
  })
})

describe('$(...) 명령치환: 함수 정의도 격리된다 (M3 Part 2 fix, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('$(...) 안에서 정의한 함수는 바깥으로 안 샌다', async () => {
    // docker: echo $(g(){ echo g;}; g); g
    //   → g \n bash: line 1: g: command not found (exit 127)
    const r = await sh.exec('echo $(g(){ echo g;}; g); g')
    expect(r.stdout).toBe('g\n')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toContain('g: command not found')
  })

  it('$(...) 안 정의는 같은 이름의 바깥 함수를 덮어쓰지 않는다', async () => {
    // docker: g(){ echo outer; }; echo $(g(){ echo inner;}; g); g → inner\nouter
    const r = await sh.exec('g(){ echo outer; }; echo $(g(){ echo inner;}; g); g')
    expect(r.stdout).toBe('inner\nouter\n')
  })
})

describe('함수 재정의 / break·continue 함수 경계 / 무한재귀 방어 (task 2/7 정리, docker 로 확인됨)', () => {
  it('무한 재귀 함수는 스텝 예산을 소진해 exit 130 이지, JS 크래시가 아니다', async () => {
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 5000 })
    const r = await tiny.exec('f() { f; }; f')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })

  it('함수 재정의는 최신 정의로 덮어쓴다', async () => {
    // docker: f() { echo one; }; f() { echo two; }; f → two
    expect((await sh.exec('f() { echo one; }; f() { echo two; }; f')).stdout).toBe('two\n')
  })

  it('함수 안 루프의 break 는 그 루프만 벗어나고 함수는 정상 반환한다', async () => {
    // docker: f() { for i in a b c; do echo $i; break; done; echo end; }; f → a\nend
    expect((await sh.exec('f() { for i in a b c; do echo $i; break; done; echo end; }; f')).stdout).toBe('a\nend\n')
  })

  // 함수 호출은 루프-문맥 경계다: 함수 안의 break/continue 는 호출자의 루프에 닿을 수 없다.
  // (아래 명령은 reviewer 가 `f(){…}` 무공백 형태로 bash 확인 — 우리 렉서는 `f() {…}`
  // 스페이싱을 파싱하고 bash 출력은 두 형태가 동일함을 docker 로 재확인했다.)
  it('함수 안의 bare break 는 호출자의 루프를 건드리지 않는다 (경고+no-op)', async () => {
    // docker: f() { break; }; for i in a b c; do echo $i; f; done; echo end → a\nb\nc\nend
    const r = await sh.exec('f() { break; }; for i in a b c; do echo $i; f; done; echo end')
    expect(r.stdout).toBe('a\nb\nc\nend\n')
    expect(r.stderr).toContain('only meaningful in a')
  })

  it('함수 안의 bare continue 는 호출자의 루프를 건드리지 않는다', async () => {
    // docker: f() { continue; }; for i in a b c; do echo $i; f; echo tail$i; done
    //   → a\ntaila\nb\ntailb\nc\ntailc (tail 이 안 잘린다)
    const r = await sh.exec('f() { continue; }; for i in a b c; do echo $i; f; echo tail$i; done')
    expect(r.stdout).toBe('a\ntaila\nb\ntailb\nc\ntailc\n')
  })

  it('함수 안 루프의 break 2 도 함수 경계까지만이라 호출자 루프에 닿지 않는다', async () => {
    // docker: inner() { for j in x y; do echo $j; break 2; done; }; for i in a b; do echo i$i; inner; done; echo end
    //   → ia\nx\nib\nx\nend (호출자 for 는 a,b 모두 돈다)
    const r = await sh.exec('inner() { for j in x y; do echo $j; break 2; done; }; for i in a b; do echo i$i; inner; done; echo end')
    expect(r.stdout).toBe('ia\nx\nib\nx\nend\n')
  })

  it('함수 자신의 루프 안 break 는 0 부터 세므로 그 루프에만 갇힌다 (호출마다 초기화)', async () => {
    // docker: f() { for k in p q r; do echo $k; break; done; echo aftr; }; for i in a b; do echo i$i; f; done; echo end
    //   → ia\np\naftr\nib\np\naftr\nend
    const r = await sh.exec('f() { for k in p q r; do echo $k; break; done; echo aftr; }; for i in a b; do echo i$i; f; done; echo end')
    expect(r.stdout).toBe('ia\np\naftr\nib\np\naftr\nend\n')
  })
})

describe('source / . (task 8, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('ARGS 가 $1.. 로 전달되고, 대입은 호출자에 남는다 (멀티라인 스크립트)', async () => {
    // docker: printf "x=5\ny=$1\n" > conf.sh; source conf.sh arg1; echo $x $y → 5 arg1
    fs.writeFile('/home/player/conf.sh', 'x=5\ny=$1\n')
    expect((await sh.exec('source conf.sh arg1; echo $x $y')).stdout).toBe('5 arg1\n')
  })

  it('. (dot) 형태도 동일하게 동작한다', async () => {
    fs.writeFile('/home/player/conf.sh', 'x=5\ny=$1\n')
    expect((await sh.exec('. conf.sh arg1; echo $x $y')).stdout).toBe('5 arg1\n')
  })

  it('함수 정의가 호출자에 로드된다', async () => {
    // docker: printf "hello() { echo hi; }\n" > lib.sh; source lib.sh; hello → hi
    fs.writeFile('/home/player/lib.sh', 'hello() { echo hi; }\n')
    expect((await sh.exec('source lib.sh; hello')).stdout).toBe('hi\n')
  })

  it('없는 파일은 exit 1, "bash: FILE: No such file or directory" (source:/​.: 라벨 없음 — docker 재확인)', async () => {
    // docker: source nope.sh / . nope.sh → 둘 다 "bash: line N: nope.sh: No such file or
    // directory"(라벨 없음, line N 은 우리 엔진이 줄번호를 추적하지 않아 생략)
    const r1 = await sh.exec('source nope.sh')
    expect(r1.exitCode).toBe(1)
    expect(r1.stderr).toBe('bash: nope.sh: No such file or directory\n')

    const r2 = await sh.exec('. nope.sh')
    expect(r2.exitCode).toBe(1)
    expect(r2.stderr).toBe('bash: nope.sh: No such file or directory\n')
  })

  it('인자 없이 부르면 "filename argument required" + usage, exit 2', async () => {
    // docker: source → bash: source: filename argument required / source: usage: source filename [arguments], exit 2
    const r1 = await sh.exec('source')
    expect(r1.exitCode).toBe(2)
    expect(r1.stderr).toBe('bash: source: filename argument required\nsource: usage: source filename [arguments]\n')

    // docker: . → bash: .: filename argument required / .: usage: . filename [arguments], exit 2
    const r2 = await sh.exec('.')
    expect(r2.exitCode).toBe(2)
    expect(r2.stderr).toBe('bash: .: filename argument required\n.: usage: . filename [arguments]\n')
  })

  it('return 은 source 만 벗어난다 — 이후 명령은 안 돈다, exit code 는 return 값', async () => {
    // docker: printf "echo a\nreturn 3\necho b\n" > r.sh; source r.sh; echo $? → a\n3 (b 없음)
    fs.writeFile('/home/player/r.sh', 'echo a\nreturn 3\necho b\n')
    const r = await sh.exec('source r.sh; echo $?')
    expect(r.stdout).toBe('a\n3\n')
  })

  it('source 의 return 경계는 함수 경계와 별개다 — 함수 안에서 source 해도 함수는 계속 돈다', async () => {
    // docker: f() { source deep.sh; echo afterSource=$?; return 1; }; f; echo outerExit=$?
    //   (deep.sh = echo insrc\nreturn 9\necho neverseen\n) → insrc\nafterSource=9\nouterExit=1
    fs.writeFile('/home/player/deep.sh', 'echo insrc\nreturn 9\necho neverseen\n')
    const r = await sh.exec('f() { source deep.sh; echo afterSource=$?; return 1; }; f; echo outerExit=$?')
    expect(r.stdout).toBe('insrc\nafterSource=9\nouterExit=1\n')
  })

  it('ARGS 없이 source 하면 호출자의 positional 이 그대로 보인다', async () => {
    // docker: printf "echo $1\n" > echoer.sh; f() { source echoer.sh; }; f callerarg → callerarg
    fs.writeFile('/home/player/echoer.sh', 'echo $1\n')
    expect((await sh.exec('f() { source echoer.sh; }; f callerarg')).stdout).toBe('callerarg\n')
  })

  it('ARGS 가 있으면 그 동안만 바뀌고 source 후 호출자의 positional 로 복원된다', async () => {
    // docker: f() { source echoer.sh svcarg; echo after=$1; }; f callerarg → svcarg\nafter=callerarg
    fs.writeFile('/home/player/echoer.sh', 'echo $1\n')
    const r = await sh.exec('f() { source echoer.sh svcarg; echo after=$1; }; f callerarg')
    expect(r.stdout).toBe('svcarg\nafter=callerarg\n')
  })

  it('source 는 루프-문맥 경계가 아니다 — 안의 bare break/continue 가 호출자 루프에 실제로 닿는다', async () => {
    // docker: printf "break\n" > breaker.sh; for i in a b c; do echo $i; source breaker.sh; done; echo end
    //   → a\nend (호출자 for 를 실제로 깬다 — 함수 호출과 다르다)
    fs.writeFile('/home/player/breaker.sh', 'break\n')
    const r1 = await sh.exec('for i in a b c; do echo $i; source breaker.sh; done; echo end')
    expect(r1.stdout).toBe('a\nend\n')

    // docker: printf "continue\n" > continuer.sh; for i in a b c; do echo $i; source continuer.sh; echo tail$i; done; echo end
    //   → a\nb\nc\nend (tail$i 는 continue 로 인해 전혀 안 찍힌다)
    fs.writeFile('/home/player/continuer.sh', 'continue\n')
    const r2 = await sh.exec('for i in a b c; do echo $i; source continuer.sh; echo tail$i; done; echo end')
    expect(r2.stdout).toBe('a\nb\nc\nend\n')
  })

  it('return 없이 끝나면 source 의 exit code 는 파일의 마지막 명령의 exit code', async () => {
    fs.writeFile('/home/player/last.sh', 'true\nfalse\n')
    expect((await sh.exec('source last.sh; echo $?')).stdout).toBe('1\n')
  })
})

describe('함수/source 호출의 리다이렉션·프리픽스·파이프 stdin (M3 Part 2 task 4, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('함수 body 의 stdout 이 > 파일로 리다이렉트되고 터미널로는 새지 않는다', async () => {
    // docker: f() { echo body; }; f > out.txt; cat out.txt → body (터미널 무출력)
    const r = await sh.exec('f() { echo body; }; f > out.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/out.txt')).toBe('body\n')
  })

  it('함수 리다이렉션 >> 는 이어붙인다', async () => {
    // docker: f() { echo body; }; f > ap.txt; f >> ap.txt; cat ap.txt → body\nbody
    await sh.exec('f() { echo body; }; f > ap.txt')
    await sh.exec('f() { echo body; }; f >> ap.txt')
    expect(fs.readFile('/home/player/ap.txt')).toBe('body\nbody\n')
  })

  it('함수 body 의 stderr 는 2> 로 잡히고 stdout 은 통과한다', async () => {
    // docker: f() { cat nope.txt; }; f 2> err.txt; echo code=$? → code=1, err.txt 에 에러
    const r = await sh.exec('f() { cat nope.txt; }; f 2> err.txt')
    expect(r.stderr).toBe('')
    expect(r.exitCode).toBe(1)
    expect(fs.readFile('/home/player/err.txt')).toContain('No such file or directory')
  })

  it('프리픽스 대입이 함수 안에서 보인다 (VAR=x f → 안에서 $VAR===x)', async () => {
    // docker: f() { echo v=$VAR; }; VAR=hey f → v=hey
    expect((await sh.exec('f() { echo v=$VAR; }; VAR=hey f')).stdout).toBe('v=hey\n')
  })

  it('프리픽스 대입은 함수 호출 뒤 남지 않는다 (원래 unset 이면 unset 으로 복원)', async () => {
    // docker: f() { echo in=$VAR; }; VAR=hey f; echo after=[$VAR] → in=hey\nafter=[]
    const r = await sh.exec('f() { echo in=$VAR; }; VAR=hey f; echo "after=[$VAR]"')
    expect(r.stdout).toBe('in=hey\nafter=[]\n')
  })

  it('프리픽스 대입은 기존 값을 덮지 않고 호출 뒤 원래 값으로 복원한다', async () => {
    // docker: VAR=orig; f() { echo in=$VAR; }; VAR=hey f; echo after=[$VAR] → in=hey\nafter=[orig]
    const r = await sh.exec('VAR=orig; f() { echo in=$VAR; }; VAR=hey f; echo "after=[$VAR]"')
    expect(r.stdout).toBe('in=hey\nafter=[orig]\n')
  })

  it('함수가 프리픽스 키를 재대입해도 호출 뒤에는 복원된다 (bash 프리픽스 시맨틱)', async () => {
    // docker: f() { VAR=changed; echo in=$VAR; }; VAR=hey f; echo after=[$VAR] → in=changed\nafter=[]
    const r = await sh.exec('f() { VAR=changed; echo "in=$VAR"; }; VAR=hey f; echo "after=[$VAR]"')
    expect(r.stdout).toBe('in=changed\nafter=[]\n')
  })

  it('함수가 프리픽스 아닌 변수를 설정하면 호출 뒤에도 남는다 (env 공유 — 회귀 방지)', async () => {
    // docker: f() { y=set; }; VAR=hey f; echo [$y][$VAR] → [set][]
    const r = await sh.exec('f() { y=set; }; VAR=hey f; echo "[$y][$VAR]"')
    expect(r.stdout).toBe('[set][]\n')
  })

  it('파이프 stdin 이 함수 body 로 들어간다 (echo piped | f, f() { cat; })', async () => {
    // docker: f() { cat; }; echo piped | f → piped
    expect((await sh.exec('f() { cat; }; echo piped | f')).stdout).toBe('piped\n')
  })

  it('파이프 stdin 이 함수 body 의 grep 로 들어간다', async () => {
    // docker: f() { grep foo; }; printf 'foo\nbar\n' | f → foo
    fs.writeFile('/home/player/two.txt', 'foo\nbar\n')
    expect((await sh.exec('f() { grep foo; }; cat two.txt | f')).stdout).toBe('foo\n')
  })

  it('< 파일 리다이렉션이 함수 body 의 stdin 이 된다', async () => {
    // docker: f() { cat; }; f < a.txt → alpha
    expect((await sh.exec('f() { cat; }; f < a.txt')).stdout).toBe('alpha\n')
  })

  it('프리픽스 + 리다이렉션 조합: VAR=z f > out.txt → 파일에 z', async () => {
    // docker: f() { echo "$VAR"; }; VAR=z f > out.txt; cat out.txt → z
    await sh.exec('f() { echo "$VAR"; }; VAR=z f > out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('z\n')
  })

  it('파이프 stdin + 출력 리다이렉션 조합: cat two.txt | f > p.txt', async () => {
    // docker: printf 'L1\nL2\n' | f > p.txt (f() { cat; }) → p.txt = L1\nL2
    fs.writeFile('/home/player/two.txt', 'L1\nL2\n')
    await sh.exec('f() { cat; }; cat two.txt | f > p.txt')
    expect(fs.readFile('/home/player/p.txt')).toBe('L1\nL2\n')
  })

  it('리다이렉트된 함수의 exit code 는 body 의 exit code 를 그대로 낸다', async () => {
    // docker: f() { echo z; return 4; }; f > c.txt; echo code=$? → code=4, c.txt=z
    const r = await sh.exec('f() { echo z; return 4; }; f > c.txt; echo "code=$?"')
    expect(r.stdout).toBe('code=4\n')
    expect(fs.readFile('/home/player/c.txt')).toBe('z\n')
  })

  it('함수 리다이렉션 대상이 ambiguous 면 함수를 돌리지 않고 exit 1', async () => {
    // docker: f() { echo body; }; f > *.txt (a.txt/b.txt 매치) → ambiguous redirect, f 미실행
    const r = await sh.exec('f() { echo body; }; f > *.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toMatch(/ambiguous redirect/)
    // 함수가 돌지 않았으니 a.txt/b.txt 는 그대로다
    expect(fs.readFile('/home/player/a.txt')).toBe('alpha\n')
  })

  it('회귀: cd 하는 함수는 셸의 cwd 를 바꾼다 (프리픽스/리다이렉션 경로가 cwd 를 되돌리지 않는다)', async () => {
    // docker: cd /tmp; f() { cd /; }; f; pwd → /
    fs.mkdir('/home/player/sub')
    await sh.exec('f() { cd sub; }; f')
    expect(sh.cwd).toBe('/home/player/sub')
  })

  it('source 도 > 리다이렉션을 받는다', async () => {
    // docker: echo 'echo sourced' > s.sh; source s.sh > out.txt; cat out.txt → sourced
    fs.writeFile('/home/player/s.sh', 'echo sourced\n')
    const r = await sh.exec('source s.sh > out.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/out.txt')).toBe('sourced\n')
  })

  it('source 도 프리픽스 대입을 받고 호출 뒤 복원한다', async () => {
    // docker: printf 'echo insrc=$VAR\n' > s2.sh; VAR=hi source s2.sh; echo after=[$VAR] → insrc=hi\nafter=[]
    fs.writeFile('/home/player/s2.sh', 'echo insrc=$VAR\n')
    const r = await sh.exec('VAR=hi source s2.sh; echo "after=[$VAR]"')
    expect(r.stdout).toBe('insrc=hi\nafter=[]\n')
  })
})

describe('shebang 스크립트 실행 ./script.sh (task 9, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('exec 비트가 있으면 실행되고 인자가 $1..로 전달된다', async () => {
    // docker: printf "#!/bin/bash\necho deploying $1\n" > deploy.sh; chmod +x deploy.sh;
    //   ./deploy.sh prod → deploying prod, exit 0
    fs.writeFile('/home/player/deploy.sh', '#!/bin/bash\necho deploying $1\n', 0o755)
    const r = await sh.exec('./deploy.sh prod')
    expect(r.stdout).toBe('deploying prod\n')
    expect(r.exitCode).toBe(0)
  })

  it('exec 비트가 없으면 exit 126 Permission denied', async () => {
    // docker: chmod 644 deploy.sh; ./deploy.sh → "bash: ./deploy.sh: Permission denied", exit 126
    fs.writeFile('/home/player/deploy.sh', '#!/bin/bash\necho deploying $1\n', 0o644)
    const r = await sh.exec('./deploy.sh')
    expect(r.exitCode).toBe(126)
    expect(r.stderr).toBe('bash: ./deploy.sh: Permission denied\n')
  })

  it('없는 파일은 exit 127 No such file or directory', async () => {
    // docker: ./nope.sh → "bash: ./nope.sh: No such file or directory", exit 127
    const r = await sh.exec('./nope.sh')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toBe('bash: ./nope.sh: No such file or directory\n')
  })

  it('디렉터리를 실행하려 하면 exit 126 Is a directory', async () => {
    // docker: mkdir adir; ./adir → "bash: ./adir: Is a directory", exit 126
    fs.mkdir('/home/player/adir')
    const r = await sh.exec('./adir')
    expect(r.exitCode).toBe(126)
    expect(r.stderr).toBe('bash: ./adir: Is a directory\n')
  })

  it('환경은 격리된다 — 스크립트 안 대입이 호출자에 새지 않는다', async () => {
    // docker: printf "x=9\necho in=$x\n" > s.sh; chmod +x s.sh; ./s.sh; echo out=$x → in=9\nout=
    fs.writeFile('/home/player/s.sh', 'x=9\necho in=$x\n', 0o755)
    const r = await sh.exec('./s.sh; echo out=$x')
    expect(r.stdout).toBe('in=9\nout=\n')
  })

  it('파일시스템 변경은 실제 부작용이라 호출자에도 남는다', async () => {
    // docker: printf "mkdir made\n" > s2.sh; chmod +x s2.sh; ./s2.sh; ls -d made → made (존재)
    fs.writeFile('/home/player/s2.sh', 'mkdir made\n', 0o755)
    await sh.exec('./s2.sh')
    expect(fs.isDir('/home/player/made')).toBe(true)
  })

  it('스크립트명 다음 인자가 $1..로 전달된다', async () => {
    // docker: printf "echo $1 $2\n" > s3.sh; chmod +x s3.sh; ./s3.sh a b → a b
    fs.writeFile('/home/player/s3.sh', 'echo $1 $2\n', 0o755)
    expect((await sh.exec('./s3.sh a b')).stdout).toBe('a b\n')
  })

  it('#! 첫 줄은 주석으로 벗겨져 무시된다 — 있어도 없어도 결과가 같다', async () => {
    fs.writeFile('/home/player/withShebang.sh', '#!/bin/bash\necho hi\n', 0o755)
    fs.writeFile('/home/player/noShebang.sh', 'echo hi\n', 0o755)
    const r1 = await sh.exec('./withShebang.sh')
    const r2 = await sh.exec('./noShebang.sh')
    expect(r1).toEqual(r2)
    expect(r1.stdout).toBe('hi\n')
  })

  it('무한루프는 공유 예산에 걸려 exit 130 이지 hang/crash 가 아니다', async () => {
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 50 })
    fs.writeFile('/home/player/loop.sh', 'while true; do :; done\n', 0o755)
    const r = await tiny.exec('./loop.sh')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })

  it('여러 줄 스크립트에서 함수 정의와 루프가 동작한다', async () => {
    // docker: printf "greet() { echo hi $1; }\nfor n in a b; do greet $n; done\n" > s4.sh;
    //   chmod +x s4.sh; ./s4.sh → hi a\nhi b
    fs.writeFile('/home/player/s4.sh', 'greet() { echo hi $1; }\nfor n in a b; do greet $n; done\n', 0o755)
    expect((await sh.exec('./s4.sh')).stdout).toBe('hi a\nhi b\n')
  })

  it('함수맵도 양방향으로 격리된다 — 호출자 함수가 스크립트 안에서 안 보이고, 스크립트 함수가 밖으로 안 샌다', async () => {
    // docker: outer(){ echo x; }; printf "outer || echo not-visible\n" > f1.sh; chmod +x f1.sh; ./f1.sh
    //   → "./f1.sh: line 1: outer: command not found" + "not-visible"
    fs.writeFile('/home/player/f1.sh', 'outer || echo not-visible\n', 0o755)
    const r1 = await sh.exec('outer() { echo called; }; ./f1.sh')
    expect(r1.stdout).toBe('not-visible\n')

    // docker: printf "inscript(){ echo hi; }\ninscript\n" > f2.sh; chmod +x f2.sh; ./f2.sh; inscript
    //   → hi (스크립트 안), 그다음 command not found (호출자 쪽)
    fs.writeFile('/home/player/f2.sh', 'inscript() { echo hi; }\ninscript\n', 0o755)
    const r2 = await sh.exec('./f2.sh; inscript')
    expect(r2.stdout).toBe('hi\n')
    expect(r2.stderr).toBe('bash: inscript: command not found\n')
  })

  it('positional 은 (source 와 달리) ARGS 가 없어도 항상 덮어써 호출자의 $1 이 안 보인다', async () => {
    // docker: set -- callerarg; printf "echo [$1]\n" > f3.sh; chmod +x f3.sh; ./f3.sh → []
    fs.writeFile('/home/player/f3.sh', 'echo [$1]\n', 0o755)
    const r = await sh.exec('./f3.sh')
    expect(r.stdout).toBe('[]\n')
  })

  it('cd 는 스크립트 안에서만 유효하고 호출자 cwd 는 그대로다', async () => {
    // docker: mkdir sub; printf "cd sub; pwd\n" > f5.sh; chmod +x f5.sh; pwd; ./f5.sh; pwd
    //   → /tmp, /tmp/sub, /tmp
    fs.mkdir('/home/player/sub')
    fs.writeFile('/home/player/f5.sh', 'cd sub; pwd\n', 0o755)
    const r = await sh.exec('./f5.sh')
    expect(r.stdout).toBe('/home/player/sub\n')
    expect(sh.cwd).toBe('/home/player')
  })

  it('명령앞 대입은 스크립트 환경에는 보이지만 호출자에는 안 샌다', async () => {
    // docker: printf "echo VAR=$VAR\n" > pv.sh; chmod +x pv.sh; VAR=hello ./pv.sh; echo after=$VAR
    //   → VAR=hello, after=
    fs.writeFile('/home/player/pv.sh', 'echo VAR=$VAR\n', 0o755)
    const r = await sh.exec('VAR=hello ./pv.sh; echo after=$VAR')
    expect(r.stdout).toBe('VAR=hello\nafter=\n')
  })

  it('출력 리다이렉션이 스크립트 실행에도 그대로 적용된다', async () => {
    fs.writeFile('/home/player/s5.sh', 'echo redirected\n', 0o755)
    const r = await sh.exec('./s5.sh > out.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/out.txt')).toBe('redirected\n')
  })

  it('슬래시 없는 이름은 (exec 비트가 있어도) 여전히 command not found — PATH 가 없다', async () => {
    // docker: script.sh(슬래시 없이) 는 PATH에 '.' 이 없는 한 실행되지 않는다.
    fs.writeFile('/home/player/plain.sh', 'echo hi\n', 0o755)
    const r = await sh.exec('plain.sh')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toBe('bash: plain.sh: command not found\n')
  })
})

describe('배열 저장 (task-1, M3 Part 3) — 저장 + 격리만. 파싱(arr=(...))/확장(${arr[@]})은 task 2/3', () => {
  // 아직 arr=(...) 파싱도, ${arr[@]} 확장도 없다. 이 블록은 브리프가 요구하는 대로
  // "저장 + 격리"만 기계적으로 검증한다 — bash 의미(서브셸 밖으로 안 샘) 자체는
  // task 2/3 에서 진짜 스크립트로 재검증한다.
  function freshState(): ShellState {
    return {
      cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' },
      lastExitCode: 0, home: '/home/player', functions: new Map(), arrays: new Map(),
    }
  }

  it('ShellState 는 arrays 필드를 갖고, 새로 만들면 빈 Map 이다', () => {
    const state = freshState()
    expect(state.arrays).toBeInstanceOf(Map)
    expect(state.arrays.size).toBe(0)
  })

  it('run() 은 arrays 가 채워진 state 를 받아도 그대로 동작한다 (저장 필드 배선 확인)', async () => {
    const state = freshState()
    state.arrays.set('a', ['x', 'y'])
    const r = await run('echo hi', fs, state, 100_000)
    expect(r).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 })
    // 단순 명령 실행은 arrays 를 안 건드린다 (아직 대입 문법이 없으니 당연하지만,
    // 필드가 실수로 사라지거나 초기화되지 않는지 확인한다).
    expect(state.arrays.get('a')).toEqual(['x', 'y'])
  })

  it('childCtx 는 arrays 를 새 Map 으로 복사한다 (부모와 다른 참조 — 서브셸 격리의 핵심)', () => {
    const state = freshState()
    state.arrays.set('a', ['x', 'y'])
    const parentCtx = {
      fs, state, budget: { remaining: 1000 }, positional: [] as string[],
      loopDepth: 0, functions: new Map(), funcDepth: 0,
    }
    const child = childCtx(parentCtx)
    expect(child.state.arrays).not.toBe(state.arrays) // 참조가 다르다
    expect(child.state.arrays.get('a')).toEqual(['x', 'y']) // 값은 상속(스냅샷)됐다
  })

  it('자식이 배열 맵을 직접 조작해도(Map 조작 — arr[0]=X 파싱 전 대체) 부모로 안 샌다', () => {
    // bash 근거(파싱/확장 붙는 task 2/3 후 진짜 스크립트로 재검증 예정):
    // arr=(a b c); ( arr[0]=X; echo ${arr[0]} ); echo ${arr[0]} → X, a
    const state = freshState()
    state.arrays.set('a', ['x', 'y'])
    const parentCtx = {
      fs, state, budget: { remaining: 1000 }, positional: [] as string[],
      loopDepth: 0, functions: new Map(), funcDepth: 0,
    }
    const child = childCtx(parentCtx)

    // 서브셸 안에서의 "변이" 를 흉내낸다: 기존 원소 갱신 + 새 키 추가
    child.state.arrays.set('a', ['MUTATED'])
    child.state.arrays.set('b', ['new'])

    expect(state.arrays.get('a')).toEqual(['x', 'y']) // 부모의 기존 원소는 그대로
    expect(state.arrays.has('b')).toBe(false) // 자식에서 만든 새 키도 부모엔 없다
  })

  it('부모가 나중에 배열을 바꿔도 이미 뜬 자식 사본에는 안 보인다 (양방향 격리)', () => {
    const state = freshState()
    state.arrays.set('a', ['x'])
    const parentCtx = {
      fs, state, budget: { remaining: 1000 }, positional: [] as string[],
      loopDepth: 0, functions: new Map(), funcDepth: 0,
    }
    const child = childCtx(parentCtx)
    state.arrays.set('c', ['later'])
    expect(child.state.arrays.has('c')).toBe(false)
  })

  it('shebang 스크립트 실행(execScriptFile) 은 호출자의 arrays 를 그대로 둔 채로 돈다', async () => {
    // arr=(...) 대입 문법이 아직 없어 스크립트 "안"에서 배열을 실제로 바꿔볼 수는
    // 없지만(task 2/3 이후 재검증), execScriptFile 이 이 필드를 안 건드리는지 —
    // 즉 저장 배선이 스크립트 실행 경로에서도 안 깨지는지는 지금 확인할 수 있다.
    fs.writeFile('/home/player/arrtest.sh', 'echo scripted\n', 0o755)
    const state = freshState()
    state.arrays.set('a', ['x', 'y'])
    const originalArraysRef = state.arrays
    const r = await run('./arrtest.sh', fs, state, 100_000)
    expect(r).toEqual({ stdout: 'scripted\n', stderr: '', exitCode: 0 })
    expect(state.arrays).toBe(originalArraysRef) // 최상위 state 객체 자체는 안 건드림
    expect(state.arrays.get('a')).toEqual(['x', 'y'])
  })
})

describe('배열 대입 실행 (M3 Part 3 task 2) — state.arrays 에 저장', () => {
  // 저장까지만 검증한다(읽기 ${arr[@]} 는 task 3). 기대값은 전부 docker
  // debian:stable-slim bash 5 로 declare -p 대조해 확정했다.
  function freshState(): ShellState {
    return {
      cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' },
      lastExitCode: 0, home: '/home/player', functions: new Map(), arrays: new Map(),
    }
  }

  it('arr=(a b c) → arrays 에 [a,b,c], env 스칼라로는 안 샌다', async () => {
    const state = freshState()
    const r = await run('arr=(a b c)', fs, state, 100_000)
    expect(r.exitCode).toBe(0)
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'c'])
    expect('arr' in state.env).toBe(false)
  })

  it('원소는 단어분할된다: x="1 2"; arr=(a $x b) → [a,1,2,b]', async () => {
    const state = freshState()
    state.env.x = '1 2'
    await run('arr=(a $x b)', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', '1', '2', 'b'])
  })

  it('따옴표는 분할을 막는다: arr=("1 2" b) → ["1 2", b]', async () => {
    const state = freshState()
    await run('arr=("1 2" b)', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['1 2', 'b'])
  })

  it('원소는 글롭된다: arr=(*.txt) → [a.txt, b.txt] (cwd 파일 매칭)', async () => {
    const state = freshState()
    await run('arr=(*.txt)', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a.txt', 'b.txt'])
  })

  it('매칭 없으면 리터럴 유지: arr=(*.nomatch) → ["*.nomatch"] (nullglob off)', async () => {
    const state = freshState()
    await run('arr=(*.nomatch)', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['*.nomatch'])
  })

  it('빈 배열 arr=() → []', async () => {
    const state = freshState()
    await run('arr=()', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual([])
  })

  it('명령치환 원소도 분할된다: arr=($(echo x y) b) → [x,y,b]', async () => {
    const state = freshState()
    await run('arr=($(echo x y) b)', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['x', 'y', 'b'])
  })

  it('원소 대입 arr[1]=Z 는 해당 인덱스만 바꾼다 → [a,Z,c]', async () => {
    const state = freshState()
    await run('arr=(a b c); arr[1]=Z', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'Z', 'c'])
  })

  it('sparse: arr[5]=z 는 3,4 를 진짜 hole 로 남긴다 (채우지 않음)', async () => {
    const state = freshState()
    await run('arr=(a b c); arr[5]=z', fs, state, 100_000)
    const arr = state.arrays.get('arr')!
    expect(arr[0]).toBe('a')
    expect(arr[2]).toBe('c')
    expect(arr[5]).toBe('z')
    expect(3 in arr).toBe(false) // 진짜 구멍 — 빈 문자열로 안 채운다
    expect(4 in arr).toBe(false)
    expect(arr.length).toBe(6)
    expect(Object.keys(arr)).toEqual(['0', '1', '2', '5'])
  })

  it('첨자는 산술식이다: arr[1+1]=X; i=3; arr[$i]=Y → [a,b,X,Y]', async () => {
    const state = freshState()
    state.env.i = '3'
    await run('arr=(a b c); arr[1+1]=X; arr[$i]=Y', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'X', 'Y'])
  })

  it('원소값(arr[i]=v)은 분할/글롭 안 함: x="p q"; arr[1]=$x → [a,"p q",c]', async () => {
    const state = freshState()
    state.env.x = 'p q'
    await run('arr=(a b c); arr[1]=$x', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'p q', 'c'])
  })

  it('미설정 배열에 arr[2]=x → 배열 생성(sparse, 0/1 은 hole)', async () => {
    const state = freshState()
    await run('newarr[2]=x', fs, state, 100_000)
    const arr = state.arrays.get('newarr')!
    expect(arr[2]).toBe('x')
    expect(0 in arr).toBe(false)
    expect(1 in arr).toBe(false)
  })

  it('스칼라 승격: x=5; x[1]=y → 배열 [5,y], env 스칼라 제거', async () => {
    const state = freshState()
    await run('x=5; x[1]=y', fs, state, 100_000)
    expect(state.arrays.get('x')).toEqual(['5', 'y'])
    expect('x' in state.env).toBe(false)
  })

  it('배열 리터럴은 기존 스칼라를 대체하고 env 에서 지운다: arr=old; arr=(a b c)', async () => {
    const state = freshState()
    await run('arr=old; arr=(a b c)', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'c'])
    expect('arr' in state.env).toBe(false)
  })

  it('기존 배열에 스칼라 대입 arr=Z → 인덱스 0 대입 (bash J)', async () => {
    const state = freshState()
    await run('arr=(a b c); arr=Z', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['Z', 'b', 'c'])
    expect('arr' in state.env).toBe(false)
  })

  it('스칼라 대입 회귀: x=5 는 여전히 env 로 가고 arrays 를 안 만든다', async () => {
    const state = freshState()
    await run('x=5', fs, state, 100_000)
    expect(state.env.x).toBe('5')
    expect(state.arrays.has('x')).toBe(false)
  })

  it('unterminated arr=(a b 는 크래시 없이 nonzero exit, 저장 안 함', async () => {
    const state = freshState()
    const r = await run('arr=(a b', fs, state, 100_000)
    expect(r.exitCode).not.toBe(0)
    expect(state.arrays.has('arr')).toBe(false)
  })

  it('서브셸 격리: arr=(a b c); ( arr[0]=X ) — 밖의 arrays 는 안 바뀐다', async () => {
    // bash: arr=(a b c); ( arr[0]=X; ... ); (밖에서) 여전히 a. in-place mutate 를 안 하는
    // 것(slice 사본)이 없으면 공유 배열이 오염돼 이 격리가 깨진다.
    const state = freshState()
    await run('arr=(a b c); ( arr[0]=X )', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'c'])
  })

  it('음수 첨자 대입은 끝에서부터 (task 3 fold-in): arr[-1]=Z → a b Z, 유령 "-1" 키 없음', async () => {
    // docker: arr=(a b c); arr[-1]=Z → declare -p arr = ([0]="a" [1]="b" [2]="Z")
    const state = freshState()
    await run('arr=(a b c); arr[-1]=Z', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'Z'])
    expect(Object.keys(state.arrays.get('arr')!)).toEqual(['0', '1', '2']) // "-1" 유령 키 없음
  })

  it('음수 첨자 대입 arr[-2]=Y → a Y c', async () => {
    const state = freshState()
    await run('arr=(a b c); arr[-2]=Y', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'Y', 'c'])
  })

  it('범위 밖 음수 첨자 대입 arr[-9]=x 는 크래시 없이 nonzero, 대입 안 함', async () => {
    const state = freshState()
    const r = await run('arr=(a b c); arr[-9]=x', fs, state, 100_000)
    expect(r.exitCode).not.toBe(0)
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'c']) // 그대로
  })
})

describe('+= append 대입 실행 (M3 Part 4 task 1, docker debian:stable-slim bash 5 대조)', () => {
  function freshState(): ShellState {
    return {
      cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' },
      lastExitCode: 0, home: '/home/player', functions: new Map(), arrays: new Map(),
    }
  }

  // --- rule 1: 스칼라 문자열 연결 (산술 아님) ---
  it('스칼라 연결 s=hi; s+=there → hithere', async () => {
    const state = freshState()
    const r = await run('s=hi; s+=there; echo "$s"', fs, state, 100_000)
    expect(r.stdout).toBe('hithere\n')
    expect(state.env.s).toBe('hithere')
  })

  it('스칼라 += 는 산술이 아니라 문자열 연결: x=5; x+=3 → 53', async () => {
    const state = freshState()
    await run('x=5; x+=3', fs, state, 100_000)
    expect(state.env.x).toBe('53')
  })

  it('미설정 변수 += 는 빈 베이스: unset u; u+=x → x', async () => {
    const state = freshState()
    const r = await run('u+=x; echo "[$u]"', fs, state, 100_000)
    expect(r.stdout).toBe('[x]\n')
    expect(state.env.u).toBe('x')
  })

  // --- rule 2: 배열 끝에 append ---
  it('배열 끝에 append: arr=(a b); arr+=(c d) → a b c d', async () => {
    const state = freshState()
    const r = await run('arr=(a b); arr+=(c d); echo "${arr[@]}"', fs, state, 100_000)
    expect(r.stdout).toBe('a b c d\n')
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('append 원소도 분할/글롭된다: x="1 2"; arr=(a); arr+=($x b) → count 4', async () => {
    const state = freshState()
    const r = await run('x="1 2"; arr=(a); arr+=($x b); echo "${#arr[@]}|${arr[@]}"', fs, state, 100_000)
    expect(r.stdout).toBe('4|a 1 2 b\n')
    expect(state.arrays.get('arr')).toEqual(['a', '1', '2', 'b'])
  })

  it('미설정 배열에 += : arr+=(x y) → 새 배열 생성', async () => {
    const state = freshState()
    await run('newarr+=(x y)', fs, state, 100_000)
    expect(state.arrays.get('newarr')).toEqual(['x', 'y'])
  })

  it('sparse 배열 append 는 최대인덱스+1 부터: arr=(a); arr[5]=z; arr+=(w) → w 는 인덱스 6', async () => {
    // bash: append 는 length(=최대인덱스+1) 위치에 붙는다.
    const state = freshState()
    await run('arr=(a); arr[5]=z; arr+=(w)', fs, state, 100_000)
    const arr = state.arrays.get('arr')!
    expect(arr[0]).toBe('a')
    expect(arr[5]).toBe('z')
    expect(arr[6]).toBe('w')
    expect(3 in arr).toBe(false) // 기존 hole 은 유지
  })

  // --- rule 3: 원소 문자열 연결 ---
  it('원소 연결 arr=(a b c); arr[1]+=X → a bX c', async () => {
    const state = freshState()
    const r = await run('arr=(a b c); arr[1]+=X; echo "${arr[@]}"', fs, state, 100_000)
    expect(r.stdout).toBe('a bX c\n')
    expect(state.arrays.get('arr')).toEqual(['a', 'bX', 'c'])
  })

  it('원소 += 값은 분할/글롭 안 함: v="p q"; arr=(a b c); arr[1]+=$v → b + "p q"', async () => {
    const state = freshState()
    state.env.v = 'p q'
    await run('arr=(a b c); arr[1]+=$v', fs, state, 100_000)
    expect(state.arrays.get('arr')).toEqual(['a', 'bp q', 'c'])
  })

  it('sparse 원소 += (미존재 인덱스): arr=(a b); arr[5]+=z → 인덱스 5 = z (빈 베이스)', async () => {
    const state = freshState()
    await run('arr=(a b); arr[5]+=z', fs, state, 100_000)
    const arr = state.arrays.get('arr')!
    expect(arr[5]).toBe('z')
    expect(3 in arr).toBe(false)
    expect(arr.length).toBe(6)
  })

  // --- rule 4: 프리픽스 += 는 OUTER 값을 베이스로, persist 하지 않는다 ---
  it('프리픽스 += 는 persist 하지 않는다: s=orig; s+=APP true → s 는 orig 유지', async () => {
    const state = freshState()
    const r = await run('s=orig; s+=APP true; echo "[$s]"', fs, state, 100_000)
    expect(r.stdout).toBe('[orig]\n')
    expect(state.env.s).toBe('orig')
  })

  it('프리픽스 += 베이스는 OUTER 값 — 명령 실행 중엔 origAPP 로 보인다(함수 env 공유)', async () => {
    // docker: s=orig; f(){ echo "[$s]"; }; s+=APP f → in=[origAPP], after=[orig]
    const state = freshState()
    const r = await run('s=orig; f(){ echo "in=[$s]"; }; s+=APP f; echo "after=[$s]"', fs, state, 100_000)
    expect(r.stdout).toBe('in=[origAPP]\nafter=[orig]\n')
    expect(state.env.s).toBe('orig')
  })

  // --- rule 5: cross-type edge (docker 확인) ---
  it('cross-type 스칼라 += 배열: x=5; x+=(a b) → 5 a b (스칼라를 인덱스0 승격 후 append)', async () => {
    const state = freshState()
    const r = await run('x=5; x+=(a b); echo "${x[@]}"', fs, state, 100_000)
    expect(r.stdout).toBe('5 a b\n')
    expect(state.arrays.get('x')).toEqual(['5', 'a', 'b'])
    expect('x' in state.env).toBe(false)
  })

  it('cross-type 배열 += 스칼라: arr=(a b); arr+=c → ac b (인덱스0에 연결)', async () => {
    const state = freshState()
    const r = await run('arr=(a b); arr+=c; echo "${arr[@]}"', fs, state, 100_000)
    expect(r.stdout).toBe('ac b\n')
    expect(state.arrays.get('arr')).toEqual(['ac', 'b'])
  })

  // --- malformed: 크래시 없이 얌전한 nonzero ---
  it('malformed +=x 는 크래시 없이 nonzero (command not found)', async () => {
    const state = freshState()
    const r = await run('+=x', fs, state, 100_000)
    expect(r.exitCode).not.toBe(0)
  })

  it('malformed arr[+=x 는 크래시 없이 nonzero', async () => {
    const state = freshState()
    const r = await run('arr[+=x', fs, state, 100_000)
    expect(r.exitCode).not.toBe(0)
  })
})

describe('배열 읽기 end-to-end (M3 Part 3 task 3) — 대입→확장→echo (docker bash 5.2 대조)', () => {
  function freshState(): ShellState {
    return {
      cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' },
      lastExitCode: 0, home: '/home/player', functions: new Map(), arrays: new Map(),
    }
  }

  it('echo ${arr[@]} / ${arr[0]} / ${#arr[@]} / ${!arr[@]}', async () => {
    const state = freshState()
    const r = await run(
      'arr=(a b c); echo "${arr[@]}"; echo "${arr[0]}-${arr[2]}"; echo "${#arr[@]}"; echo "${!arr[@]}"',
      fs, state, 100_000,
    )
    expect(r.stdout).toBe('a b c\na-c\n3\n0 1 2\n')
  })

  it('비따옴표 ${arr[@]} 는 공백 낀 원소를 단어분할 (for 루프 대조)', async () => {
    // arr=("a b" c); for e in ${arr[@]} → [a][b][c] (따옴표 없으면 "a b" 도 쪼개진다)
    const state = freshState()
    const r = await run(
      'arr=("a b" c); for e in ${arr[@]}; do echo "[$e]"; done',
      fs, state, 100_000,
    )
    expect(r.stdout).toBe('[a]\n[b]\n[c]\n')
  })

  it('sparse: arr=(a b c); arr[5]=z → ${arr[@]}=a b c z, ${#arr[@]}=4, ${!arr[@]}=0 1 2 5', async () => {
    const state = freshState()
    const r = await run(
      'arr=(a b c); arr[5]=z; echo "${arr[@]}|${#arr[@]}|${!arr[@]}"',
      fs, state, 100_000,
    )
    expect(r.stdout).toBe('a b c z|4|0 1 2 5\n')
  })

  it('for 루프가 "${arr[@]}" 를 원소별로 순회 (공백 낀 원소 보존)', async () => {
    const state = freshState()
    const r = await run(
      'arr=("x y" z); for e in "${arr[@]}"; do echo "[$e]"; done',
      fs, state, 100_000,
    )
    expect(r.stdout).toBe('[x y]\n[z]\n')
  })

  it('IFS=, 로 "${arr[*]}" 조인', async () => {
    const state = freshState()
    const r = await run('arr=(a b c); IFS=,; echo "${arr[*]}"', fs, state, 100_000)
    expect(r.stdout).toBe('a,b,c\n')
  })

  it('bare $arr 는 원소0 (a)', async () => {
    const state = freshState()
    const r = await run('arr=(a b c); echo $arr', fs, state, 100_000)
    expect(r.stdout).toBe('a\n')
  })
})

describe('복합 명령 리다이렉션 실행 (M3 Part 3 task 5, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('for..done > out — 본문 stdout 이 파일로 가고 터미널엔 안 나온다', async () => {
    // docker: for i in a b c; do echo $i; done > out.txt; cat out.txt → a\nb\nc
    const r = await sh.exec('for i in a b c; do echo $i; done > out.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/out.txt')).toBe('a\nb\nc\n')
  })

  it('while false > out — 0회 반복이라 out 은 빈 파일로 생성된다', async () => {
    // docker: while false; do echo x; done > o2.txt → o2.txt 빈 파일(생성됨)
    await sh.exec('while false; do echo x; done > o2.txt')
    expect(fs.readFile('/home/player/o2.txt')).toBe('')
  })

  it('if true; then ...; fi > out', async () => {
    // docker: if true; then echo hi; fi > o.txt; cat o.txt → hi
    const r = await sh.exec('if true; then echo hi; fi > o.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/o.txt')).toBe('hi\n')
  })

  it('if-else 의 else 가지도 리다이렉션된다', async () => {
    // docker: if false; then echo a; else echo b; fi > o.txt → b
    await sh.exec('if false; then echo a; else echo b; fi > o.txt')
    expect(fs.readFile('/home/player/o.txt')).toBe('b\n')
  })

  it('case..esac > out', async () => {
    // docker: case x in x) echo matched;; esac > o.txt → matched
    await sh.exec('case x in x) echo matched;; esac > o.txt')
    expect(fs.readFile('/home/player/o.txt')).toBe('matched\n')
  })

  it('{ ...; } > out — 브레이스 그룹', async () => {
    // docker: { echo a; echo b; } > o.txt → a\nb
    const r = await sh.exec('{ echo a; echo b; } > o.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/o.txt')).toBe('a\nb\n')
  })

  it('( ... ) > out — 서브셸 (Part 2 carried minor)', async () => {
    // docker: ( echo sub ) > o.txt → sub
    const r = await sh.exec('( echo sub ) > o.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/o.txt')).toBe('sub\n')
  })

  it('>> 이어쓰기: 두 번 돌리면 누적된다', async () => {
    // docker: for i in 1 2; do echo $i; done >> o7.txt (두 번) → 1\n2\n1\n2\n
    await sh.exec('for i in 1 2; do echo $i; done >> o7.txt')
    await sh.exec('for i in 1 2; do echo $i; done >> o7.txt')
    expect(fs.readFile('/home/player/o7.txt')).toBe('1\n2\n1\n2\n')
  })

  it('{ ...; } 2> e — 본문 stderr 만 파일로 잡고 exit code 는 보존한다', async () => {
    // docker: { ls /nonexistent; } 2> e.txt → e.txt 에 에러, 터미널 stderr 없음
    const r = await sh.exec('{ ls /nonexistent; } 2> e8.txt')
    expect(r.stderr).toBe('')
    expect(r.exitCode).not.toBe(0)
    expect(fs.readFile('/home/player/e8.txt')).toMatch(/nonexistent/)
  })

  it('for..done > o 2> e — stdout/stderr 를 서로 다른 파일로 가른다', async () => {
    // docker: for i in a; do echo $i; done > o.txt 2> e.txt → o=a, e=빈파일
    const r = await sh.exec('for i in a; do echo $i; done > o9.txt 2> e9.txt')
    expect(r.stdout).toBe('')
    expect(fs.readFile('/home/player/o9.txt')).toBe('a\n')
    expect(fs.readFile('/home/player/e9.txt')).toBe('')
  })

  it('입력 redir: if true; then cat; fi < file — 본문 cat 이 파일을 stdin 으로 읽는다', async () => {
    // docker: printf hello\n > in.txt; if true; then cat; fi < in.txt → hello
    fs.writeFile('/home/player/in.txt', 'hello\n')
    const r = await sh.exec('if true; then cat; fi < in.txt')
    expect(r.stdout).toBe('hello\n')
  })

  it('입력 redir: { cat; } < file — 그룹 본문이 파일을 stdin 으로 읽는다', async () => {
    fs.writeFile('/home/player/in.txt', 'hello\n')
    const r = await sh.exec('{ cat; } < in.txt')
    expect(r.stdout).toBe('hello\n')
  })

  it('입력 redir: ( cat ) < file — 서브셸 본문이 파일을 stdin 으로 읽는다', async () => {
    fs.writeFile('/home/player/in.txt', 'hello\n')
    const r = await sh.exec('( cat ) < in.txt')
    expect(r.stdout).toBe('hello\n')
  })

  it('Task 6: while read x; do echo $x; done < file — 매 반복 한 줄씩 (커서)', async () => {
    // docker: printf 'l1\nl2\nl3\n' > f; while read x; do echo $x; done < f → l1/l2/l3
    fs.writeFile('/home/player/lines.txt', 'l1\nl2\nl3\n')
    const r = await sh.exec('while read x; do echo $x; done < lines.txt')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe('l1\nl2\nl3\n')
  })

  it('회귀: redir 없는 복합 명령은 그대로 터미널로 출력한다', async () => {
    const r = await sh.exec('for i in a b; do echo $i; done')
    expect(r.stdout).toBe('a\nb\n')
  })

  it('ambiguous redirect: 대상이 여러 개로 확장되면 본문을 안 돌리고 exit 1', async () => {
    // a.txt/b.txt 두 파일이 매치 → ambiguous. 본문 echo 는 실행되지 않는다.
    const r = await sh.exec('for i in a; do echo ran; done > *.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toMatch(/ambiguous redirect/)
    expect(r.stdout).toBe('')
  })

  it('malformed: done 뒤 redir 대상이 없으면 문법 오류(exit 2), 크래시 아님', async () => {
    const r = await sh.exec('for i in a; do echo $i; done >')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/syntax error/)
  })

  it('회귀: 단순 명령 리다이렉션은 그대로 동작한다 (echo hi > out)', async () => {
    await sh.exec('echo hi > simple.txt')
    expect(fs.readFile('/home/player/simple.txt')).toBe('hi\n')
  })
})

describe('while/for read — 줄별 stdin 커서 (M3 Part 3 task 6, docker debian:stable-slim bash 5.2 로 확인됨)', () => {
  it('case1: while read x; done < f — 개행 종료 세 줄 모두 처리', async () => {
    // docker: printf 'a\nb\nc\n' > f; while read x; do echo "got:$x"; done < f → got:a/got:b/got:c
    fs.writeFile('/home/player/f', 'a\nb\nc\n')
    const r = await sh.exec('while read x; do echo "got:$x"; done < f')
    expect(r.stdout).toBe('got:a\ngot:b\ngot:c\n')
    expect(r.exitCode).toBe(0)
  })

  it('case2: while read a b — 다중 변수, 마지막이 나머지', async () => {
    // docker: printf 'x y z\n' > f2; while read a b; do echo "$a|$b"; done < f2 → x|y z
    fs.writeFile('/home/player/f2', 'x y z\n')
    const r = await sh.exec('while read a b; do echo "$a|$b"; done < f2')
    expect(r.stdout).toBe('x|y z\n')
  })

  it('case3: cat f | while read n — 파이프 stdin 을 매 반복 한 줄씩 (printf 미구현이라 cat 로 동등 재현)', async () => {
    // docker: printf '1\n2\n' | while read n; do echo "n=$n"; done → n=1/n=2
    // 우리 엔진엔 printf 가 없어 같은 두 줄을 담은 파일을 cat 으로 파이프에 흘린다.
    fs.writeFile('/home/player/nums', '1\n2\n')
    const r = await sh.exec('cat nums | while read n; do echo "n=$n"; done')
    expect(r.stdout).toBe('n=1\nn=2\n')
  })

  it('case3b: 파이프 while 은 서브셸 — 변수는 밖으로 안 샌다(출력만 일치)', async () => {
    // docker: n=orig; printf '1\n2\n' | while read n; do :; done; echo "after=$n" → after=orig
    fs.writeFile('/home/player/nums', '1\n2\n')
    const r = await sh.exec('n=orig; cat nums | while read n; do :; done; echo "after=$n"')
    expect(r.stdout).toBe('after=orig\n')
  })

  it('case4: 빈 파일 → 루프 0회', async () => {
    // docker: printf '' > e; while read x; do echo no; done < e → (없음), exit 0
    fs.writeFile('/home/player/e', '')
    const r = await sh.exec('while read x; do echo no; done < e')
    expect(r.stdout).toBe('')
    expect(r.exitCode).toBe(0)
  })

  it('case5: 마지막 줄에 개행 없음 → 그 줄은 read 하지만 exit 1 이라 본문 미실행(EOF 규칙)', async () => {
    // docker: printf 'a\nb\nc' > f3; while read x; do echo "got:$x"; done < f3 → got:a/got:b (got:c 없음)
    fs.writeFile('/home/player/f3', 'a\nb\nc')
    const r = await sh.exec('while read x; do echo "got:$x"; done < f3')
    expect(r.stdout).toBe('got:a\ngot:b\n')
  })

  it('case5b: 단독 read 의 부분 마지막 줄 — 대입은 하되 exit 1 (Task 4 정합)', async () => {
    // docker: printf 'a' > f4; read x < f4; echo "[$x] $?" → [a] 1
    fs.writeFile('/home/player/f4', 'a')
    const r = await sh.exec('read x < f4; echo "[$x] $?"')
    expect(r.stdout).toBe('[a] 1\n')
  })

  it('case6: read 가 앞뒤 IFS 공백을 매 줄 트림한다', async () => {
    // docker: printf '  hello world  \n\tindented\n' > f6; while read line; do echo "[$line]"; done < f6
    //         → [hello world] / [indented]
    fs.writeFile('/home/player/f6', '  hello world  \n\tindented\n')
    const r = await sh.exec('while read line; do echo "[$line]"; done < f6')
    expect(r.stdout).toBe('[hello world]\n[indented]\n')
  })

  it('case7: for 본문의 inner read < otherfile 은 커서가 아니라 그 파일을 매 반복 다시 읽는다', async () => {
    // docker: printf 'FIRST\nSECOND\n' > other; for i in a b; do read x < other; echo $x; done
    //         → FIRST/FIRST (커서가 가로채지 않음 — inner 명시 리다이렉션이 우선)
    fs.writeFile('/home/player/other', 'FIRST\nSECOND\n')
    const r = await sh.exec('for i in a b; do read x < other; echo $x; done')
    expect(r.stdout).toBe('FIRST\nFIRST\n')
  })

  it('case7b: for..done < f 인데 inner read < g — 루프 커서 대신 g 를 씀(커서 하이재킹 방지)', async () => {
    // for 루프가 f 커서를 열어도, 본문의 read x < g 는 g 를 읽는다(inputFromFile override).
    fs.writeFile('/home/player/floop', 'L1\nL2\nL3\n')
    fs.writeFile('/home/player/g', 'GG\n')
    const r = await sh.exec('for i in a b; do read x < g; echo $x; done < floop')
    expect(r.stdout).toBe('GG\nGG\n')
  })

  it('case8: 큰 입력도 매 반복 spend — 넉넉한 예산이면 전부 처리', async () => {
    fs.writeFile('/home/player/big', Array.from({ length: 200 }, (_, i) => String(i + 1)).join('\n') + '\n')
    const r = await sh.exec('c=0; while read n; do c=$((c+1)); done < big; echo "processed=$c"')
    expect(r.stdout).toBe('processed=200\n')
    expect(r.exitCode).toBe(0)
  })

  it('case8b: 큰 입력 + 작은 예산 → 반복마다 예산 소모하다 runaway 가드에 걸린다(무한/우회 아님)', async () => {
    fs.writeFile('/home/player/big2', Array.from({ length: 500 }, (_, i) => String(i + 1)).join('\n') + '\n')
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 20 })
    const r = await tiny.exec('while read n; do echo $n; done < big2')
    expect(r.exitCode).toBe(130) // ExecutionLimitError → per-반복 spend 가 예산을 깎아 가드에 걸림
  })

  it('REPLY: 이름 없는 while read 도 커서를 전진시킨다', async () => {
    // docker: printf 'p\nq\n' > fr; while read; do echo "R=$REPLY"; done < fr → R=p/R=q
    fs.writeFile('/home/player/fr', 'p\nq\n')
    const r = await sh.exec('while read; do echo "R=$REPLY"; done < fr')
    expect(r.stdout).toBe('R=p\nR=q\n')
  })

  it('줄이어짐: read 가 \\+개행을 이어붙이고 커서는 소비한 물리 줄만큼 전진', async () => {
    // docker: printf 'a\\\nb\nc\n' > fj; while read x; do echo "got:[$x]"; done < fj → got:[ab]/got:[c]
    fs.writeFile('/home/player/fj', 'a\\\nb\nc\n')
    const r = await sh.exec('while read x; do echo "got:[$x]"; done < fj')
    expect(r.stdout).toBe('got:[ab]\ngot:[c]\n')
  })

  it('중첩 while read: 안쪽이 자기 파일 커서를 열고, 끝나면 바깥 커서가 복원된다', async () => {
    // docker: printf '1\n2\n' > outer; printf 'A\nB\n' > inner;
    //   while read x; do while read y; do echo "$x-$y"; done < inner; done < outer
    //   → 1-A/1-B/2-A/2-B
    fs.writeFile('/home/player/outer', '1\n2\n')
    fs.writeFile('/home/player/inner', 'A\nB\n')
    const r = await sh.exec('while read x; do while read y; do echo "$x-$y"; done < inner; done < outer')
    expect(r.stdout).toBe('1-A\n1-B\n2-A\n2-B\n')
  })

  it('for 본문 read 가 루프 커서를 한 줄씩 소비한다 (< file → for)', async () => {
    // 값 목록보다 줄이 많아도, for 반복 수(값 개수)만큼만 read 가 돈다.
    // docker: printf 'r1\nr2\nr3\n' > ff; for i in a b; do read v; echo "$i=$v"; done < ff → a=r1/b=r2
    fs.writeFile('/home/player/ff', 'r1\nr2\nr3\n')
    const r = await sh.exec('for i in a b; do read v; echo "$i=$v"; done < ff')
    expect(r.stdout).toBe('a=r1\nb=r2\n')
  })

  it('회귀: stdin 없는 while/for(비-read 본문)는 커서 도입 후에도 그대로', async () => {
    const r1 = await sh.exec('i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done')
    expect(r1.stdout).toBe('0\n1\n2\n')
    const r2 = await sh.exec('for x in a b c; do echo $x; done')
    expect(r2.stdout).toBe('a\nb\nc\n')
  })

  it('회귀: 파이프 read 격리 — echo x | read v 는 밖에 v 를 안 남긴다(커서 무관)', async () => {
    const r = await sh.exec('echo hi | read v; echo "[$v]"')
    expect(r.stdout).toBe('[]\n')
  })
})

describe('중첩 read 루프 — 자체 리다이렉션 없는 안쪽 루프는 바깥 fd0 커서를 공유한다 (task 6 리뷰 수정, docker debian:stable-slim bash 5.2 로 확인됨)', () => {
  it('버그 재현: while read x; do while read y; do …; done; done < f — 안쪽이 바깥 커서를 이어받아 진행한다', async () => {
    // docker: printf 'a\nb\nc\nd\n' > f;
    //   while read x; do while read y; do echo "$x=$y"; break; done; done < f
    //   → a=b / c=d (안쪽 while 은 자기 리다이렉션이 없어 바깥 fd0 커서를 그대로 공유 —
    //   고쳐지기 전엔 안쪽이 initialStdin='' 로 빈 커서를 새로 열어 본문이 아예 안 돈다)
    fs.writeFile('/home/player/f', 'a\nb\nc\nd\n')
    const r = await sh.exec('while read x; do while read y; do echo "$x=$y"; break; done; done < f')
    expect(r.stdout).toBe('a=b\nc=d\n')
  })

  it('버그 재현: while read x; do for i in 1; do read y; …; done; done < f — for 본문도 바깥 커서를 이어받는다', async () => {
    // docker: printf 'a\nb\nc\nd\n' > f2;
    //   while read x; do for i in 1; do read y; echo "$x-$y"; done; done < f2
    //   → a-b / c-d
    fs.writeFile('/home/player/f2', 'a\nb\nc\nd\n')
    const r = await sh.exec('while read x; do for i in 1; do read y; echo "$x-$y"; done; done < f2')
    expect(r.stdout).toBe('a-b\nc-d\n')
  })

  it('회귀: while read x; do … < emptyfile; done — 안쪽 자체 리다이렉션은 여전히 새 빈 커서(0회) — 바깥 커서를 이어받지 않는다', async () => {
    // 두 케이스(자체 리다이렉션 없음 vs `< emptyfile`)는 initialStdin 이 둘 다 '' 로 같지만
    // 정반대로 동작해야 한다 — 이 회귀가 "own source" 를 boolean 으로 스레딩해야 하는 이유다.
    fs.writeFile('/home/player/outer3', 'X\nY\n')
    fs.writeFile('/home/player/empty3', '')
    const r = await sh.exec(
      'while read x; do while read y; do echo "$x=$y"; done < empty3; echo "after:$x"; done < outer3',
    )
    expect(r.stdout).toBe('after:X\nafter:Y\n')
  })

  it('회귀: 파이프로 들어온 while(안쪽 아님, 최상위)은 여전히 파이프에서 새 커서를 연다', async () => {
    fs.writeFile('/home/player/nums3', '1\n2\n')
    const r = await sh.exec('cat nums3 | while read n; do echo "n=$n"; done')
    expect(r.stdout).toBe('n=1\nn=2\n')
  })
})

describe('B3: 루프 안 return 은 이전 반복 stdout 을 보존한다 (M3 Part 4 task 3, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('for 루프: return 이전 두 번의 echo 출력을 모두 낸다 (2 만 남던 버그)', async () => {
    // docker: f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && return; done; }; f → 1\n2
    const r = await sh.exec('f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && return; done; }; f')
    expect(r.stdout).toBe('1\n2\n')
  })

  it('while 루프: return 이전 출력을 보존한다', async () => {
    // docker: f(){ while true; do echo a; return; done; }; f → a
    const r = await sh.exec('f(){ while true; do echo a; return; done; }; f')
    expect(r.stdout).toBe('a\n')
  })

  it('for 루프: return 코드도 함께 보존된다 (exit code 는 신호 소비, stdout 은 누적)', async () => {
    // docker: f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && return 5; done; }; f; echo rc=$?
    //   → 1\n2\nrc=5
    const r = await sh.exec('f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && return 5; done; }; f; echo "rc=$?"')
    expect(r.stdout).toBe('1\n2\nrc=5\n')
  })

  it('회귀: 루프 없는 top-level return 은 그대로 동작한다', async () => {
    // docker: f(){ echo x; return 2; echo y; }; f; echo rc=$? → x\nrc=2
    const r = await sh.exec('f(){ echo x; return 2; echo y; }; f; echo "rc=$?"')
    expect(r.stdout).toBe('x\nrc=2\n')
  })

  it('회귀: break 는 여전히 부분 출력만 싣는다 (이전 반복과 합쳐 중복 없이)', async () => {
    // docker: f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && break; done; echo after; }; f
    //   → 1\n2\nafter
    const r = await sh.exec('f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && break; done; echo after; }; f')
    expect(r.stdout).toBe('1\n2\nafter\n')
  })

  it('회귀: continue 는 다음 반복으로 넘어가며 출력이 이중으로 안 쌓인다', async () => {
    // docker: f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && continue; echo skip$i; done; }; f
    //   → 1\nskip1\n2\n3\nskip3
    const r = await sh.exec(
      'f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && continue; echo skip$i; done; }; f',
    )
    expect(r.stdout).toBe('1\nskip1\n2\n3\nskip3\n')
  })
})

describe('B5: 디렉터리로 쓰기 리다이렉션은 EISDIR (M3 Part 4 task 3, docker debian:stable-slim bash 5 로 확인됨)', () => {
  it('echo x > / 는 exit 1, "Is a directory", 루트를 오염시키지 않는다', async () => {
    // docker: echo x > /; echo rc=$? → stderr "bash: line N: /: Is a directory", rc=1,
    //   ls / 앞뒤 동일(유령 노드 없음)
    const before = fs.readdir('/')
    const r = await sh.exec('echo x > /')
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('bash: /: Is a directory\n')
    expect(fs.readdir('/')).toEqual(before)
  })

  it('mkdir d; echo x > d 는 exit 1 (일반 디렉터리 타겟도 EISDIR, 회귀)', async () => {
    // docker: mkdir d; echo x > d → exit 1 "bash: line N: d: Is a directory"
    await sh.exec('mkdir d')
    const r = await sh.exec('echo x > d')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe('bash: d: Is a directory\n')
  })

  it('echo x >> / 도 exit 1 (append 경로 회귀)', async () => {
    const before = fs.readdir('/')
    const r = await sh.exec('echo x >> /')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe('bash: /: Is a directory\n')
    expect(fs.readdir('/')).toEqual(before)
  })

  it('회귀: echo x > f; cat f 는 정상 동작한다 (일반 파일 쓰기)', async () => {
    const r = await sh.exec('echo x > f; cat f')
    expect(r.stdout).toBe('x\n')
  })

  it('회귀: >> 로 파일에 이어쓰기는 정상 동작한다', async () => {
    const r = await sh.exec('echo x > f; echo y >> f; cat f')
    expect(r.stdout).toBe('x\ny\n')
  })
})
