import type { CommandFn } from '../types'
import { ls } from './ls'
import { cat } from './cat'
import { head } from './head'
import { tail } from './tail'
import { wc } from './wc'
import { stat } from './stat'
import { grep } from './grep'
import { sort } from './sort'

export const coreutils: Record<string, CommandFn> = {
  ls, cat, head, tail, wc, stat, grep, sort,
}
