import { useEffect } from 'react'
import { useGame, type Signal } from './store'

export const GLITCH_MS = 120

/**
 * store.ts 가 `signal` 을 쓸 때마다 `signalTick` 을 같이 증가시킨다(값이
 * 그대로인 wrong → wrong 재발도 포함해서). 그래서 "재발 이벤트인가" 를 다른
 * 필드의 참조 동일성으로 추론할 필요가 없다 — signalTick 이 바뀌었다는 것
 * 자체가 "signal 이 방금 쓰였다" 는 명시적 사실이다.
 *
 * 렌더링에 쓰는 `signal` 은 평범한 셀렉터로 읽는다. 타이머는 signalTick 을
 * 의존성으로 하는 useEffect 로 예약/해제한다: signalTick 은 signal 과 무관한
 * set() 호출(예: revealHint)에는 절대 바뀌지 않으므로, 이 effect 는 그런
 * 호출에는 재실행되지 않는다 — 반대로 signal 이 같은 값으로 다시 쓰이는
 * 재발에는 반드시 재실행된다.
 */
export function useSignal(): Signal {
  const signal = useGame((s) => s.signal)
  const signalTick = useGame((s) => s.signalTick)

  useEffect(() => {
    if (signal !== 'wrong') return

    const timer = setTimeout(() => {
      useGame.getState().clearSignal()
    }, GLITCH_MS)

    return () => clearTimeout(timer)
  }, [signal, signalTick])

  return signal
}
