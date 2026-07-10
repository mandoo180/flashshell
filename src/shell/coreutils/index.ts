import type { CommandFn } from '../types'
import { ls } from './ls'
import { cat } from './cat'
import { head } from './head'
import { tail } from './tail'
import { wc } from './wc'
import { stat } from './stat'
import { grep } from './grep'
import { sort } from './sort'
import { cp } from './cp'
import { mv } from './mv'
import { rm } from './rm'
import { mkdir } from './mkdir'
import { rmdir } from './rmdir'
import { touch } from './touch'
import { ln } from './ln'
import { chmod } from './chmod'
import { cut } from './cut'
import { tr } from './tr'
import { uniq } from './uniq'
import { sed } from './sed'
import { awk } from './awk'
import { find } from './find'
import { xargs } from './xargs'
import { diff } from './diff'

export const coreutils: Record<string, CommandFn> = {
  ls, cat, head, tail, wc, stat, grep, sort,
  cp, mv, rm, mkdir, rmdir, touch, ln, chmod,
  cut, tr, uniq, sed, awk, find, xargs, diff,
}
