import { useEffect } from 'react'
import { useGame, type Signal } from './store'

export const GLITCH_MS = 120

/**
 * wrong 신호는 짧게 스치고 사라진다. solved 는 시트가 떠 있는 동안 남는다
 * (clearSignal() 은 wrong 만 지운다 — store.ts 참고).
 *
 * 렌더링에 쓰는 `signal` 값은 평범한 셀렉터 훅으로 읽는다: idle/wrong/solved
 * 사이를 실제로 오갈 때만 리렌더가 필요하고, 그건 셀렉터 동등성 비교로 충분하다.
 *
 * 타이머 예약/해제는 별도로 `useGame.subscribe`(셀렉터 없는 원본 구독)를 쓴다.
 * 이유: 연속된 두 번의 오답처럼 신호값이 'wrong' → 'wrong' 으로 "안 바뀌는"
 * 업데이트가 있을 수 있다. `useGame((s) => s.signal)` 같은 셀렉터 훅은 결과가
 * Object.is 로 같으면 리렌더를 건너뛰므로, 이 훅의 useEffect 도 재실행되지
 * 않는다 — 그러면 첫 번째 오답이 예약한 타이머 하나만 남아서, "두 번째 오답
 * 시점 + 120ms"가 아니라 "첫 번째 오답 시점 + 120ms"에 신호를 지워버린다
 * (나중 신호를 조기에 지우는 leaked timer). 반면 zustand 의 store.subscribe
 * 는 매 set() 호출마다 무조건 불리므로, 값이 같은 'wrong' 이라도 "새 오답
 * 이벤트가 있었다"는 사실 자체는 놓치지 않는다.
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
    const unsubscribe = useGame.subscribe((state) => arm(state.signal))

    return () => {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return signal
}
