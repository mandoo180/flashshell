import type { CommandEnv } from '../types'
import { errnoText, VfsError } from '../errors'

export { errnoText }

export interface Source { label: string; text: string }

/** readSources 가 실패한 파일 하나마다 stderr 한 줄을 만들 때 쓰는 문구 생성기. */
export type ErrorFormatter = (file: string, err: unknown) => string

/**
 * err 이 "그 경로가 디렉터리라서" 실패했다는 뜻인지. GNU head/tail/sort 는 ENOENT
 * 와 EISDIR 에 서로 다른 문구 틀을 쓰므로(예: head 는 "cannot open ... for reading"
 * vs "error reading ..."), 포매터가 이걸로 갈라 쓴다. errnoText() 로 사람이 읽는
 * 문구를 얻는 것과는 별개다 — 여긴 새 errno→문구 표를 만드는 게 아니라 기존
 * VfsError.code 하나만 확인한다.
 */
export function isDirectoryError(err: unknown): boolean {
  return err instanceof VfsError && err.code === 'EISDIR'
}

/**
 * 파일 인자를 읽는다. 없으면 stdin 을 유일한 소스로 삼는다(label 은 빈 문자열).
 * formatError 를 생략하면 cat/wc/grep 이 오늘까지 써온 `${e.name}: ${file}: ${msg}`
 * 그대로다 — head/tail/sort 만 자기 GNU 문구에 맞는 포매터를 넘긴다(task-10 finding 1).
 */
export function readSources(
  e: CommandEnv,
  files: string[],
  formatError: ErrorFormatter = (file, err) => `${e.name}: ${file}: ${errnoText(err)}`,
): { sources: Source[]; stderr: string; failed: boolean } {
  if (files.length === 0) return { sources: [{ label: '', text: e.stdin }], stderr: '', failed: false }

  const sources: Source[] = []
  let stderr = ''
  let failed = false
  for (const file of files) {
    try {
      sources.push({ label: file, text: e.fs.readFile(e.fs.resolve(file, e.state.cwd)) })
    } catch (err) {
      stderr += `${formatError(file, err)}\n`
      failed = true
    }
  }
  return { sources, stderr, failed }
}

/** 후행 개행을 무시하고 줄로 쪼갠다. 빈 텍스트는 빈 배열. */
export function toLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\n$/, '').split('\n')
}

/**
 * 진짜 바이트 수. JS 문자열의 .length 는 UTF-16 코드유닛이라
 * '한'.length === 1 이지만 GNU wc -c 는 3을 센다.
 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** `head -2` 같은 숫자 축약형을 `head -n 2` 로 옮긴다. head 와 tail 이 함께 쓴다. */
export function normalizeCountFlag(args: string[]): string[] {
  return args.map((arg) => (/^-\d+$/.test(arg) ? `-n${arg.slice(1)}` : arg))
}

/** 플래그와 위치인자를 가른다. `-abc` 는 `-a -b -c` 로 펼친다. */
export function parseFlags(args: string[], takesValue: string[] = []): { flags: Map<string, string>; rest: string[] } {
  const flags = new Map<string, string>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') { rest.push(...args.slice(i + 1)); break }
    if (!arg.startsWith('-') || arg === '-') { rest.push(arg); continue }
    for (let j = 1; j < arg.length; j++) {
      const letter = arg[j]!
      if (takesValue.includes(letter)) {
        const inline = arg.slice(j + 1)
        flags.set(letter, inline !== '' ? inline : (args[++i] ?? ''))
        break
      }
      flags.set(letter, '')
    }
  }
  return { flags, rest }
}
