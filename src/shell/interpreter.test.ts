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
    return { cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' }, lastExitCode: 0, home: '/home/player' }
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
