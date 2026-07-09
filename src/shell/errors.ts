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
