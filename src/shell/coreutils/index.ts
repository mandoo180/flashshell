import type { CommandFn } from '../types'
import { cat } from './cat'

export const coreutils: Record<string, CommandFn> = { cat }
