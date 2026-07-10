import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { App } from './App'
import { useGame, setSessionFactory } from './store'
import { LocalShellSession } from './session'
import { HUD_CHROME_PX } from './HudCard'

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

  // 실제 ResizeObserver가 레이아웃 변화를 감지해 부르는 콜백을, 테스트에서
  // "높이 X로 리사이즈됐다"고 가정하고 수동으로 발화시킨다.
  fire(height: number) {
    const entry = { contentRect: { height } } as ResizeObserverEntry
    this.callback([entry], this)
  }
}

function getHudHeightVar(): string {
  return document.documentElement.style.getPropertyValue('--hud-height')
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

  it('ResizeObserver 콜백이 발화하면 --hud-height를 실측값 + HUD 여백으로 쓴다', async () => {
    await goToLevel1()
    const observer = ResizeObserverMock.instances[0]!

    observer.fire(150)

    expect(getHudHeightVar()).toBe(`${150 + HUD_CHROME_PX}px`)
  })

  it('힌트를 펼쳐 카드가 자라면(다음 리사이즈 발화) --hud-height가 갱신된다', async () => {
    await goToLevel1()
    const observer = ResizeObserverMock.instances[0]!

    observer.fire(150) // 힌트 펼치기 전 높이
    const before = getHudHeightVar()

    await userEvent.click(screen.getByRole('button', { name: 'HINT' }))
    // 실제 브라우저라면 힌트 문단이 추가돼 레이아웃이 자라며 ResizeObserver가
    // 스스로 재발화한다 — jsdom은 레이아웃이 없으므로 "더 커진 높이"로 다시
    // 발화됐다고 가정하고 그 콜백을 수동으로 트리거한다.
    observer.fire(200)
    const after = getHudHeightVar()

    expect(after).toBe(`${200 + HUD_CHROME_PX}px`)
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
