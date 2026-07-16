import { describe, it, expect } from 'vitest'
import { PLAYER_HOME, createShellForProblem } from './harness'
import type { Problem, Level } from './types'

describe('createShellForProblem (하니스)', () => {
  const base = {
    id: 'l1-01',
    level: 1 as Level,
    title: { en: '', ko: '' },
    prompt: { en: '', ko: '' },
    hints: [],
    check: () => false,
    solution: '',
    wrongAnswer: '',
    explanation: { en: '', ko: '' },
  }

  it('setup이 아무 것도 하지 않아도 홈 디렉터리가 존재하고 cwd/home이 거기다', () => {
    const problem: Problem = { ...base, setup: () => {} }
    const shell = createShellForProblem(problem)
    expect(shell.fs.isDir(PLAYER_HOME)).toBe(true)
    expect(shell.cwd).toBe(PLAYER_HOME)
  })

  it('setup이 /home/player 를 지워도 셸이 시작될 때 홈이 살아있다', () => {
    const problem: Problem = {
      ...base,
      setup: (fs) => {
        fs.rm(PLAYER_HOME, { recursive: true })
      },
    }
    const shell = createShellForProblem(problem)
    expect(shell.fs.isDir(PLAYER_HOME)).toBe(true)
  })

  it('setup이 /home/player 를 디렉터리가 아닌 파일로 덮어써도 홈은 디렉터리로 복구된다', () => {
    const problem: Problem = {
      ...base,
      setup: (fs) => {
        fs.rm(PLAYER_HOME, { recursive: true })
        fs.writeFile(PLAYER_HOME, 'oops, not a directory')
      },
    }
    const shell = createShellForProblem(problem)
    expect(shell.fs.isDir(PLAYER_HOME)).toBe(true)
  })

  it('두 셸은 VFS를 공유하지 않는다 — 이것이 문제 리셋의 동작 원리다', async () => {
    const problem: Problem = {
      ...base,
      setup: (fs) => {
        fs.writeFile(`${PLAYER_HOME}/a.txt`, 'seed')
      },
    }
    const shellA = createShellForProblem(problem)
    const shellB = createShellForProblem(problem)

    await shellA.exec(`rm ${PLAYER_HOME}/a.txt`)

    expect(shellA.fs.exists(`${PLAYER_HOME}/a.txt`)).toBe(false)
    expect(shellB.fs.exists(`${PLAYER_HOME}/a.txt`)).toBe(true)
  })

  it('exec 으로 만든 변화가 shell.fs 에 그대로 보인다 (check가 보는 fs는 살아있는 참조)', async () => {
    const problem: Problem = { ...base, setup: () => {} }
    const shell = createShellForProblem(problem)

    await shell.exec(`touch ${PLAYER_HOME}/done.txt`)

    expect(shell.fs.exists(`${PLAYER_HOME}/done.txt`)).toBe(true)
  })
})
