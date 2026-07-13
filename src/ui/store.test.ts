import { describe, it, expect, beforeEach } from 'vitest'
import { useGame, setSessionFactory } from './store'
import { LocalShellSession, type ShellSession, type StateSnapshot, type ExecResponse } from './session'
import { allProblems } from '../game/problems/index'

const get = () => useGame.getState()

beforeEach(() => {
  // 기본 팩토리는 WorkerShellSession(new Worker(...))을 만든다 — node/jsdom 둘 다
  // Worker가 없으므로, 스토어를 구동하는 모든 테스트는 인프로세스 세션을 주입해야
  // 한다. (jsdom 프로젝트의 Play.test.tsx/signal.test.tsx도 동일한 이유로 주입한다.)
  setSessionFactory(() => new LocalShellSession())
  useGame.setState(useGame.getInitialState(), true)
})

describe('문제 진행', () => {
  it('문제를 시작하면 세션과 상태가 준비된다', async () => {
    await get().startProblem('l1-01')
    expect(get().problem?.id).toBe('l1-01')
    expect(get().session).not.toBeNull()
    expect(get().cwd).toBe('/home/player')
    expect(get().status).toBe('playing')
    expect(get().screen).toBe('play')
  })

  it('정답 명령을 치면 solved 로 전이하고 진행도에 기록된다', async () => {
    await get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    expect(get().status).toBe('solved')
    expect(get().signal).toBe('solved')
    expect(get().progress.solved).toContain('l1-01')
  })

  it('틀린 명령은 solved 로 가지 않는다', async () => {
    await get().startProblem('l1-01')
    await get().submit('ls')
    expect(get().status).toBe('playing')
  })

  it('실패한 명령은 wrong 신호를 낸다', async () => {
    await get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    expect(get().signal).toBe('wrong')
  })

  it('성공했지만 정답이 아닌 명령은 아무 신호도 내지 않는다', async () => {
    await get().startProblem('l1-01')
    await get().submit('ls')
    expect(get().signal).toBe('idle')
  })

  it('solved 이후에는 다시 판정하지 않는다', async () => {
    await get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    await get().submit('cat nope.txt')
    expect(get().status).toBe('solved')
  })

  it('stdout 은 green, stderr 는 amber 로 그려진다', async () => {
    await get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    const tones = get().lines.map((l) => l.tone)
    expect(tones).toContain('amber')
  })
})

describe('게임 명령', () => {
  it('clear 는 화면만 지우고 셸은 유지한다', async () => {
    await get().startProblem('l1-03')
    await get().submit('cd vault')
    await get().submit('clear')
    expect(get().lines).toEqual([])
    expect(get().cwd).toBe('/home/player/vault')
  })

  it('reset 은 문제를 초기 상태로 되돌린다', async () => {
    await get().startProblem('l1-03')
    await get().submit('cd vault')
    await get().resetProblem()
    expect(get().cwd).toBe('/home/player')
    expect(get().status).toBe('playing')
  })

  it('rm -rf 로 세계를 지운 뒤 reset 하면 복구된다', async () => {
    await get().startProblem('l1-01')
    await get().submit('rm -rf readme.txt')
    await get().resetProblem()
    // shell.fs.exists를 직접 찌르던 자리를, 세션의 마지막 스냅샷 미러
    // (cwdEntries)로 대신한다 — reset 뒤 readme.txt가 cwd 목록에 다시 나타나면
    // 세계가 복구된 것이다.
    expect(get().cwdEntries).toContain('readme.txt')
  })
})

describe('힌트', () => {
  it('처음에는 아무 힌트도 안 보인다', async () => {
    await get().startProblem('l1-01')
    expect(get().hintsShown).toBe(0)
  })

  it('요청할 때마다 하나씩 늘어나고 힌트 수를 넘지 않는다', async () => {
    await get().startProblem('l1-01')
    const total = get().problem!.hints.length
    for (let i = 0; i < total + 3; i++) get().revealHint()
    expect(get().hintsShown).toBe(total)
  })

  it('힌트를 보면 진행도에 기록된다', async () => {
    await get().startProblem('l1-01')
    get().revealHint()
    expect(get().progress.hintsUsed).toContain('l1-01')
  })
})

describe('프롬프트와 자동완성', () => {
  it('홈에서는 ~ 로 표시한다', async () => {
    await get().startProblem('l1-01')
    expect(get().prompt()).toBe('player@flashshell:~$ ')
  })

  it('하위 디렉터리는 ~/ 로 표시한다', async () => {
    await get().startProblem('l1-03')
    await get().submit('cd vault')
    expect(get().prompt()).toBe('player@flashshell:~/vault$ ')
  })

  it('첫 단어는 명령 이름을 완성한다', async () => {
    await get().startProblem('l1-01')
    expect(get().completions('ec')).toContain('echo')
  })

  it('두 번째 단어부터는 파일 이름을 완성한다', async () => {
    await get().startProblem('l1-01')
    expect(get().completions('read')).toContain('readme.txt')
  })

  it('cwd 가 밖에서 지워져도 completions 는 던지지 않는다', async () => {
    await get().startProblem('l1-03')
    await get().submit('cd vault')
    // vault 안에 있는 채로, 밖에서 상대경로로 vault 자체를 지운다 — 셸의 cwd 문자열은
    // 이제 존재하지 않는 경로를 가리킨다. 세션의 snapshot()은 그 readdir(cwd)
    // ENOENT를 삼키고 cwdEntries=[]로 미러링한다(store는 더 이상 fs를 직접 만지지
    // 않으므로 던질 방법이 없다 — 그래도 미러가 실제로 빈 배열로 복구되는지,
    // 그리고 completions가 그 상태에서도 명령 후보는 계속 내는지를 못박는다).
    await get().submit('rm -rf ../vault')
    expect(get().cwdEntries).toEqual([])
    expect(() => get().completions('')).not.toThrow()
    // 파일 후보는 없지만, 명령 이름 후보는 여전히 나와야 한다.
    expect(get().completions('ec')).toContain('echo')

    // vault가 실제로 사라졌는지: 부모로 나가서 다시 목록을 받아보면(lobby는
    // 남아있고 vault는 없어야) fs.exists를 직접 찌르던 원래 단언과 동치다.
    await get().submit('cd ..')
    expect(get().cwdEntries).toContain('lobby')
    expect(get().cwdEntries).not.toContain('vault')
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
    await get().startProblem('l1-01')
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

  it('signal 을 건드리지 않는 쓰기(revealHint)는 증가시키지 않는다', async () => {
    await get().startProblem('l1-01')
    const before = get().signalTick
    get().revealHint()
    expect(get().signalTick).toBe(before)
  })

  it('clearSignal() 은 signal 을 쓰므로 증가시킨다', async () => {
    await get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    expect(get().signal).toBe('wrong')
    const before = get().signalTick

    get().clearSignal()
    expect(get().signal).toBe('idle')
    expect(get().signalTick).toBeGreaterThan(before)
  })

  it('signal 이 이미 wrong 이 아니면 clearSignal() 은 아무것도 안 쓰므로 증가하지 않는다', async () => {
    await get().startProblem('l1-01')
    expect(get().signal).toBe('idle')
    const before = get().signalTick

    get().clearSignal()
    expect(get().signalTick).toBe(before)
  })
})

describe('다음 문제', () => {
  it('같은 레벨의 다음 문제로 넘어간다', async () => {
    await get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    await get().nextProblem()
    expect(get().problem?.id).toBe('l1-02')
  })

  it('레벨의 마지막 문제에서는 레벨 선택으로 돌아간다', async () => {
    const last = allProblems.filter((p) => p.level === 1).at(-1)!
    await get().startProblem(last.id)
    await get().nextProblem()
    expect(get().screen).toBe('levels')
  })
})

// openLevel 은 내부적으로 void startProblem(...) 을 fire-and-forget 으로 큐에
// 실을 뿐 자신은 여전히 동기다 — 세션의 start()가 실제로는 마이크로태스크 한
// 틱 뒤에 resolve 되므로(signal.test.tsx의 clickLevel1 과 동일한 이유), 결과
// 상태를 보려면 대기 중인 프로미스 체인을 한 번 흘려보내야 한다.
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('레벨 착지(프런티어)와 이동', () => {
  it('openLevel 은 진행도상 첫 미해결 문제에 착지한다', async () => {
    useGame.setState({ progress: { solved: ['l1-01', 'l1-02'], hintsUsed: [] } })
    get().openLevel(1)
    await flush()
    expect(get().problem?.id).toBe('l1-03')
  })

  it('레벨을 전부 풀었으면 처음부터 복습하도록 첫 문제에 착지한다', async () => {
    const solved = allProblems.filter((p) => p.level === 1).map((p) => p.id)
    useGame.setState({ progress: { solved, hintsUsed: [] } })
    get().openLevel(1)
    await flush()
    expect(get().problem?.id).toBe('l1-01')
  })

  it('진행도가 비어 있으면 기존과 동일하게 첫 문제에 착지한다(회귀)', async () => {
    get().openLevel(1)
    await flush()
    expect(get().problem?.id).toBe('l1-01')
  })

  it('prevProblem 은 이전 문제로 완전히 새로 시작한다(터미널 클리어·playing)', async () => {
    await get().startProblem('l1-03')
    await get().submit('cat nope.txt') // lines/signal 을 더럽혀 놓는다
    expect(get().lines.length).toBeGreaterThan(0)

    await get().prevProblem()
    expect(get().problem?.id).toBe('l1-02')
    expect(get().status).toBe('playing')
    expect(get().lines).toEqual([])
  })

  it('레벨의 첫 문제에서 prevProblem 은 아무것도 하지 않는다', async () => {
    await get().startProblem('l1-01')
    await get().prevProblem()
    expect(get().problem?.id).toBe('l1-01')
  })

  it('nextProblemNav 는 프런티어까지만 이동하고 그 너머는 no-op 이다', async () => {
    useGame.setState({ progress: { solved: ['l1-01'], hintsUsed: [] } })
    await get().startProblem('l1-01')

    await get().nextProblemNav()
    expect(get().problem?.id).toBe('l1-02') // 프런티어(첫 미해결)까지는 이동 가능

    await get().nextProblemNav()
    expect(get().problem?.id).toBe('l1-02') // 프런티어 캡: 더는 못 감
  })

  it('resetProblem 은 hintsShown 을 보존한다(스펙 확정 동작)', async () => {
    await get().startProblem('l1-01')
    get().revealHint()
    get().revealHint()
    expect(get().hintsShown).toBe(2)

    await get().resetProblem()
    expect(get().hintsShown).toBe(2)
  })
})

describe('세션은 스토어 수명 동안 하나만 만든다', () => {
  it('레벨을 두 번 넘어가도(문제 → 다음 문제) 같은 세션 인스턴스를 재사용한다', async () => {
    await get().startProblem('l1-01')
    const first = get().session
    await get().submit('cat readme.txt')
    await get().nextProblem()
    expect(get().session).toBe(first)
  })
})

describe('워커 단일-인플라이트 계약(직렬화)', () => {
  // 워커는 요청을 한 번에 하나만 처리한다(WorkerShellSession 은 스스로 직렬화하지
  // 않는다). 폭주 명령이 2초 데드라인을 기다리는 동안 또 제출하면 exec 가 겹쳐
  // recover 가 레이스한다 — 스토어가 요청을 큐에 실어, 앞 요청이 끝난 뒤에야 다음
  // exec 를 보내야 한다(드롭이 아니라 순서 보존). resolve 를 직접 쥔 세션으로
  // in-flight 를 만들어, 두 번째 exec 가 첫 번째가 끝나기 전엔 시작되지 않음을,
  // 그리고 끝난 뒤엔 순서대로 실행됨을 검증한다.
  it('exec 이 진행 중이면 다음 제출은 앞 요청이 끝날 때까지 큐에서 기다린다', async () => {
    const snap: StateSnapshot = { cwd: '/home/player', cwdEntries: [], env: {} }
    const ok: ExecResponse = { stdout: '', stderr: '', exitCode: 0, snapshot: snap, solved: false }
    const started: string[] = []
    let releaseFirst!: () => void
    const slow: ShellSession = {
      async start() { return snap },
      exec(line) {
        started.push(line)
        if (line === 'first') {
          return new Promise<ExecResponse>((res) => { releaseFirst = () => res(ok) })
        }
        return Promise.resolve(ok)
      },
      async reset() { return snap },
      dispose() {},
    }
    setSessionFactory(() => slow)
    await get().startProblem('l1-01')

    const p1 = get().submit('first') // release 전까지 매달린다
    const p2 = get().submit('second') // first 뒤로 큐잉되어야 한다
    await new Promise((r) => setTimeout(r, 0)) // 마이크로태스크 배수

    // second 는 아직 exec 되면 안 된다 — first 가 진행 중이다.
    expect(started).toEqual(['first'])

    releaseFirst()
    await Promise.all([p1, p2])
    // 둘 다, 그리고 제출 순서대로 실행됐다.
    expect(started).toEqual(['first', 'second'])
  })
})

// check()가 사용자 정의 문제에서 던지는 경우의 방어는 이제 store가 아니라
// LocalShellSession.exec() 안에 산다(session.exec가 절대 reject하지 않는다는
// ShellSession 계약) — session.test.ts의 "check 함수가 throws 해도 exec 는
// 해결되며 solved=false" 테스트가 그 계약을 지킨다. store는 session.exec()의
// 반환을 그대로 신뢰하므로 여기서 같은 시나리오를 다시 검증할 필요가 없다.
