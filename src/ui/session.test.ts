import { describe, it, expect, beforeEach } from 'vitest'
import { LocalShellSession } from './session'

let s: LocalShellSession
beforeEach(() => { s = new LocalShellSession() })

describe('LocalShellSession', () => {
  it('start 는 초기 스냅샷을 준다 (cwd=~, 엔트리 목록)', async () => {
    const snap = await s.start('l1-01')
    expect(snap.cwd).toBe('/home/player')
    expect(snap.cwdEntries).toContain('readme.txt')
  })
  it('정답 exec 는 solved=true 와 갱신된 스냅샷', async () => {
    await s.start('l1-01')
    const r = await s.exec('cat readme.txt')
    expect(r.solved).toBe(true)
    expect(r.stdout).toBe('ACCESS GRANTED\n')
  })
  it('오답 exec 는 solved=false', async () => {
    await s.start('l1-01')
    expect((await s.exec('ls')).solved).toBe(false)
  })
  it('cd 후 스냅샷의 cwd/entries 가 따라온다', async () => {
    await s.start('l1-03')            // vault 로 cd 하는 문제
    const r = await s.exec('cd vault')
    expect(r.snapshot.cwd).toBe('/home/player/vault')
  })
  it('reset 은 rm -rf 이후에도 복구', async () => {
    await s.start('l1-01')
    await s.exec('rm -rf readme.txt')
    const snap = await s.reset()
    expect(snap.cwdEntries).toContain('readme.txt')
  })
  it('check 가 던져도 exec 는 죽지 않는다 (solved=false)', async () => {
    // allProblems 중 하나로 start 후, rm -rf 로 fs 를 비워도 exec 가 resolve 하는지
    await s.start('l1-10')
    const r = await s.exec('rm -rf *')
    expect(r).toHaveProperty('solved')
  })
})
