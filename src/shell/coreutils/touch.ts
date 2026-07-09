import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

export const touch: CommandFn = ({ args, fs, state }) => {
  // rmdir.ts와 같은 이유로 parseFlags 로 플래그를 걸러낸다(-a/-m/-d 등은 미지원,
  // 범위 밖) — 대상 파일명만 rest 로 받는다.
  const { rest } = parseFlags(args)
  let stderr = ''
  let exitCode = 0
  for (const target of rest) {
    try { fs.touch(fs.resolve(target, state.cwd)) }
    catch (e) { stderr += `touch: cannot touch '${target}': ${errnoText(e)}\n`; exitCode = 1 }
  }
  return { stdout: '', stderr, exitCode }
}
