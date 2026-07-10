export type ErrCode =
  | 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EACCES' | 'EINVAL'

export class VfsError extends Error {
  constructor(public readonly code: ErrCode, public readonly path: string) {
    super(`${code}: ${path}`)
    this.name = 'VfsError'
  }
}

export class ExecutionLimitError extends Error {
  constructor() {
    super('execution limit exceeded')
    this.name = 'ExecutionLimitError'
  }
}

/**
 * 제어-흐름 신호의 공통 조상. ExecutionLimitError 처럼 "얌전한 ExecResult 로 바꾸지 않고
 * 그대로 위로 던지는" 특별한 예외로, 가장 가까운 경계(루프/함수)가 잡아 소비한다.
 * stdout/stderr 는 신호가 리스트를 뚫고 올라가는 도중 유실될 뻔한 부분 출력을 실어
 * 나른다 — `echo x; break`/`echo x; return` 의 `echo x` 출력이 사라지지 않게 하기
 * 위함이다(우리는 출력을 스트리밍하지 않고 문자열로 모아서 반환하므로, 중간에 던지면
 * 그 지점까지의 출력이 반환값에 실리지 못한다). runList 가 이 조상 타입을 잡아 지금까지
 * 누적한 출력을 앞에 실어 다시 던진다 — LoopSignal 이든 ReturnSignal 이든 동일하게.
 */
export abstract class ControlSignal extends Error {
  stdout = ''
  stderr = ''
  constructor(name: string) {
    super(name)
    this.name = name
  }
}

/**
 * `break`/`continue` 를 루프 경계(runWhile/runFor)까지 전달하는 제어-흐름 신호.
 * `count`(레벨)는 몇 겹의 루프를 벗어날지다(`break 2`).
 */
export abstract class LoopSignal extends ControlSignal {
  constructor(public count: number, name: string) {
    super(name)
  }
}

export class BreakSignal extends LoopSignal {
  constructor(count = 1) { super(count, 'BreakSignal') }
}

export class ContinueSignal extends LoopSignal {
  constructor(count = 1) { super(count, 'ContinueSignal') }
}

/**
 * `return [N]` 을 함수 호출 경계(callFunction)까지 전달하는 제어-흐름 신호. `break`/
 * `continue` 와 같은 패턴이지만, 루프가 아니라 가장 가까운 함수 호출을 벗어난다. `code`
 * 는 그 함수 호출의 exit code (이미 0..255 로 감싼 값). 함수/소스 스크립트 밖에서 던지지
 * 않게 하는 판정(funcDepth)은 return 빌트인이 진다 — break/continue 가 loopDepth 로
 * 판정하는 것과 같은 원리다.
 */
export class ReturnSignal extends ControlSignal {
  constructor(public code: number) {
    super('ReturnSignal')
  }
}

const ERRNO_TEXT: Record<ErrCode, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  EACCES: 'Permission denied',
  EINVAL: 'Invalid argument',
}

/** 예외를 리눅스가 쓰는 사람 읽는 문구로 옮긴다. 인터프리터와 코어유틸이 함께 쓴다. */
export function errnoText(error: unknown): string {
  if (error instanceof VfsError) return ERRNO_TEXT[error.code]
  return error instanceof Error ? error.message : String(error)
}
