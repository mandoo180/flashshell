import { createShell, VFS } from '../shell/index'
import type { Shell } from '../shell/types'
import type { Problem } from './types'

export const PLAYER_HOME = '/home/player'

/**
 * `PLAYER_HOME`이 디렉터리로 존재하도록 보장한다. `setup`이 홈을 지우거나(rm),
 * 파일 등 디렉터리가 아닌 무언가로 덮어썼을 수 있으므로 setup 전후 모두 호출한다.
 * 디렉터리가 아닌 무언가가 그 자리에 있으면 지우고 다시 만든다 — 절대 죽지 않는다.
 */
function ensurePlayerHome(fs: VFS): void {
  if (fs.exists(PLAYER_HOME) && !fs.isDir(PLAYER_HOME)) {
    fs.rm(PLAYER_HOME, { recursive: true })
  }
  if (!fs.exists(PLAYER_HOME)) {
    fs.mkdir(PLAYER_HOME, { recursive: true })
  }
}

/** 문제의 setup 을 돌린 새 셸. 리셋도 이 함수를 다시 부르면 된다. */
export function createShellForProblem(problem: Problem): Shell {
  const fs = new VFS()
  ensurePlayerHome(fs)
  problem.setup(fs)
  // setup 이 /home/player 를 지우거나 덮어썼어도 셸은 항상 유효한 홈 디렉터리로 시작한다.
  ensurePlayerHome(fs)
  return createShell({ fs, cwd: PLAYER_HOME, home: PLAYER_HOME })
}
