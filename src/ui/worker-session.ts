import type { ShellSession, StateSnapshot, ExecResponse } from './session'

/** exec 하나가 이 시간(ms)을 넘기면 워커를 죽이고 리플레이로 복원한다. 게임 명령은
 * 1ms 미만, grep ReDoS 는 수 초 — 넉넉히 가른다. */
export const EXEC_DEADLINE_MS = 2000

const TIMEOUT_RESPONSE = (snapshot: StateSnapshot): ExecResponse => ({
  stdout: '',
  stderr: '^C  flashshell: 실행 한도 초과 — 무한 루프인가요?\n',
  exitCode: 130,
  snapshot,
  solved: false,
})

/**
 * 셸을 워커 스레드에서 돌리는 `ShellSession` 구현. exec 마다 wall-clock 데드라인을
 * 걸고, 그 안에 응답이 없으면(동기 루프에 갇힘) 워커를 terminate() 하고 새 워커를
 * 띄운 뒤 명령 히스토리를 리플레이해 상태를 복원한다.
 *
 * 호출자(스토어)가 start/exec/reset 을 한 번에 하나씩만, 매번 await 하고 부른다고
 * 가정한다 — 이 클래스는 자체적으로 요청을 직렬화하지 않는다. 동시에 여러 요청을
 * 겹쳐 보내면 this.worker/this.history 갱신 순서가 호출 순서와 어긋날 수 있다.
 */
export class WorkerShellSession implements ShellSession {
  private worker: Worker
  private seq = 0
  private problemId: string | null = null
  private history: string[] = []
  private lastSnapshot: StateSnapshot = { cwd: '/home/player', cwdEntries: [], env: {} }
  private disposed = false

  constructor() { this.worker = this.spawn() }

  private spawn(): Worker {
    return new Worker(new URL('./shell.worker.ts', import.meta.url), { type: 'module' })
  }

  /**
   * 워커에 한 요청을 보내고, deadline 안에 응답이 없으면 reject('timeout').
   * 리스너와 타이머는 resolve/timeout 두 경로 모두에서 정리한다. 이 요청이 붙인
   * 리스너는 호출 시점의 `this.worker`(로컬 변수 `worker`로 고정)에 대해서만
   * add/remove 한다 — recover() 가 그 사이 `this.worker` 를 새 워커로 바꿔치기해도,
   * 이 요청의 cleanup 은 자기가 리스너를 붙였던 그 워커에서만 뗀다. (그 워커가
   * 이미 새 요청이 붙인 리스너 없이 terminate() 됐다면 cleanup 은 안전한 no-op.)
   */
  private request<T>(msg: object, deadlineMs: number): Promise<T> {
    const id = ++this.seq
    const worker = this.worker
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')) }, deadlineMs)
      const onMessage = (ev: MessageEvent) => {
        if (ev.data?.id !== id) return
        cleanup(); resolve(ev.data as T)
      }
      const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', onMessage) }
      worker.addEventListener('message', onMessage)
      worker.postMessage({ ...msg, id })
    })
  }

  async start(problemId: string): Promise<StateSnapshot> {
    this.problemId = problemId
    this.history = []
    try {
      const { snapshot } = await this.request<{ snapshot: StateSnapshot }>({ type: 'start', problemId }, EXEC_DEADLINE_MS)
      this.lastSnapshot = snapshot
      return snapshot
    } catch {
      // 문제 셋업 자체가 데드라인을 넘길 수도 있다(예: 퍼즐 setup 버그로 무한 루프).
      // 워커를 죽이고 새로 띄워 재시도할 여지를 준다.
      await this.recover()
      return this.lastSnapshot
    }
  }

  async exec(line: string): Promise<ExecResponse> {
    try {
      const { response } = await this.request<{ response: ExecResponse }>({ type: 'exec', line }, EXEC_DEADLINE_MS)
      this.history.push(line)
      this.lastSnapshot = response.snapshot
      return response
    } catch {
      // 데드라인 초과: 워커가 동기 루프에 갇혔다. 죽이고 새로 띄워 히스토리를 리플레이.
      // 폭주한 이 줄 자체는 history 에 넣지 않는다 — 넣으면 리플레이가 또 갇힌다.
      await this.recover()
      return TIMEOUT_RESPONSE(this.lastSnapshot)
    }
  }

  /**
   * 갇힌 워커를 죽이고 새 워커에 문제 시작 + 히스토리 리플레이. 폭주한 그 줄은 다시
   * 넣지 않는다(또 갇힌다). 새로 띄운 워커에서마저 start 나 리플레이 중 한 줄이 또
   * 데드라인을 넘기면, 그 워커도 죽이고(백그라운드에서 계속 도는 좀비로 남기지
   * 않는다) 거기서 복원을 포기한다(가능한 데까지만 복원).
   */
  private async recover(): Promise<void> {
    this.worker.terminate()
    if (this.disposed) return // dispose() 이후엔 새 워커를 다시 띄우지 않는다.
    this.worker = this.spawn()
    if (this.problemId === null) return

    try {
      const { snapshot } = await this.request<{ snapshot: StateSnapshot }>(
        { type: 'start', problemId: this.problemId }, EXEC_DEADLINE_MS,
      )
      this.lastSnapshot = snapshot
    } catch {
      // 새로 띄운 워커에서마저 start 가 데드라인을 넘김 — 리플레이할 대상이 없으니
      // 마지막 스냅샷을 유지한 채 포기한다.
      return
    }

    for (const line of this.history) {
      try {
        const { response } = await this.request<{ response: ExecResponse }>({ type: 'exec', line }, EXEC_DEADLINE_MS)
        this.lastSnapshot = response.snapshot
      } catch {
        // 리플레이 중인 그 줄 자체가 또 갇혔다. 이 워커를 그대로 두면 백그라운드에서
        // 계속 CPU 를 태우는 좀비가 된다 — 죽이고 새로 띄워 다음 exec 는 최소한
        // 응답 가능한 워커를 상대하게 한다. 나머지 히스토리 리플레이는 포기.
        this.worker.terminate()
        if (!this.disposed) this.worker = this.spawn()
        break
      }
    }
  }

  async reset(): Promise<StateSnapshot> {
    try {
      const { snapshot } = await this.request<{ snapshot: StateSnapshot }>({ type: 'reset' }, EXEC_DEADLINE_MS)
      this.history = []
      this.lastSnapshot = snapshot
      return snapshot
    } catch {
      await this.recover()
      return this.lastSnapshot
    }
  }

  dispose(): void {
    this.disposed = true
    this.worker.terminate()
  }
}
