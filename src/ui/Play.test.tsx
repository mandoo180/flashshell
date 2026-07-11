import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { App } from './App'
import { useGame, setSessionFactory } from './store'
import { LocalShellSession } from './session'
import type { Progress } from '../game/progress'

const PROGRESS_KEY = 'flashshell.progress.v1'

beforeEach(() => {
  // jsdom 은 테스트 사이에 저장소를 비우지 않는다. 진행도가 누적되면
  // "잠긴 레벨" 테스트가 앞 테스트의 성공 때문에 깨진다.
  localStorage.clear()
  // jsdom 에는 Worker가 없다 — 기본 팩토리(WorkerShellSession)를 그대로 두면
  // 이 파일이 startProblem/submit 을 통해 스토어를 구동할 때 new Worker(...) 가
  // 죽는다. 인프로세스 세션을 주입한다.
  setSessionFactory(() => new LocalShellSession())
  useGame.setState(useGame.getInitialState(), true)
})

describe('한 문제를 끝까지 푼다', () => {
  it('레벨 1을 열고, 문제를 풀고, 해설을 본다', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    expect(screen.getByText('첫 접속')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox'), 'cat readme.txt{Enter}')

    expect(await screen.findByRole('dialog', { name: '해설' })).toBeInTheDocument()
    expect(screen.getByText('[ SOLVED ]')).toBeInTheDocument()
    expect(screen.getByText('cat readme.txt')).toBeInTheDocument()
  })

  it('힌트는 요청해야 나온다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    expect(screen.queryByText(/ls 입니다/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'HINT' }))
    expect(screen.getByText(/ls 입니다/)).toBeInTheDocument()
  })

  it('잠긴 레벨은 누를 수 없다', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /LEVEL 3/ })).toBeDisabled()
  })

  it('HUD 를 접으면 지문이 사라지고 터미널이 드러난다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await userEvent.click(screen.getByRole('button', { name: '문제 카드 접기' }))
    expect(screen.queryByText('첫 접속')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '문제 카드 펼치기' }))
    expect(screen.getByText('첫 접속')).toBeInTheDocument()
  })
})

describe('NEXT 이후 포커스 (M1 최종 리뷰 Important 결함)', () => {
  it('문제를 풀고 NEXT를 누르면 포커스가 터미널 입력으로 돌아온다', async () => {
    // userEvent 대신 fireEvent 를 쓴다: startProblem/submit/nextProblem 은
    // 세션 직렬화 큐를 통하는 비동기 함수라(signal.test.tsx 의 clickLevel1/
    // submitWithFireEvent 주석 참고), fireEvent 로 동기 디스패치한 뒤
    // act(async () => {}) 로 보류 중인 마이크로태스크를 확실히 다 돌려야
    // 다음 단언 전에 스토어 갱신이 끝난다.
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await act(async () => {})

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'cat readme.txt' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {})

    expect(await screen.findByRole('dialog', { name: '해설' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /NEXT/ }))
    await act(async () => {})

    // 다음 문제로 넘어간 뒤에도 role="textbox" 는 (리마운트가 아니라) 같은
    // DOM 노드를 가리킨다 — 새로 얻은 참조로 다시 조회해 비교한다.
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })
})

describe('레벨은 진행도로 순차 해제된다', () => {
  it('레벨 1~4를 8개씩 풀면 레벨 5도 열려 플레이할 수 있다 (더 이상 COMING SOON 레벨이 없다)', async () => {
    // store.ts는 모듈이 처음 평가될 때 `progress: loadProgress()`를 딱 한 번
    // 호출해 이 파일 상단의 `useGame`/`App` 바인딩에 굳혀 넣는다. beforeEach에서
    // localStorage만 채워서는 이미 평가가 끝난 그 스토어 인스턴스에 반영되지
    // 않는다(정적 import는 재평가되지 않는다). 그래서 여기서는
    // localStorage를 먼저 채운 뒤 vi.resetModules()로 모듈 캐시를 비우고
    // App을 동적 import()한다 — 그 안에서 다시 import되는 store.ts가 새로
    // 평가되면서 방금 채운 값을 loadProgress()로 읽어 초기 상태에 반영한다.
    //
    // 이 테스트는 원래 "아직 안 채워진 레벨은 unlock 규칙상 열려야 해도
    // total === 0 가드가 막아 COMING SOON으로 남는다"를 검증했다(part1
    // Task 10이 레벨 3을 채우며 타겟을 레벨 4로, part1 Task 11이 레벨 4를
    // 채우며 타겟을 레벨 5로 옮겨왔다). part2 Task 10에서 레벨 5(스크립팅)가
    // 10문제로 채워지면서 LEVELS 배열의 모든 레벨(1~5)이 total > 0이 되어,
    // 옮겨갈 "아직 빈 레벨"이 더는 없다(레벨 6은 없다). 그래서 같은 시나리오를
    // 반대쪽에서 검증하도록 뒤집는다: 레벨 1~4를 8개씩 풀어 unlock 규칙상
    // 레벨 5가 열려야 하는 상태를 만들고, total === 0 가드의 else 분기(total>0
    // 이면 COMING SOON이 아니라 실제 진행도를 보여준다)가 레벨 5에서도 올바르게
    // 동작해 정상적으로 열리는지 — 즉 이제 게임 전체에 COMING SOON이 하나도
    // 남지 않았는지 — 확인한다.
    const seeded: Progress = {
      solved: [
        'l1-01', 'l1-02', 'l1-03', 'l1-04', 'l1-05', 'l1-06', 'l1-07', 'l1-08',
        'l2-01', 'l2-02', 'l2-03', 'l2-04', 'l2-05', 'l2-06', 'l2-07', 'l2-08',
        'l3-01', 'l3-02', 'l3-03', 'l3-04', 'l3-05', 'l3-06', 'l3-07', 'l3-08',
        'l4-01', 'l4-02', 'l4-03', 'l4-04', 'l4-05', 'l4-06', 'l4-07', 'l4-08',
      ],
      hintsUsed: [],
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(seeded))

    vi.resetModules()
    const { App: FreshApp } = await import('./App')

    render(<FreshApp />)

    const level1 = screen.getByRole('button', { name: /LEVEL 1/ })
    const level2 = screen.getByRole('button', { name: /LEVEL 2/ })
    const level3 = screen.getByRole('button', { name: /LEVEL 3/ })
    const level4 = screen.getByRole('button', { name: /LEVEL 4/ })
    const level5 = screen.getByRole('button', { name: /LEVEL 5/ })

    // 세팅이 실제로 반영됐는지: 레벨 1·2·3·4는 열려 있어야 한다.
    expect(level1).toBeEnabled()
    expect(level2).toBeEnabled()
    expect(level3).toBeEnabled()
    expect(level4).toBeEnabled()

    // 레벨 5는 이제 문제 10개로 채워졌다(total > 0) — unlock 규칙(레벨 4를
    // 8개 풀었음)까지 만족하므로 실제로 열려야 하고, COMING SOON은 어디에도
    // 남아 있으면 안 된다.
    expect(level5).toBeEnabled()
    expect(within(level5).queryByText('COMING SOON')).not.toBeInTheDocument()
    expect(within(level5).getByText('0/10')).toBeInTheDocument()
  })
})
