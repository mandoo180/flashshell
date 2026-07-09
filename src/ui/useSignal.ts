import { useEffect } from 'react'
import { useGame, type GameStore, type Signal } from './store'

export const GLITCH_MS = 120

/**
 * store.ts 를 건드리지 않고 (a) "무관한 set() 은 무시" 와 (b) "wrong → wrong
 * 재발도 새 이벤트로 인정" 을 동시에 만족시키려면, 이 파일만으로 "signal 이
 * 실제로 바뀌었는가" 와 "signal 이 다시 발화했는가" 를 구별해야 한다.
 * 그 판별에 쓰는 성질: zustand 의 기본 set(partial) 은 얕은 병합
 * (Object.assign({}, state, partial)) 이라, 어떤 set() 호출이 partial 로
 * `signal` 딱 하나만 넘겼다면 그 결과 상태는 signal 을 제외한 모든 필드가
 * 직전 상태와 참조까지 동일하다. store.ts 에서 실패한 명령을 판정하는
 * submit() 은 정확히 그렇게 호출한다 — `set({ signal: ... })` 하나만, 다른
 * 필드는 안 건드리고. 반대로 힌트 열람처럼 signal 과 무관한 갱신은 반드시
 * signal 이외의 필드(hintsShown, progress 등)를 같이 바꾼다. 그래서
 * "signal 값은 그대로인데 다른 필드도 전부 그대로" 인 set() 호출만 "재발"로
 * 인정하면, 무관한 쓰기는 걸러내면서도 연속된 두 번의 오답은 각각 자기 몫의
 * 120ms 를 받는다.
 */
function isSignalOnlyMutation(state: GameStore, prevState: GameStore): boolean {
  for (const key of Object.keys(state) as (keyof GameStore)[]) {
    if (key === 'signal') continue
    if (state[key] !== prevState[key]) return false
  }
  return true
}

/**
 * wrong 신호는 짧게 스치고 사라진다. solved 는 시트가 떠 있는 동안 남는다
 * (clearSignal() 은 wrong 만 지운다 — store.ts 참고).
 *
 * 렌더링에 쓰는 `signal` 값은 평범한 셀렉터 훅으로 읽는다: idle/wrong/solved
 * 사이를 실제로 오갈 때만 리렌더가 필요하고, 그건 셀렉터 동등성 비교로 충분하다.
 *
 * 타이머 예약/해제는 별도로 `useGame.subscribe`(셀렉터 없는 원본 구독)를 쓰되,
 * 리스너 안에서 위 isSignalOnlyMutation 로 걸러 실제로 재예약이 필요한
 * 호출에만 반응한다 — signal 값이 바뀌었거나(idle→wrong, wrong→idle, …),
 * 값은 그대로여도 이 호출이 signal 만 다시 쓴 "재발" 이벤트일 때만 arm() 한다.
 * hintsShown 같은 signal 과 무관한 set() 은 무시하므로 이미 예약된 타이머의
 * 마감을 앞당기거나 늦추지 않는다.
 */
export function useSignal(): Signal {
  const signal = useGame((s) => s.signal)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    function arm(current: Signal) {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (current === 'wrong') {
        timer = setTimeout(() => {
          timer = undefined
          useGame.getState().clearSignal()
        }, GLITCH_MS)
      }
    }

    arm(useGame.getState().signal)
    const unsubscribe = useGame.subscribe((state, prevState) => {
      const changed = state.signal !== prevState.signal
      const refired = !changed && isSignalOnlyMutation(state, prevState)
      if (changed || refired) arm(state.signal)
    })

    return () => {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return signal
}
