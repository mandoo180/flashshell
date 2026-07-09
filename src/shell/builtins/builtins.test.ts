import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from '../vfs'
import type { CommandEnv, ShellState } from '../types'
import { builtins } from './index'

let fs: VFS
let state: ShellState

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/home/player/docs', { recursive: true })
  state = { cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' }, lastExitCode: 0, home: '/home/player' }
})

const env = (name: string, args: string[], stdin = ''): CommandEnv =>
  ({ name, args, stdin, stdinFromFile: false, fs, state })
const run = (name: string, ...args: string[]) => builtins[name]!(env(name, args))

describe('cd', () => {
  it('상대경로로 이동한다', async () => {
    await run('cd', 'docs')
    expect(state.cwd).toBe('/home/player/docs')
  })
  it('인자가 없으면 홈으로 간다', async () => {
    state.cwd = '/'
    await run('cd')
    expect(state.cwd).toBe('/home/player')
  })
  it('cd - 는 직전 디렉터리로 가고 그 경로를 출력한다', async () => {
    await run('cd', 'docs')
    const out = await run('cd', '-')
    expect(state.cwd).toBe('/home/player')
    expect(out.stdout).toBe('/home/player\n')
  })
  it('cd (인자 있음) 는 아무것도 출력하지 않는다', async () => {
    const out = await run('cd', 'docs')
    expect(out.stdout).toBe('')
  })
  it('cd a; cd b; cd -; cd - 는 마지막 두 디렉터리를 오간다', async () => {
    // 절대경로를 쓴다: 'cd a' 뒤에 상대경로로 'cd b'를 하면 새 cwd(/home/player/a)
    // 기준으로 풀려 /home/player/a/b를 찾게 되어 이 테스트의 의도(최상위 두
    // 디렉터리를 오가는 것)와 어긋난다. docker로 확인한 실제 bash 시나리오도
    // 절대경로였다.
    fs.mkdir('/home/player/a')
    fs.mkdir('/home/player/b')
    await run('cd', '/home/player/a')
    await run('cd', '/home/player/b')
    const first = await run('cd', '-')
    expect(state.cwd).toBe('/home/player/a')
    expect(first.stdout).toBe('/home/player/a\n')
    const second = await run('cd', '-')
    expect(state.cwd).toBe('/home/player/b')
    expect(second.stdout).toBe('/home/player/b\n')
  })
  it('없는 디렉터리는 실패한다', async () => {
    const out = await run('cd', 'nope')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('No such file or directory')
    expect(state.cwd).toBe('/home/player')
  })
  it('파일로 cd 하면 Not a directory', async () => {
    fs.writeFile('/home/player/f', '')
    const out = await run('cd', 'f')
    expect(out.stderr).toContain('Not a directory')
  })
  it('cd 는 state.env.PWD 를 갱신한다', async () => {
    await run('cd', 'docs')
    expect(state.env.PWD).toBe('/home/player/docs')
  })
  it('cd - 로 사라진 OLDPWD에 진입 시 실제 경로를 오류에 명시한다', async () => {
    // /home/player/gone 에 cd 한 후 다시 나온 다음 디렉터리를 삭제
    fs.mkdir('/home/player/gone')
    await run('cd', '/home/player/gone')
    await run('cd', '/home/player')
    fs.rm('/home/player/gone', { recursive: true })
    // cd - 시도: 오류에는 실제 경로 /home/player/gone 이 명시되어야 함
    const out = await run('cd', '-')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('cd: /home/player/gone: No such file or directory\n')
    // cwd 는 변경되지 않아야 함
    expect(state.cwd).toBe('/home/player')
  })
  it('cd nope 실패 시에는 여전히 raw 인자(nope)를 오류에 명시한다', async () => {
    const out = await run('cd', 'nope')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('cd: nope: No such file or directory\n')
  })
  it('cd - 로 파일이 된 OLDPWD에 진입 시 실제 경로를 오류에 명시한다', async () => {
    // /home/player/wasdir 이라는 디렉터리 생성
    fs.mkdir('/home/player/wasdir')
    await run('cd', '/home/player/wasdir')
    await run('cd', '/home/player')
    // 이제 /home/player/wasdir 을 파일로 대체
    fs.rm('/home/player/wasdir', { recursive: true })
    fs.writeFile('/home/player/wasdir', 'now a file')
    // cd - 시도: 오류에는 실제 경로 /home/player/wasdir 이 명시되어야 함
    const out = await run('cd', '-')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('cd: /home/player/wasdir: Not a directory\n')
    // cwd 는 변경되지 않아야 함
    expect(state.cwd).toBe('/home/player')
  })
})

describe('pwd', () => {
  it('현재 디렉터리를 출력한다', async () => {
    expect((await run('pwd')).stdout).toBe('/home/player\n')
  })
})

describe('echo', () => {
  it('인자를 공백으로 이어 출력하고 개행을 붙인다', async () => {
    expect((await run('echo', 'a', 'b')).stdout).toBe('a b\n')
  })
  it('-n 은 개행을 생략한다', async () => {
    expect((await run('echo', '-n', 'a')).stdout).toBe('a')
  })
  it('-e 는 \\n 을 해석한다', async () => {
    expect((await run('echo', '-e', 'a\\nb')).stdout).toBe('a\nb\n')
  })
  it('-e 없이는 \\n 을 문자 그대로 둔다', async () => {
    expect((await run('echo', 'a\\nb')).stdout).toBe('a\\nb\n')
  })
  it('인자가 없으면 빈 줄', async () => {
    expect((await run('echo')).stdout).toBe('\n')
  })
  it('-n 인자가 없으면 아무것도 출력하지 않는다', async () => {
    expect((await run('echo', '-n')).stdout).toBe('')
  })
  it('플래그는 순서와 무관하게 둘 다 적용된다: -n -e', async () => {
    expect((await run('echo', '-n', '-e', 'x')).stdout).toBe('x')
  })
  it('플래그는 순서와 무관하게 둘 다 적용된다: -e -n', async () => {
    expect((await run('echo', '-e', '-n', 'x')).stdout).toBe('x')
  })
  it('데이터 뒤에 오는 -n 은 플래그가 아니라 문자 그대로다', async () => {
    expect((await run('echo', 'x', '-n')).stdout).toBe('x -n\n')
  })
  it('결합 플래그 -en 은 -e 와 -n 을 함께 적용한다', async () => {
    expect((await run('echo', '-en', 'a\\nb')).stdout).toBe('a\nb')
  })
  it('결합 플래그 -ne 도 동일하다', async () => {
    expect((await run('echo', '-ne', 'a\\nb')).stdout).toBe('a\nb')
  })
  it('\\\\ 뒤의 n 은 개행으로 재해석되지 않는다 (이스케이프 순서)', async () => {
    // bash: echo -e 'a\\nb' (작은따옴표 안 원문 그대로: a, \, \, n, b) → "a\nb" 리터럴 백슬래시
    expect((await run('echo', '-e', 'a\\\\nb')).stdout).toBe('a\\nb\n')
  })
  it('\\t 를 탭으로 해석한다', async () => {
    expect((await run('echo', '-e', 'a\\tb')).stdout).toBe('a\tb\n')
  })
})

describe('export / unset', () => {
  it('export NAME=value 는 env 에 넣는다', async () => {
    await run('export', 'FOO=bar')
    expect(state.env.FOO).toBe('bar')
  })
  it('export NAME (값 없음) 은 크래시하지 않고 새 변수를 만들지도 않는다', async () => {
    const out = await run('export', 'FOO')
    expect(out.exitCode).toBe(0)
    expect(state.env.FOO).toBeUndefined()
  })
  it('unset 은 지운다', async () => {
    state.env.FOO = 'bar'
    await run('unset', 'FOO')
    expect(state.env.FOO).toBeUndefined()
  })
  it('unset 은 없는 이름에도 조용히 exit 0', async () => {
    const out = await run('unset', 'NOPE')
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe('')
  })
})

describe('true / false / :', () => {
  it('true 는 0', async () => { expect((await run('true')).exitCode).toBe(0) })
  it('false 는 1', async () => { expect((await run('false')).exitCode).toBe(1) })
  it(': 는 0', async () => { expect((await run(':')).exitCode).toBe(0) })
  it('true 는 아무것도 출력하지 않는다', async () => {
    const out = await run('true')
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe('')
  })
  it('false 는 아무것도 출력하지 않는다', async () => {
    const out = await run('false')
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe('')
  })
})
