import { describe, it, expect } from 'vitest'
import { VFS } from './vfs'
import { lookupCommand, isKnownUnimplemented, commandNames } from './registry'

describe('registry', () => {
  it('빌트인을 찾는다', () => {
    expect(lookupCommand('cd')).toBeTypeOf('function')
    expect(lookupCommand('echo')).toBeTypeOf('function')
  })

  it('없는 명령은 undefined', () => {
    expect(lookupCommand('rsyncc')).toBeUndefined()
  })

  it('진짜 리눅스에 있지만 우리가 안 만든 명령을 구별한다', () => {
    expect(isKnownUnimplemented('find')).toBe(true)
    expect(isKnownUnimplemented('tar')).toBe(true)
  })

  it('우리가 만든 명령은 미구현이 아니다', () => {
    expect(isKnownUnimplemented('echo')).toBe(false)
  })

  it('오타는 미구현이 아니라 그냥 없는 명령이다', () => {
    expect(isKnownUnimplemented('sedd')).toBe(false)
  })

  it('commandNames 는 정렬된 이름을 준다', () => {
    const names = commandNames()
    expect(names).toContain('echo')
    expect([...names].sort()).toEqual(names)
  })

  it('commandNames 에는 중복이 없다', () => {
    const names = commandNames()
    expect(new Set(names).size).toBe(names.length)
  })

  it('type 은 레지스트리가 제공한다', () => {
    expect(lookupCommand('type')).toBeTypeOf('function')
    expect(commandNames()).toContain('type')
  })
})

describe('type', () => {
  const run = (...args: string[]) =>
    lookupCommand('type')!({
      name: 'type', args, stdin: '', stdinFromFile: false,
      fs: new VFS(),
      state: { cwd: '/', oldPwd: '/', env: {}, lastExitCode: 0, home: '/' },
    })

  it('빌트인을 빌트인이라 말한다', async () => {
    expect((await run('cd')).stdout).toBe('cd is a shell builtin\n')
  })

  it('coreutil 은 경로로 말한다', async () => {
    expect((await run('cat')).stdout).toBe('cat is /usr/bin/cat\n')
  })

  it('없는 명령은 실패한다', async () => {
    const out = await run('nope')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('not found')
  })

  it('인자 없이 호출하면 조용히 exit 0', async () => {
    const out = await run()
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe('')
  })
})
