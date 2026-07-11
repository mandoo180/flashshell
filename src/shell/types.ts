import type { VFS } from './vfs'
import type { ListNode } from './parser'

export interface ExecResult { stdout: string; stderr: string; exitCode: number }

/**
 * 셸의 변경 가능한 상태. 빌트인은 이것을 직접 고친다.
 *
 * `functions`: 정의된 셸 함수(이름 → body). bash 에서 함수는 프로세스(셸) 수명 동안
 * 남는다 — REPL 에서 한 줄에 정의하고 다음 줄에서 호출해도 살아있다(docker 확인).
 * 게임의 인터랙티브 REPL 은 Enter 한 번 = `Shell.exec()` 한 번이라, env/cwd 처럼
 * ShellState(= createShell 클로저의 영구 state)에 둬야 exec 호출을 넘어 함수가
 * 살아남는다. run() 은 매 호출마다 RunCtx 를 새로 만들지만, RunCtx.functions 는
 * (isolateFunctions 가 아닌 한) 이 state.functions 와 같은 Map 참조를 공유한다.
 */
export interface ShellState {
  cwd: string
  oldPwd: string
  env: Record<string, string>
  lastExitCode: number
  readonly home: string
  functions: Map<string, ListNode>
  /**
   * 인덱스 배열(이름 → 원소 문자열 배열). M3 Part 3 은 이 저장 테이블만 추가한다 —
   * `arr=(...)` 대입 파싱과 `${arr[@]}` 확장은 각각 task 2/3 이다. 배열 "값"은 언제나
   * 통째로 교체된다(원소를 in-place 로 mutate 하지 않는다) — 그래야 아래 childCtx/
   * execScriptFile 의 얕은 `new Map(parent)` 복사만으로 서브셸/스크립트 격리가 맞는다.
   * (원소 배열 자체를 in-place 로 고치면 자식·부모가 같은 배열 객체를 참조해 격리가 샌다.)
   */
  arrays: Map<string, string[]>
}

export interface CommandEnv {
  name: string                 // argv[0]
  args: string[]               // argv[1..]
  stdin: string
  /**
   * stdin 이 `< file` 리다이렉션에서 왔는가? 파이프에서 왔으면 false.
   * GNU wc 는 이 둘을 구분해 출력 폭을 다르게 쓴다. 파이프는 크기를 미리 알 수 없다.
   */
  stdinFromFile: boolean
  /**
   * `while read`/`for` 루프가 주입하는 가변 stdin 커서(task 6). 있으면 `read` 는 `e.stdin`
   * 대신 여기서 논리 줄 하나를 소비하고 `rest` 를 갱신한다 — 그래서 반복마다 다음 줄을
   * 읽는다. 인터프리터(runSimpleCommand)가 주입하되, 명령에 **자체 `< file` 리다이렉션이
   * 있으면 주입하지 않는다**(그 명령은 자기 파일을 stdin 으로 써야 하므로 — 커서가
   * 가로채면 안 된다). 루프 밖의 단독 `read` 에는 애초에 커서가 없다.
   */
  stdinCursor?: StdinCursor
  fs: VFS
  state: ShellState
  /**
   * 이 명령이 다른 명령줄을 실행해야 할 때(find -exec, xargs) 쓰는 콜백.
   * 인터프리터가 주입한다. 같은 fs/state/budget 위에서 돈다.
   * exec()가 절대 reject 안 하듯 이 콜백도 ExecResult 를 resolve 한다.
   */
  runLine?: (line: string) => Promise<ExecResult>
  /**
   * 현재 몇 겹의 루프(while/until/for) 안에서 실행 중인지. break/continue 빌트인이
   * 이 값으로 "루프 안이면 신호를 던지고, 밖이면 경고만 하고 no-op" 을 가른다.
   * 인터프리터가 주입한다(없으면 0으로 취급 = 루프 밖).
   */
  loopDepth?: number
  /**
   * 현재 몇 겹의 함수 호출 안에서 실행 중인지. return 빌트인이 이 값으로 "함수 안이면
   * ReturnSignal 을 던지고, 밖이면 경고만 하고 no-op(exit 2)" 을 가른다 — break/continue
   * 가 loopDepth 로 판정하는 것과 같은 원리다. 인터프리터가 주입한다(없으면 0 = 함수 밖).
   * 서브셸/명령치환(childCtx) 안에서는 0으로 리셋된다 — bash 는 `$( )` 안의 return 을
   * "함수 밖"으로 본다(치환 셸에서 벗어날 뿐 바깥 함수를 벗어나지 않는다).
   */
  funcDepth?: number
}

/**
 * `while read`/`for ... read` 루프가 본문에 흘려주는 **가변 stdin 커서**(M3 Part 3 task 6).
 * 루프가 자기 stdin(`< file` 리다이렉션 또는 파이프 입력) 전체를 `rest` 에 담아 만들고,
 * 본문/조건의 `read` 가 논리 줄 하나를 소비할 때마다 소비한 만큼 `rest` 를 앞에서 잘라
 * 갱신한다 — 그래서 매 반복이 **다음** 줄을 읽고, 소진되면 `read` 가 exit 1 을 내 `while
 * read` 조건이 거짓이 돼 루프가 끝난다. `e.stdin`(명령마다 불변 복사)과 달리 반복 간에
 * 상태가 이어지는 유일한 통로다. 커서가 없으면(`e.stdinCursor` 미주입) `read` 는 예전대로
 * `e.stdin` 한 번만 읽는다(단독 `read v < file`, 파이프 `echo x | read v`).
 */
export interface StdinCursor { rest: string }

export type CommandOutput = ExecResult
export type CommandFn = (e: CommandEnv) => CommandOutput | Promise<CommandOutput>

export interface Shell {
  exec(line: string): Promise<ExecResult>
  readonly fs: VFS
  readonly cwd: string
  readonly env: Record<string, string>
}

export const ok = (stdout = ''): CommandOutput => ({ stdout, stderr: '', exitCode: 0 })
export const fail = (stderr: string, exitCode = 1): CommandOutput => ({ stdout: '', stderr, exitCode })
