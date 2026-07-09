import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

/**
 * task-11 trap 8: 반드시 lstat 을 써야 한다(exists/lookup 이 아니라) — 심볼릭
 * 링크가 대상이면 링크 자체를 지워야지 그게 가리키는 파일을 지우면 안 된다.
 * lstat 은 마지막 구성요소의 심볼릭 링크를 따라가지 않으므로(vfs.ts 문서 참고)
 * 존재 확인과 실제 삭제(fs.rm, 이것도 내부에서 lstat 을 씀) 양쪽 다 링크 자체를
 * 본다. 실측: `ln -s real.txt link; rm link` 후 real.txt 내용은 그대로 남는다.
 */
export const rm: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const recursive = flags.has('r') || flags.has('R')
  const force = flags.has('f')

  let stderr = ''
  let exitCode = 0

  for (const target of rest) {
    const abs = fs.resolve(target, state.cwd)
    const node = fs.lstat(abs)
    if (!node) {
      if (!force) { stderr += `rm: cannot remove '${target}': No such file or directory\n`; exitCode = 1 }
      continue
    }
    if (node.kind === 'dir' && !recursive) {
      stderr += `rm: cannot remove '${target}': Is a directory\n`
      exitCode = 1
      continue
    }
    try { fs.rm(abs, { recursive }) } catch (e) { stderr += `rm: ${target}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
