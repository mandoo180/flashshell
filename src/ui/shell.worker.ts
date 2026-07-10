// 이 파일은 워커 스레드에서 돈다. src/ui 의 다른 것(스토어, React, DOM 컴포넌트)은
// 절대 import 하지 않는다 — src/shell 과 src/game 은 순수하므로 워커 번들에 안전하게
// 들어가고, session.ts 도 그 위에서만(브라우저 API 없이) 동작한다.
import { LocalShellSession } from './session'
import type { StateSnapshot, ExecResponse } from './session'

type Req =
  | { type: 'start'; id: number; problemId: string }
  | { type: 'exec'; id: number; line: string }
  | { type: 'reset'; id: number }

type Reply =
  | { id: number; snapshot: StateSnapshot }
  | { id: number; response: ExecResponse }

/**
 * 이 파일의 실제 전역 스코프는 DedicatedWorkerGlobalScope이지 Window가 아니다.
 * 프로젝트 tsconfig 는 전체 src에 대해 lib: ["...", "DOM", "DOM.Iterable"] 하나만
 * 쓰는데(워커 전용 tsconfig를 따로 두지 않는다), DOM lib과 webworker lib을 같은
 * 컴파일에 동시에 참조하면 self/postMessage 같은 전역 선언이 충돌한다. 그래서
 * DedicatedWorkerGlobalScope 타입을 끌어오는 대신, 여기서 실제로 쓰는 최소 표면
 * (onmessage로 Req를 받고 Reply를 postMessage)만 가진 로컬 타입으로 self를 좁혀
 * 쓴다 — `any`를 뿌리지 않고도 tsc가 이 파일 안에서는 Req/Reply 타입을 그대로
 * 강제하게 만드는 캐스트다.
 */
interface WorkerScope {
  onmessage: ((ev: MessageEvent<Req>) => void) | null
  postMessage(message: Reply): void
}
const scope = self as unknown as WorkerScope

// session.ts 가 check() 예외를 console.warn 으로 찍는데, 워커 전역에도 console 이
// 있으므로(DOM/webworker 공통) 안전하다.
const session = new LocalShellSession()

scope.onmessage = async (ev) => {
  const req = ev.data
  if (req.type === 'start') {
    const snapshot = await session.start(req.problemId)
    scope.postMessage({ id: req.id, snapshot })
  } else if (req.type === 'exec') {
    const response = await session.exec(req.line)
    scope.postMessage({ id: req.id, response })
  } else {
    const snapshot = await session.reset()
    scope.postMessage({ id: req.id, snapshot })
  }
}
