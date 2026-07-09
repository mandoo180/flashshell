import type { CommandFn } from '../types'
import { ok } from '../types'

export const unset: CommandFn = ({ args, state }) => {
  for (const name of args) delete state.env[name]
  return ok()
}
