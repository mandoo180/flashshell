import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { App } from './App'
import { useGame, setSessionFactory } from './store'
import { LocalShellSession } from './session'

// jsdom 에는 ResizeObserver가 없다 — 최소 스텁으로 대체해 HudCard의 useEffect가
// `new ResizeObserver(...)`를 부를 때 죽지 않게 하고, 콜백을 테스트가 직접
// 호출할 수 있게 인스턴스를 밖으로 노출한다.
class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = []
  callback: ResizeObserverCallback
  observedTargets: Element[] = []
  observe = vi.fn((target: Element) => { this.observedTargets.push(target) })
  unobserve = vi.fn()
  disconnect = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverMock.instances.push(this)
  }

  // 실제 ResizeObserver가 레이아웃 변화를 감지해 부르는 콜백을 수동 발화시킨다.
  // HudCard 의 measure()는 entry 가 아니라 hud 노드의 offsetTop/getBoundingClientRect()를
  // 직접 읽으므로, 여기서 넘기는 entry 는 형식만 맞춘 더미다(값은 무시된다).
  fire() {
    const entry = { contentRect: { height: 0 } } as ResizeObserverEntry
    this.callback([entry], this)
  }
}

function getHudHeightVar(): string {
  return document.documentElement.style.getPropertyValue('--hud-height')
}

// jsdom 은 레이아웃 엔진이 없어 offsetTop 도, getBoundingClientRect()도 항상 0 이다.
// HudCard 의 measure() 가 offsetTop + rect.height 를 Math.ceil 해서 쓰는지 검증하려면
// 실제 렌더된 값을 흉내 내야 하므로, .hud 노드에 직접 정의해 준다(실측 픽셀 값은
// e2e 가 진짜 브라우저에서 검증한다). height 는 실제 렌더처럼 소수점을 그대로
// 받아들인다 — offsetHeight(정수 반올림)가 아니라 getBoundingClientRect().height다.
function setHudBox(offsetTop: number, height: number) {
  const hud = document.querySelector('.hud') as HTMLElement
  Object.defineProperty(hud, 'offsetTop', { configurable: true, value: offsetTop })
  hud.getBoundingClientRect = () => ({
    height,
    width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0,
    toJSON() { return this },
  }) as DOMRect
}

beforeEach(() => {
  // Play.test.tsx / signal.test.tsx 와 동일한 이유: jsdom은 테스트 사이에
  // localStorage를 비우지 않고, jsdom에는 Worker가 없어 기본 팩토리
  // (WorkerShellSession)를 그대로 두면 startProblem에서 new Worker(...)가 죽는다.
  localStorage.clear()
  setSessionFactory(() => new LocalShellSession())
  useGame.setState(useGame.getInitialState(), true)

  document.documentElement.style.removeProperty('--hud-height')
  ResizeObserverMock.instances = []
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function goToLevel1() {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
}

describe('HudCard: --hud-height 측정', () => {
  it('마운트되면 .hud 노드에 ResizeObserver를 붙인다', async () => {
    await goToLevel1()

    expect(ResizeObserverMock.instances).toHaveLength(1)
    const observer = ResizeObserverMock.instances[0]!
    expect(observer.observe).toHaveBeenCalledTimes(1)
    expect(observer.observedTargets[0]).toBe(document.querySelector('.hud'))
  })

  it('콜백이 발화하면 --hud-height를 hud의 offsetTop+rect.height(실측 하단, 올림)로 쓴다', async () => {
    await goToLevel1()
    setHudBox(16, 150)

    ResizeObserverMock.instances[0]!.fire()

    expect(getHudHeightVar()).toBe('166px') // 16 + 150
  })

  it('실측 하단이 소수점이면 Math.ceil로 올림해 하단보다 작아지지 않는다', async () => {
    // 회귀 재현: getBoundingClientRect().height 는 소수점(예: 259.296875)을 가질 수
    // 있다. offsetHeight(정수 반올림)로 이를 내림해 버리면 padding-top이 실제
    // 하단보다 작아져 375px 폭 등에서 입력 줄과 다시 겹친다.
    await goToLevel1()
    setHudBox(16, 259.296875)

    ResizeObserverMock.instances[0]!.fire()

    expect(getHudHeightVar()).toBe('276px') // ceil(16 + 259.296875) = ceil(275.296875)
  })

  it('힌트를 펼쳐 카드가 자라면(다음 리사이즈 발화) --hud-height가 갱신된다', async () => {
    await goToLevel1()
    const observer = ResizeObserverMock.instances[0]!

    setHudBox(16, 150)
    observer.fire()
    const before = getHudHeightVar()

    await userEvent.click(screen.getByRole('button', { name: 'HINT' }))
    // 실제 브라우저라면 힌트 문단이 추가돼 레이아웃이 자라며 ResizeObserver가
    // 스스로 재발화한다 — jsdom은 레이아웃이 없으므로 "더 커진 높이"로 바꿔 놓고
    // 그 콜백을 수동으로 트리거한다.
    setHudBox(16, 200)
    observer.fire()
    const after = getHudHeightVar()

    expect(after).toBe('216px') // 16 + 200
    expect(after).not.toBe(before)
  })

  it('언마운트되면 ResizeObserver.disconnect가 호출된다', async () => {
    const { unmount } = render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    const observer = ResizeObserverMock.instances[0]!

    unmount()

    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })

  it('ResizeObserver가 없는 환경에서도 크래시하지 않는다(폴백은 CSS var(--hud-height, 11rem)에 맡긴다)', async () => {
    vi.stubGlobal('ResizeObserver', undefined)

    // render/click이 여기서 예외를 던지면 이 테스트 자체가 실패로 떨어진다 —
    // 별도로 toThrow 로 감쌀 필요 없이 "끝까지 실행됨"이 곧 크래시하지 않았다는 증거다.
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    expect(screen.getByText('첫 접속')).toBeInTheDocument()

    expect(getHudHeightVar()).toBe('')
  })
})

// --- 네비게이션(이전/다음/RESET/위치/배지) ------------------------------

// l1-01, l1-02 를 이미 풀어둔 상태로 시드한다. frontierProblem은 "첫 미해결
// 문제"에 착지하므로 openLevel(1)은 l1-03("금고로")에 도착한다 — 이는 동시에
// 레벨의 프런티어 인덱스(=2)이기도 해서 `다음 문제`가 비활성이어야 하는
// 경계 케이스를 만든다.
function seedSolvedFirstTwo() {
  useGame.setState({ progress: { solved: ['l1-01', 'l1-02'], hintsUsed: [] } })
}

function hudDiffText(): string | null {
  return document.querySelector('.hud-diff')?.textContent ?? null
}

describe('HudCard: 이전/다음 문제 이동, RESET, 위치, 해결 배지', () => {
  it('프런티어(l1-03)에 착지하면 이전 문제는 활성, 다음 문제는 비활성이다', async () => {
    seedSolvedFirstTwo()
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))

    expect(await screen.findByText('금고로')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이전 문제' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '다음 문제' })).toBeDisabled()
  })

  it('현재 문제 위치가 "인덱스/총개수" 형식으로 hud-diff 옆에 표시된다', async () => {
    seedSolvedFirstTwo()
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await screen.findByText('금고로')

    // l1-03은 레벨 1의 3번째(0-index 2) 문제, 레벨 1은 총 10문제.
    expect(hudDiffText()).toContain('3/10')
  })

  it('이전 문제 클릭 → l1-02로 이동, SOLVED 배지가 보이고 다음 문제가 활성화된다', async () => {
    seedSolvedFirstTwo()
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await screen.findByText('금고로')

    await userEvent.click(screen.getByRole('button', { name: '이전 문제' }))

    expect(await screen.findByText('숨겨진 것')).toBeInTheDocument()
    expect(screen.getByText('✓ SOLVED')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음 문제' })).toBeEnabled()
    expect(hudDiffText()).toContain('2/10')
  })

  it('레벨의 첫 문제(l1-01)에서는 이전 문제가 비활성이다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await screen.findByText('첫 접속')

    expect(screen.getByRole('button', { name: '이전 문제' })).toBeDisabled()
  })

  it('풀지 않은 문제에서는 SOLVED 배지가 보이지 않는다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await screen.findByText('첫 접속')

    expect(screen.queryByText('✓ SOLVED')).not.toBeInTheDocument()
  })

  it('DIFFICULTY는 6칸 표기다 — 레벨 1은 ◆◇◇◇◇◇', async () => {
    // 레벨이 1~6까지 있으므로(L6 자동화 포함) 난이도 표시도 6칸이어야 한다 —
    // 5칸(◆◇◇◇◇)이면 L6를 표현할 자리가 없다.
    await goToLevel1()
    await screen.findByText('첫 접속')

    expect(hudDiffText()).toContain('◆◇◇◇◇◇')
  })

  it('RESET 클릭 → 지운 파일이 원상 복구되고 화면(lines)이 비워진다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await screen.findByText('첫 접속')

    await userEvent.type(screen.getByRole('textbox'), 'rm readme.txt{Enter}')
    await screen.findByText(/rm readme\.txt/)

    await userEvent.click(screen.getByRole('button', { name: 'RESET' }))

    await waitFor(() => {
      expect(useGame.getState().lines).toEqual([])
      expect(useGame.getState().status).toBe('playing')
    })
    expect(screen.queryByText(/rm readme\.txt/)).not.toBeInTheDocument()

    // 파일이 정말 복구됐는지: 리셋 전이었다면 cat이 실패했을 것이다.
    await userEvent.type(screen.getByRole('textbox'), 'cat readme.txt{Enter}')
    expect(await screen.findByText('[ SOLVED ]')).toBeInTheDocument()
  })
})
