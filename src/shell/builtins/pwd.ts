import type { CommandFn } from '../types'
import { ok } from '../types'

export const pwd: CommandFn = ({ state }) => ok(`${state.cwd}\n`)
