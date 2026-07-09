import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

export const rmdir: CommandFn = ({ args, fs, state }) => {
  // 지원하는 rmdir 플래그는 없지만(-p 등은 이 태스크 범위 밖), parseFlags 로 걸러야
  // `-`로 시작하는 우연한 인자를 삭제 대상 이름으로 오인하지 않는다(다른 코어유틸과
  // 일관된 처리).
  const { rest } = parseFlags(args)
  let stderr = ''
  let exitCode = 0
  for (const target of rest) {
    try { fs.rmdir(fs.resolve(target, state.cwd)) }
    catch (e) { stderr += `rmdir: failed to remove '${target}': ${errnoText(e)}\n`; exitCode = 1 }
  }
  return { stdout: '', stderr, exitCode }
}
