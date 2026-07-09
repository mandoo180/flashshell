import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { App } from './App'
import { useGame } from './store'
import { useSignal, GLITCH_MS } from './useSignal'

// import.meta.url 은 vitest 트랜스폼 하에서 file: 스킴이 보장되지 않으므로
// (가상 모듈 id 인 경우가 있다), 테스트 실행 위치(repo root) 기준 상대경로로 계산한다.
const themeCssPath = resolve(process.cwd(), 'src/ui/theme.css')

beforeEach(() => {
  // jsdom 은 테스트 사이에 저장소를 비우지 않는다 (Play.test.tsx 와 동일한 이유).
  localStorage.clear()
  useGame.setState(useGame.getInitialState(), true)
})
afterEach(() => {
  // 가짜 타이머를 켠 테스트가 있으면 반드시 되돌려 다음 테스트로 새지 않게 한다.
  vi.useRealTimers()
})

// --- CSS 정적 분석 헬퍼 -----------------------------------------------
// jsdom 은 실제 CSSOM/애니메이션 엔진이 없으므로(스타일시트를 계산하지 않는다),
// "reduced-motion 에서 애니메이션이 꺼지는가" 같은 규칙은 computed style 로는
// 검증할 수 없다. 소스 텍스트를 직접 파싱해 규칙의 존재를 못박는다.
function blockAfter(css: string, marker: string): string {
  const start = css.indexOf(marker)
  if (start === -1) throw new Error(`marker not found: ${marker}`)
  const braceStart = css.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(braceStart + 1, i)
    }
  }
  throw new Error(`unbalanced braces after marker: ${marker}`)
}

function allBlocksAfter(css: string, marker: string): string[] {
  const blocks: string[] = []
  let idx = 0
  for (;;) {
    const start = css.indexOf(marker, idx)
    if (start === -1) break
    const braceStart = css.indexOf('{', start)
    let depth = 0
    let end = -1
    for (let i = braceStart; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end === -1) throw new Error(`unbalanced braces after marker: ${marker}`)
    blocks.push(css.slice(braceStart + 1, end))
    idx = end + 1
  }
  return blocks
}

// 주석 안에 "outline: none 쓰면 안 된다"처럼 금지어 자체를 설명하는 문장이 있을 수
// 있으므로, 소스 텍스트 검사는 항상 주석을 걷어낸 코드에 대해서만 한다.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

// 특정 색(글리치 빨강/시안, bloom 초록)을 하나하나 grep 하는 대신 "채도가 있는
// 색 리터럴" 자체를 찾는다 — 그래야 앞으로 추가되는 애니메이션/규칙이 새 색을
// 하드코딩해도 반드시 걸린다. 유일한 예외는 문서화된 무채색 검정
// (rgba(0, 0, 0, alpha)) — 비네팅(.crt::after)과 box-shadow(.sheet)가 쓰는
// 값이고, 이번 태스크 범위 밖이다.
const ACHROMATIC_BLACK = /^0\s*,\s*0\s*,\s*0\s*(,|$)/

function findChromaticLiterals(css: string): string[] {
  const found: string[] = []

  // #rgb / #rrggbb (와 8자리 alpha 변형까지) 헥스 리터럴.
  const hexMatches = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  found.push(...hexMatches)

  // rgb()/rgba()/hsl()/hsla() 함수 호출. rgba(var(--token), alpha) 처럼
  // 첫 인자가 토큰 참조면 리터럴이 아니므로 통과시킨다.
  const fnRegex = /\b(?:rgba?|hsla?)\(([^)]*)\)/g
  for (const match of css.matchAll(fnRegex)) {
    const full = match[0] ?? ''
    const args = (match[1] ?? '').trim()
    if (args.startsWith('var(')) continue
    if (ACHROMATIC_BLACK.test(args)) continue
    found.push(full)
  }

  return found
}

function removeRootBlock(css: string): string {
  const start = css.indexOf(':root')
  const braceStart = css.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  return css.slice(0, start) + css.slice(end + 1)
}

async function goToLevel1(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(screen.getByRole('button', { name: /LEVEL 1/ }))
}

// --- 가짜 타이머 + 입력 헬퍼 --------------------------------------------
// @testing-library/user-event(v14.6.1) 의 click()/type() 은 이 저장소에
// 설치된 vitest(v4.1.10)의 vi.useFakeTimers() 와 함께 쓰면 절대 resolve 되지
// 않는다 — advanceTimers 옵션(동기/비동기 버전 둘 다), delay:null, 순서를
// 바꿔가며 확인했고, App 이 아니라 useState 하나짜리 최소 컴포넌트에서도
// 재현된다(리액트 스케줄러 ↔ 가짜 타이머 조합 자체의 버그다, 이 태스크가 만든
// 코드와는 무관하다). 반면 @testing-library/react 의 저수준 fireEvent 는
// Promise 체인을 타지 않고 동기 디스패치 + act() 로 끝나서 가짜 타이머 밑에서도
// 멀쩡히 동작한다(직접 검증함). 그래서 가짜 타이머가 필요한 테스트에서는
// userEvent 대신 fireEvent 를 쓴다.
function goToLevel1WithFireEvent() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
}

async function submitWithFireEvent(line: string) {
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: line } })
  fireEvent.keyDown(input, { key: 'Enter' })
  // submit() 은 async 라 fireEvent 만으로는 그 안의 await shell.exec(...) 가
  // 아직 안 끝났을 수 있다 — act 로 감싼 빈 async 콜백으로 보류 중인
  // 마이크로태스크를 확실히 다 돌린다.
  await act(async () => {})
}

describe('시그널: crt 클래스', () => {
  it('실패한 명령은 crt 에 signal-wrong 을 붙인다', async () => {
    const user = userEvent.setup()
    await goToLevel1(user)
    await user.type(screen.getByRole('textbox'), 'cat nope.txt{Enter}')

    expect(document.querySelector('.crt')).toHaveClass('signal-wrong')
  })

  it('signal-wrong 은 120ms 뒤에 사라진다', async () => {
    // 가짜 타이머는 반드시 렌더/상호작용보다 먼저 켠다. (goToLevel1WithFireEvent
    // 위 주석 참고: 이 프로젝트의 vitest+user-event 조합에서는 userEvent 를 가짜
    // 타이머와 같이 쓰면 클릭 하나조차 영원히 resolve 되지 않아 fireEvent 를 쓴다.)
    vi.useFakeTimers()
    goToLevel1WithFireEvent()
    await submitWithFireEvent('cat nope.txt')

    expect(document.querySelector('.crt')).toHaveClass('signal-wrong')
    act(() => { vi.advanceTimersByTime(200) })
    expect(document.querySelector('.crt')).not.toHaveClass('signal-wrong')
  })

  it('정답은 signal-solved 를 붙이고, 시트가 떠 있는 동안 시간이 지나도 유지한다', async () => {
    vi.useFakeTimers()
    goToLevel1WithFireEvent()
    await submitWithFireEvent('cat readme.txt')

    expect(document.querySelector('.crt')).toHaveClass('signal-solved')
    // clearSignal() 은 wrong 만 지운다 — solved 전용 타이머는 애초에 없다.
    // 시간이 얼마나 지나도(wrong 의 GLITCH_MS 를 훨씬 넘겨도) solved 는 남아야 한다.
    act(() => { vi.advanceTimersByTime(5000) })
    expect(document.querySelector('.crt')).toHaveClass('signal-solved')
  })

  it('성공했지만 정답이 아닌 명령은 아무 클래스도 안 붙인다', async () => {
    const user = userEvent.setup()
    await goToLevel1(user)
    await user.type(screen.getByRole('textbox'), 'ls{Enter}')

    const crt = document.querySelector('.crt')!
    expect(crt).not.toHaveClass('signal-wrong')
    expect(crt).not.toHaveClass('signal-solved')
  })

  it('stderr 는 색과 무관하게 텍스트로도 읽힌다 (색 + 글리치 + 텍스트, 셋 중 텍스트)', async () => {
    const user = userEvent.setup()
    await goToLevel1(user)
    await user.type(screen.getByRole('textbox'), 'cat nope.txt{Enter}')

    const message = screen.getByText(/No such file or directory/)
    expect(message).toBeInTheDocument()
    // 텍스트가 앰버 색상 클래스도 같이 갖고 있는지 확인한다 — 색이 지워져도
    // (색맹, 저채도 모니터) 텍스트는 남고, 텍스트가 안 보여도 색은 남는다는
    // "둘 중 하나가 사라져도 나머지가 뜻을 전달한다"는 설계를 못박는다.
    expect(message).toHaveClass('tone-amber')
  })

  it('연속된 두 번의 오답은 각각 자신의 120ms 를 온전히 지킨다', async () => {
    // 두 번째 오답도 신호값은 여전히 'wrong' 이라 zustand 셀렉터 기준으로는
    // "값이 안 바뀐 업데이트"다. 셀렉터 동등성에만 기대는 구현이면 이 두 번째
    // set() 은 리렌더를 못 일으키고, 그러면 useEffect 도 재실행되지 않아
    // 첫 번째 오답이 예약한 타이머 하나만 살아남는다. 그 타이머는 "두 번째
    // 오답 시점 + 120ms"가 아니라 "첫 번째 오답 시점 + 120ms"에 신호를
    // 지워버려서, 두 번째 오답의 글리치 창이 부당하게 짧아진다.
    vi.useFakeTimers()
    goToLevel1WithFireEvent()

    await submitWithFireEvent('cat nope.txt')  // t=0: 1차 오답
    act(() => { vi.advanceTimersByTime(60) })  // t=60
    await submitWithFireEvent('cat nope2.txt') // t=60: 2차 오답 (여전히 'wrong')

    // t=120 (1차 오답 기준 120ms 지점) — 2차 오답은 60ms 밖에 안 지났으므로
    // 아직 살아있어야 한다. 안 살아있다면 첫 타이머가 새 신호를 조기에 지운 것.
    act(() => { vi.advanceTimersByTime(60) })
    expect(document.querySelector('.crt')).toHaveClass('signal-wrong')

    // t=181 (2차 오답 기준 120ms 초과) — 이제는 지워져야 한다.
    act(() => { vi.advanceTimersByTime(61) })
    expect(document.querySelector('.crt')).not.toHaveClass('signal-wrong')
  })

  it('언마운트되면 대기 중이던 wrong 타이머가 정리된다', async () => {
    vi.useFakeTimers()
    const { unmount } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await submitWithFireEvent('cat nope.txt')
    expect(useGame.getState().signal).toBe('wrong')

    // 절대값 0을 기대하지 않는다: 터미널 입력의 autoFocus 마운트 자체가
    // useSignal 과 무관한 타이머를 하나 예약해둔다(jsdom/React 내부 동작 —
    // grep 으로 이 코드베이스에 setTimeout 을 쓰는 곳은 useSignal 뿐임을
    // 확인했는데도 실측하면 언마운트 전 타이머가 2개였다. 즉 useSignal 밖의
    // 원인이다). 그래서 "언마운트로 정확히 1개(우리 글리치 타이머)가
    // 줄어드는가"를 비교한다 — 절대 개수가 아니라 우리 몫의 정리를 검증한다.
    const before = vi.getTimerCount()
    unmount()
    const after = vi.getTimerCount()
    expect(after).toBe(before - 1)
  })

  it('회귀 가드: 언마운트 뒤 대기 중이던 글리치 타이머가 발화해도 에러 없이 조용하다', async () => {
    // unmount() 가 타이머를 못 지웠다면, 이 시점 이후 GLITCH_MS 가 지날 때
    // 그 콜백이 언마운트된 컴포넌트를 향한 상태 갱신을 시도해 React 경고나
    // 예외를 던질 수 있다. console.error 를 감시해 "조용히 끝난다"를 못박는다.
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await submitWithFireEvent('cat nope.txt')
    expect(useGame.getState().signal).toBe('wrong')

    unmount()
    expect(() => {
      act(() => { vi.advanceTimersByTime(GLITCH_MS + 100) })
    }).not.toThrow()
    expect(consoleError).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('무관한 스토어 변경은 글리치 창을 연장하지 않는다', () => {
    // signal 을 건드리지 않는 set() 호출(예: hintsShown)이 있어도 이미 예약된
    // wrong 타이머는 최초 실패 시점 기준 GLITCH_MS 에 그대로 만료돼야 한다.
    // 리뷰가 지적한 버그: 예전 구현은 bare subscribe 가 "모든" set() 호출에
    // 반응해 타이머를 매번 다시 예약했다 — 그러면 t=60 에 무관한 쓰기가 있을 때
    // 만료 시점이 t=60+120=180 으로 밀린다. 이 테스트는 DOM/App 없이 스토어와
    // 훅만 직접 구동한다(태스크 지시 — App 을 안 거쳐도 되는 테스트는 그렇게 한다).
    vi.useFakeTimers()
    useGame.setState({ signal: 'wrong' }) // t=0: 오답 발화
    let signal: string | undefined
    function Probe() { signal = useSignal(); return null }
    render(<Probe />)

    act(() => { vi.advanceTimersByTime(60) }) // t=60
    useGame.setState({ hintsShown: 1 })       // signal 과 무관한 쓰기
    act(() => { vi.advanceTimersByTime(60) }) // t=120 (최초 실패 기준)

    expect(useGame.getState().signal).toBe('idle')
    expect(signal).toBe('idle')
  })

  it('.crt-tear 는 idle 상태에도 DOM에 항상 존재하고 aria-hidden 이다', async () => {
    const user = userEvent.setup()
    await goToLevel1(user)

    const tear = document.querySelector('.crt-tear')
    expect(tear).not.toBeNull()
    expect(tear).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('시그널: CSS 규율 (jsdom 은 CSSOM 을 계산하지 않으므로 소스 텍스트를 검증한다)', () => {
  const css = stripComments(readFileSync(themeCssPath, 'utf-8'))

  it('글리치/블룸 색 토큰은 :root 안에 정의돼 있고, 실제로 var() 로 참조된다', () => {
    const root = blockAfter(css, ':root')
    // #hex, rgb()/rgba() 함수, 혹은 rgba(var(--x), alpha) 로 쓰기 위한
    // "R, G, B" 콤마 트리플(숫자로 시작) 중 하나면 된다.
    expect(root).toMatch(/--glitch-r:\s*(#|rgba?\(|\d)/)
    expect(root).toMatch(/--glitch-c:\s*(#|rgba?\(|\d)/)
    expect(root).toMatch(/--phos-green-rgb:\s*(#|rgba?\(|\d)/)

    const withoutRoot = removeRootBlock(css)
    // 토큰이 정의만 되고 안 쓰이면(죽은 토큰) 의미가 없다 — 실제 참조를 못박는다.
    expect(withoutRoot).toContain('var(--glitch-r)')
    expect(withoutRoot).toContain('var(--glitch-c)')
    expect(withoutRoot).toContain('var(--phos-green-rgb)')
  })

  it('CSS 규율: 채도가 있는 색 리터럴은 :root 밖으로 새지 않는다 (일반화된 검사)', () => {
    // 이전 버전은 '255, 59, 59'/'0, 229, 255' 딱 두 문자열만 grep 했다 — 그
    // 두 값만 안 쓰면 통과였으므로, bloom 이 --phos-green 의 RGB 트리플을
    // 하드코딩(rgba(78, 224, 106, ...))했을 때도 이 테스트는 초록불이었다.
    // 여기서는 "어떤 색이냐"가 아니라 "리터럴이냐 토큰이냐"만 본다: #hex,
    // rgb()/rgba()/hsl()/hsla() 리터럴은 무엇이든 걸린다. 문서화된 예외는
    // findChromaticLiterals 위 주석의 무채색 검정 하나뿐이다.
    const withoutRoot = removeRootBlock(css)
    const violations = findChromaticLiterals(withoutRoot)
    expect(violations).toEqual([])
  })

  it('reduced-motion 에서는 글리치(tear/aberrate)와 블룸(bloom) 애니메이션이 모두 꺼진다', () => {
    const blocks = allBlocksAfter(css, '@media (prefers-reduced-motion: reduce)')
    const combined = blocks.join('\n')
    expect(combined).toContain('.signal-wrong .crt-tear')
    expect(combined).toContain('.signal-wrong .terminal')
    expect(combined).toContain('.signal-solved .terminal')
    expect(combined).toMatch(/animation:\s*none/)
  })

  it('포커스 링은 outline:none 으로 지워지지 않는다', () => {
    expect(css).not.toMatch(/outline:\s*none/)
    expect(css).toContain(':focus-visible')
  })

  it('.crt-tear 는 pointer-events:none 이라 클릭을 가로채지 않는다', () => {
    const block = blockAfter(css, '.crt-tear {')
    expect(block).toMatch(/pointer-events:\s*none/)
  })

  it('색 토큰(--phos-green/--phos-amber/--phos-bg)은 태스크가 고정한 값 그대로다', () => {
    const root = blockAfter(css, ':root')
    expect(root).toMatch(/--phos-green:\s*#4ee06a/)
    expect(root).toMatch(/--phos-amber:\s*#ffb03a/)
    expect(root).toMatch(/--phos-bg:\s*#0b0e08/)
  })
})
