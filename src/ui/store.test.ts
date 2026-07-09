import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useGame } from './store'
import { allProblems } from '../game/problems/index'

const get = () => useGame.getState()

beforeEach(() => {
  useGame.setState(useGame.getInitialState(), true)
})

describe('문제 진행', () => {
  it('문제를 시작하면 셸과 상태가 준비된다', () => {
    get().startProblem('l1-01')
    expect(get().problem?.id).toBe('l1-01')
    expect(get().shell).not.toBeNull()
    expect(get().status).toBe('playing')
    expect(get().screen).toBe('play')
  })

  it('정답 명령을 치면 solved 로 전이하고 진행도에 기록된다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    expect(get().status).toBe('solved')
    expect(get().signal).toBe('solved')
    expect(get().progress.solved).toContain('l1-01')
  })

  it('틀린 명령은 solved 로 가지 않는다', async () => {
    get().startProblem('l1-01')
    await get().submit('ls')
    expect(get().status).toBe('playing')
  })

  it('실패한 명령은 wrong 신호를 낸다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    expect(get().signal).toBe('wrong')
  })

  it('성공했지만 정답이 아닌 명령은 아무 신호도 내지 않는다', async () => {
    get().startProblem('l1-01')
    await get().submit('ls')
    expect(get().signal).toBe('idle')
  })

  it('solved 이후에는 다시 판정하지 않는다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    await get().submit('cat nope.txt')
    expect(get().status).toBe('solved')
  })

  it('stdout 은 green, stderr 는 amber 로 그려진다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    const tones = get().lines.map((l) => l.tone)
    expect(tones).toContain('amber')
  })

  it('check() 가 던져도 게임은 죽지 않고, 경고만 남긴다', async () => {
    get().startProblem('l1-01')
    const buggyCheck = () => { throw new Error('출제자의 버그') }
    useGame.setState({ problem: { ...get().problem!, check: buggyCheck } })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(get().submit('cat readme.txt')).resolves.toBeUndefined()

    expect(get().status).toBe('playing') // 안 풀린 것으로 처리된다
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('l1-01')
    warn.mockRestore()
  })
})

describe('게임 명령', () => {
  it('clear 는 화면만 지우고 셸은 유지한다', async () => {
    get().startProblem('l1-03')
    await get().submit('cd vault')
    await get().submit('clear')
    expect(get().lines).toEqual([])
    expect(get().shell!.cwd).toBe('/home/player/vault')
  })

  it('reset 은 문제를 초기 상태로 되돌린다', async () => {
    get().startProblem('l1-03')
    await get().submit('cd vault')
    get().resetProblem()
    expect(get().shell!.cwd).toBe('/home/player')
    expect(get().status).toBe('playing')
  })

  it('rm -rf 로 세계를 지운 뒤 reset 하면 복구된다', async () => {
    get().startProblem('l1-01')
    await get().submit('rm -rf readme.txt')
    get().resetProblem()
    expect(get().shell!.fs.exists('/home/player/readme.txt')).toBe(true)
  })
})

describe('힌트', () => {
  it('처음에는 아무 힌트도 안 보인다', () => {
    get().startProblem('l1-01')
    expect(get().hintsShown).toBe(0)
  })

  it('요청할 때마다 하나씩 늘어나고 힌트 수를 넘지 않는다', () => {
    get().startProblem('l1-01')
    const total = get().problem!.hints.length
    for (let i = 0; i < total + 3; i++) get().revealHint()
    expect(get().hintsShown).toBe(total)
  })

  it('힌트를 보면 진행도에 기록된다', () => {
    get().startProblem('l1-01')
    get().revealHint()
    expect(get().progress.hintsUsed).toContain('l1-01')
  })
})

describe('프롬프트와 자동완성', () => {
  it('홈에서는 ~ 로 표시한다', () => {
    get().startProblem('l1-01')
    expect(get().prompt()).toBe('player@flashshell:~$ ')
  })

  it('하위 디렉터리는 ~/ 로 표시한다', async () => {
    get().startProblem('l1-03')
    await get().submit('cd vault')
    expect(get().prompt()).toBe('player@flashshell:~/vault$ ')
  })

  it('첫 단어는 명령 이름을 완성한다', () => {
    get().startProblem('l1-01')
    expect(get().completions('ec')).toContain('echo')
  })

  it('두 번째 단어부터는 파일 이름을 완성한다', () => {
    get().startProblem('l1-01')
    expect(get().completions('read')).toContain('readme.txt')
  })

  it('cwd 가 밖에서 지워져도 completions 는 던지지 않는다', async () => {
    get().startProblem('l1-03')
    await get().submit('cd vault')
    // vault 안에 있는 채로, 밖에서 상대경로로 vault 자체를 지운다 — cwd 는
    // 이제 존재하지 않는 경로를 가리킨다. readdir(cwd) 는 ENOENT 를 던진다.
    await get().submit('rm -rf ../vault')
    expect(get().shell!.fs.exists('/home/player/vault')).toBe(false)
    expect(() => get().completions('')).not.toThrow()
    // 파일 후보는 없지만, 명령 이름 후보는 여전히 나와야 한다.
    expect(get().completions('ec')).toContain('echo')
  })
})

describe('signalTick', () => {
  it('초기 상태에서 0 이다', () => {
    expect(get().signalTick).toBe(0)
  })

  it('getInitialState() 도 0 이다', () => {
    expect(useGame.getInitialState().signalTick).toBe(0)
  })

  it('signal 을 쓸 때마다 증가한다 — wrong → wrong 재발도 포함해서', async () => {
    get().startProblem('l1-01')
    const afterStart = get().signalTick

    await get().submit('cat nope.txt')
    expect(get().signal).toBe('wrong')
    const afterFirstWrong = get().signalTick
    expect(afterFirstWrong).toBeGreaterThan(afterStart)

    await get().submit('cat nope2.txt')
    expect(get().signal).toBe('wrong') // 값은 그대로: wrong → wrong
    const afterSecondWrong = get().signalTick
    expect(afterSecondWrong).toBeGreaterThan(afterFirstWrong)
  })

  it('signal 을 건드리지 않는 쓰기(revealHint)는 증가시키지 않는다', () => {
    get().startProblem('l1-01')
    const before = get().signalTick
    get().revealHint()
    expect(get().signalTick).toBe(before)
  })

  it('clearSignal() 은 signal 을 쓰므로 증가시킨다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    expect(get().signal).toBe('wrong')
    const before = get().signalTick

    get().clearSignal()
    expect(get().signal).toBe('idle')
    expect(get().signalTick).toBeGreaterThan(before)
  })

  it('signal 이 이미 wrong 이 아니면 clearSignal() 은 아무것도 안 쓰므로 증가하지 않는다', () => {
    get().startProblem('l1-01')
    expect(get().signal).toBe('idle')
    const before = get().signalTick

    get().clearSignal()
    expect(get().signalTick).toBe(before)
  })
})

describe('다음 문제', () => {
  it('같은 레벨의 다음 문제로 넘어간다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    get().nextProblem()
    expect(get().problem?.id).toBe('l1-02')
  })

  it('레벨의 마지막 문제에서는 레벨 선택으로 돌아간다', async () => {
    const last = allProblems.filter((p) => p.level === 1).at(-1)!
    get().startProblem(last.id)
    get().nextProblem()
    expect(get().screen).toBe('levels')
  })
})
