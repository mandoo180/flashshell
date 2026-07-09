import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

export const mkdir: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const parents = flags.has('p')
  let stderr = ''
  let exitCode = 0
  for (const target of rest) {
    try { fs.mkdir(fs.resolve(target, state.cwd), { recursive: parents }) }
    catch (e) { stderr += `mkdir: cannot create directory '${target}': ${errnoText(e)}\n`; exitCode = 1 }
  }
  return { stdout: '', stderr, exitCode }
}
