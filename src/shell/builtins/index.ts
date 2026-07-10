import type { CommandFn } from '../types'
import { cd } from './cd'
import { pwd } from './pwd'
import { echo } from './echo'
import { exportCmd } from './export'
import { unset } from './unset'
import { trueCmd, falseCmd, colon } from './truefalse'
import { testCmd } from './test'

export const builtins: Record<string, CommandFn> = {
  cd, pwd, echo, unset,
  export: exportCmd,
  true: trueCmd,
  false: falseCmd,
  ':': colon,
  test: testCmd,
  '[': testCmd,
}
