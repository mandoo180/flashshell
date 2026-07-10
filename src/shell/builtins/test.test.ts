import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from '../vfs'
import type { CommandEnv, ShellState } from '../types'
import { builtins } from './index'

/**
 * 모든 기대값은 `docker run --rm debian:stable-slim bash -c '...'`(bash 5.2.37,
 * coreutils 아님 — test/[ 는 bash 빌트인)로 실측했다. 아래 표는 task-2-report.md에도
 * 정리돼 있다. 여기서는 각 case 주석에 실측 exit code만 남긴다.
 */

let fs: VFS
let state: ShellState

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/home/player', { recursive: true })
  state = { cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' }, lastExitCode: 0, home: '/home/player' }
})

const env = (name: string, args: string[]): CommandEnv =>
  ({ name, args, stdin: '', stdinFromFile: false, fs, state })
const run = (name: string, ...args: string[]) => builtins[name]!(env(name, args))
const runTest = (...args: string[]) => run('test', ...args)
const runBracket = (...args: string[]) => run('[', ...args, ']')

describe('test / [ 등록', () => {
  it('builtins 표에 test 와 [ 둘 다 있다', () => {
    expect(builtins.test).toBeDefined()
    expect(builtins['[']).toBeDefined()
  })
})

describe('파일 술어', () => {
  beforeEach(() => {
    fs.writeFile('/home/player/a', 'hello')
    fs.mkdir('/home/player/dir')
    fs.writeFile('/home/player/empty', '')
    fs.writeFile('/home/player/exec', 'echo hi', 0o755)
    fs.writeFile('/home/player/noexec', 'echo hi', 0o644)
    fs.writeFile('/home/player/noperm', 'x', 0o000)
  })

  it('-e: 존재하면 0, 없으면 1', async () => {
    expect((await runTest('-e', 'a')).exitCode).toBe(0)
    expect((await runTest('-e', 'nope')).exitCode).toBe(1)
  })

  it('-f: 일반 파일이면 0', async () => {
    expect((await runTest('-f', 'a')).exitCode).toBe(0)
  })
  it('-f: 디렉터리면 1', async () => {
    expect((await runTest('-f', 'dir')).exitCode).toBe(1)
  })
  it('-f: 없으면 1 (오류가 아니다)', async () => {
    const out = await runTest('-f', 'nope')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('')
  })

  it('-d: 디렉터리면 0, 파일이면 1', async () => {
    expect((await runTest('-d', 'dir')).exitCode).toBe(0)
    expect((await runTest('-d', 'a')).exitCode).toBe(1)
  })

  it('-r/-w: VFS 에서는 존재하면 항상 참이다 (권한 비트 무관, mode 000 이어도) — docker root 실측과 동일', async () => {
    expect((await runTest('-r', 'noperm')).exitCode).toBe(0)
    expect((await runTest('-w', 'noperm')).exitCode).toBe(0)
    expect((await runTest('-r', 'nope')).exitCode).toBe(1)
  })

  it('-x: mode & 0o111 로 판정', async () => {
    expect((await runTest('-x', 'exec')).exitCode).toBe(0)
    expect((await runTest('-x', 'noexec')).exitCode).toBe(1)
    expect((await runTest('-x', 'dir')).exitCode).toBe(0) // 0o755 & 0o111 != 0
  })

  it('-s: 크기>0 이면 0, 빈 파일이면 1', async () => {
    expect((await runTest('-s', 'a')).exitCode).toBe(0)
    expect((await runTest('-s', 'empty')).exitCode).toBe(1)
    expect((await runTest('-s', 'nope')).exitCode).toBe(1)
  })

  it('상대경로는 state.cwd 기준으로 푼다', async () => {
    fs.mkdir('/home/player/sub')
    fs.writeFile('/home/player/sub/f', 'x')
    state.cwd = '/home/player/sub'
    expect((await runTest('-f', 'f')).exitCode).toBe(0)
    expect((await runTest('-f', '../a')).exitCode).toBe(0)
  })
})

describe('문자열 술어', () => {
  it('-z: 빈 문자열이면 0', async () => {
    expect((await runTest('-z', '')).exitCode).toBe(0)
  })
  it('-z: 비어있지 않으면 1', async () => {
    expect((await runTest('-z', 'x')).exitCode).toBe(1)
  })
  it('-n: 비어있지 않으면 0', async () => {
    expect((await runTest('-n', 'x')).exitCode).toBe(0)
  })
  it('-n: 빈 문자열이면 1', async () => {
    expect((await runTest('-n', '')).exitCode).toBe(1)
  })
  it('단일 인자(bare): 비어있지 않으면 0, 빈 문자열이면 1', async () => {
    expect((await runTest('x')).exitCode).toBe(0)
    expect((await runTest('')).exitCode).toBe(1)
  })
  it('단일 인자: 연산자처럼 보여도(-f, -z, =, !=, !) 리터럴 문자열로 취급 → 참', async () => {
    expect((await runTest('-f')).exitCode).toBe(0)
    expect((await runTest('-z')).exitCode).toBe(0)
    expect((await runTest('=')).exitCode).toBe(0)
    expect((await runTest('!=')).exitCode).toBe(0)
    expect((await runTest('!')).exitCode).toBe(0)
  })
  it('인자가 아예 없으면 거짓(1), 오류 아님', async () => {
    const out = await runTest()
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('')
  })
  it('S1 = S2', async () => {
    expect((await runTest('x', '=', 'x')).exitCode).toBe(0)
    expect((await runTest('x', '=', 'y')).exitCode).toBe(1)
    expect((await runTest('', '=', '')).exitCode).toBe(0)
  })
  it('S1 != S2', async () => {
    expect((await runTest('x', '!=', 'y')).exitCode).toBe(0)
    expect((await runTest('x', '!=', 'x')).exitCode).toBe(1)
  })
})

describe('정수 술어', () => {
  it('-eq/-ne/-lt/-le/-gt/-ge', async () => {
    expect((await runTest('3', '-eq', '3')).exitCode).toBe(0)
    expect((await runTest('3', '-ne', '3')).exitCode).toBe(1)
    expect((await runTest('3', '-lt', '5')).exitCode).toBe(0)
    expect((await runTest('5', '-lt', '3')).exitCode).toBe(1)
    expect((await runTest('3', '-le', '3')).exitCode).toBe(0)
    expect((await runTest('3', '-ge', '3')).exitCode).toBe(0)
    expect((await runTest('5', '-gt', '3')).exitCode).toBe(0)
  })
  it('공백/부호가 있어도 정수로 인정 (docker 실측: " 3", "3 ", "+3", "-3" 모두 통과)', async () => {
    expect((await runTest('+3', '-lt', '5')).exitCode).toBe(0)
    expect((await runTest('-3', '-lt', '5')).exitCode).toBe(0)
    expect((await runTest(' 3', '-lt', '5')).exitCode).toBe(0)
    expect((await runTest('3 ', '-lt', '5')).exitCode).toBe(0)
  })
  it('선행 0은 8진수가 아니라 10진수로 취급한다 (docker 실측: 010 -eq 10 → 참)', async () => {
    expect((await runTest('010', '-eq', '10')).exitCode).toBe(0)
    expect((await runTest('010', '-eq', '8')).exitCode).toBe(1)
  })
  it('비정수 피연산자 → exit 2, bash 문구 그대로(피연산자 이름 포함)', async () => {
    const out1 = await runTest('3', '-lt', 'abc')
    expect(out1.exitCode).toBe(2)
    expect(out1.stderr).toBe('bash: test: abc: integer expression expected\n')

    const out2 = await runTest('abc', '-lt', '3')
    expect(out2.exitCode).toBe(2)
    expect(out2.stderr).toBe('bash: test: abc: integer expression expected\n')
  })
  it('[ 로 호출하면 프리픽스가 [: 이다', async () => {
    const out = await runBracket('3', '-lt', 'abc')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('bash: [: abc: integer expression expected\n')
  })
  it('소수점은 정수가 아니다 → exit 2 (docker 실측)', async () => {
    expect((await runTest('3.5', '-lt', '5')).exitCode).toBe(2)
  })
  it('16진수 표기는 정수가 아니다 → exit 2 (docker 실측)', async () => {
    expect((await runTest('0x10', '-eq', '16')).exitCode).toBe(2)
  })
})

describe('부정 (!)', () => {
  it('! -f nope → 참(0)', async () => {
    expect((await runTest('!', '-f', 'nope')).exitCode).toBe(0)
  })
  it('! -f a (존재하는 파일) → 거짓(1)', async () => {
    fs.writeFile('/home/player/a', 'x')
    expect((await runTest('!', '-f', 'a')).exitCode).toBe(1)
  })
  it('! x = y → 참(0), ! x = x → 거짓(1) (docker 실측)', async () => {
    expect((await runTest('!', 'x', '=', 'y')).exitCode).toBe(0)
    expect((await runTest('!', 'x', '=', 'x')).exitCode).toBe(1)
  })
  it('! 3 -lt 5 → 거짓(1) (docker 실측)', async () => {
    expect((await runTest('!', '3', '-lt', '5')).exitCode).toBe(1)
  })
})

describe('[ 는 마지막 인자로 ] 가 필요하다', () => {
  it('] 가 없으면 exit 2 + bash 문구 그대로', async () => {
    const out = await run('[', '-f', 'a')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe("bash: [: missing `]'\n")
  })
  it('인자가 아예 없어도(그냥 [) exit 2 (docker 실측)', async () => {
    const out = await run('[')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe("bash: [: missing `]'\n")
  })
  it('] 로 끝나면 정상 평가', async () => {
    const out = await runBracket('3', '-lt', '5')
    expect(out.exitCode).toBe(0)
  })
})

describe('true/false 는 stdout 을 절대 만들지 않는다', () => {
  it('참: exit 0, stdout/stderr 둘 다 비어있다', async () => {
    const out = await runTest('x')
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe('')
  })
  it('거짓: exit 1, stdout/stderr 둘 다 비어있다 (오류 아님)', async () => {
    const out = await runTest('', '=', 'x')
    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe('')
  })
})

describe('-a / -o 결합자는 서브셋 밖 — 만나면 거부(절대 반쪽 구현 X)', () => {
  it('3항에서 -a/-o 는 flashshell: 로 거부, exit 2', async () => {
    const out = await runTest('1', '-a', '1')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('flashshell:')
  })
  it('-o 도 동일', async () => {
    const out = await runTest('1', '-o', '0')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('flashshell:')
  })
})

describe('그 외 오류 경로 (docker 로 문구·exit code 확인)', () => {
  it('2항에서 알 수 없는 연산자 → unary operator expected, exit 2', async () => {
    const out = await runTest('foo', 'bar')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('bash: test: foo: unary operator expected\n')
  })
  it('3항에서 가운데가 알 수 없는 연산자 → binary operator expected, exit 2', async () => {
    const out = await runTest('a', 'b', 'c')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('bash: test: b: binary operator expected\n')
  })
  it('4항 이상(결합자 없이) → too many arguments, exit 2', async () => {
    const out = await runTest('a', 'b', 'c', 'd')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('bash: test: too many arguments\n')
  })
})
