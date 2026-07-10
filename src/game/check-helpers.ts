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

/**
 * path 아래 모든 항목(파일·디렉터리·심볼릭 링크)의 절대경로를 재귀로 모은다.
 * find.ts의 walk와 같은 규약: 심볼릭 링크는 그 자체를 목록에 넣을 뿐 따라 들어가
 * 재귀하지 않는다(lstat 기준으로 디렉터리인지 판단) — 순환 링크로 무한루프에
 * 빠지지 않는다. path 자체가 없거나 디렉터리가 아니면 빈 배열. 절대 던지지 않는다.
 */
export function safeWalk(fs: VFS, path: string): string[] {
  const results: string[] = []
  const walk = (p: string): void => {
    let names: string[]
    try {
      names = fs.readdir(p)
    } catch {
      return
    }
    for (const name of names) {
      const child = p === '/' ? `/${name}` : `${p}/${name}`
      results.push(child)
      let isDir = false
      try {
        isDir = fs.lstat(child)?.kind === 'dir'
      } catch {
        isDir = false
      }
      if (isDir) walk(child)
    }
  }
  try {
    walk(path)
  } catch {
    /* 절대 던지지 않는다 */
  }
  return results
}
