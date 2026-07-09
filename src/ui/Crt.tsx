import type { ReactNode } from 'react'
import './theme.css'
import { useSignal } from './useSignal'

export function Crt({ children }: { children: ReactNode }) {
  const signal = useSignal()
  const modifier = signal === 'idle' ? '' : ` signal-${signal}`
  return (
    <div className={`crt${modifier}`}>
      {children}
      {/* 항상 DOM에 있고 평소엔 투명하다(opacity:0). 오답 순간에만 애니메이션이
          붙는다. 마운트/언마운트로 오갔다면 애니메이션 시작이 한 프레임 늦었을
          것이다. aria-hidden 은 스크린리더가 이 장식 노드를 무시하게 하고,
          pointer-events:none 은 클릭을 가로채지 않게 한다(CSS 에서 지정). */}
      <div className="crt-tear" aria-hidden="true" />
    </div>
  )
}
