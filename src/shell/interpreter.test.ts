import { describe, it, expect, beforeEach } from 'vitest'
import { createShell } from './index'
import { run } from './interpreter'
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
    return { cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' }, lastExitCode: 0, home: '/home/player', functions: new Map() }
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
      lastExitCode: 0, home: '/home/player', functions: new Map(),
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
