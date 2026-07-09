import type { CommandFn } from '../types'
import { ok } from '../types'

export const trueCmd: CommandFn = () => ok()
export const falseCmd: CommandFn = () => ({ stdout: '', stderr: '', exitCode: 1 })
export const colon: CommandFn = () => ok()
