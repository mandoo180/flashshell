import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  it('check 함수가 throws 해도 exec 는 해결되며 solved=false, 스냅샷 유효', async () => {
    // 출제자 버그 (check에서 throw)로부터 플레이어 세션을 보호하는지 확인
    await s.start('l1-01')

    // private problem 필드 접근 및 원본 check 저장
    const sessionTyped = s as unknown as { problem: { check: unknown } }
    const originalCheck = sessionTyped.problem.check

    // console.warn 스파이 & 억제 (의도적 경고 테스트 출력 방지)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // check 를 던지는 함수로 교체
      sessionTyped.problem.check = () => {
        throw new Error('boom')
      }

      // exec 는 resolve 되어야 하며 solved=false 를 반환
      const r = await s.exec('ls')
      expect(r.solved).toBe(false)
      expect(r.snapshot.cwd).toBe('/home/player')
      expect(r.snapshot.cwdEntries).toBeDefined()
    } finally {
      // 다른 테스트 오염 방지: 원본 check 복구
      sessionTyped.problem.check = originalCheck
      warnSpy.mockRestore()
    }
  })
})
