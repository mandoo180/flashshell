import type { CommandEnv } from '../types'
import { errnoText } from '../errors'

export { errnoText }

export interface Source { label: string; text: string }

/** 파일 인자를 읽는다. 없으면 stdin 을 유일한 소스로 삼는다(label 은 빈 문자열). */
export function readSources(e: CommandEnv, files: string[]): { sources: Source[]; stderr: string; failed: boolean } {
  if (files.length === 0) return { sources: [{ label: '', text: e.stdin }], stderr: '', failed: false }

  const sources: Source[] = []
  let stderr = ''
  let failed = false
  for (const file of files) {
    try {
      sources.push({ label: file, text: e.fs.readFile(e.fs.resolve(file, e.state.cwd)) })
    } catch (err) {
      stderr += `${e.name}: ${file}: ${errnoText(err)}\n`
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
