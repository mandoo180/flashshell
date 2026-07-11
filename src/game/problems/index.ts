import type { Problem } from '../types'
import { l1 } from './l1'
import { l2 } from './l2'
import { l3 } from './l3'
import { l4 } from './l4'
import { l5 } from './l5'

export const allProblems: Problem[] = [...l1, ...l2, ...l3, ...l4, ...l5]
