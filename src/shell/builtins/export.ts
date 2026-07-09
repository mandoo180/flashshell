import type { CommandFn } from '../types'
import { ok } from '../types'

export const exportCmd: CommandFn = ({ args, state }) => {
  for (const arg of args) {
    const eq = arg.indexOf('=')
    if (eq === -1) continue          // `export FOO` — 이미 있는 변수를 내보낼 뿐, 우리에겐 무의미
    state.env[arg.slice(0, eq)] = arg.slice(eq + 1)
  }
  return ok()
}
