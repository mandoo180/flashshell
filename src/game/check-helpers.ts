import type { VFS } from '../shell/vfs'

/** 파일을 읽는다. 없거나 디렉터리면 null. 절대 던지지 않는다. */
export function safeRead(fs: VFS, path: string): string | null {
  try {
    return fs.readFile(path)
  } catch {
    return null
  }
}

/** 디렉터리 목록. 없으면 null. 절대 던지지 않는다. */
export function safeReaddir(fs: VFS, path: string): string[] | null {
  try {
    return fs.readdir(path)
  } catch {
    return null
  }
}

/** 후행 공백·개행을 무시한 비교. */
export function trimEq(actual: string | null, expected: string): boolean {
  return actual !== null && actual.trim() === expected.trim()
}
