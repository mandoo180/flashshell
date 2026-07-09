import { describe, it, expect } from 'vitest'
import { allProblems } from '../src/game/problems/index'
import { createShellForProblem, PLAYER_HOME } from '../src/game/harness'
import type { CheckContext, Problem } from '../src/game/types'

/** 한 줄짜리 답을 실행하고 검증 컨텍스트를 만든다. */
async function runAnswer(problem: Problem, answer: string): Promise<CheckContext> {
  const shell = createShellForProblem(problem)
  const history: string[] = []
  let lastResult = { stdout: '', stderr: '', exitCode: 0 }
  for (const line of answer.split('\n')) {
    if (line.trim() === '') continue
    history.push(line)
    lastResult = await shell.exec(line)
  }
  return { fs: shell.fs, lastResult, history, cwd: shell.cwd }
}

describe('문제 정합성', () => {
  it('문제가 하나 이상 있다', () => {
    expect(allProblems.length).toBeGreaterThan(0)
  })

  it('id 가 중복되지 않는다', () => {
    const ids = allProblems.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('모든 문제가 필수 필드를 채웠다', () => {
    for (const p of allProblems) {
      expect(p.prompt, p.id).not.toBe('')
      expect(p.solution, p.id).not.toBe('')
      expect(p.wrongAnswer, p.id).not.toBe('')
      expect(p.explanation, p.id).not.toBe('')
      expect(p.hints.length, p.id).toBeGreaterThan(0)
    }
  })

  it('setup 은 홈 디렉터리를 지우지 않는다', () => {
    for (const p of allProblems) {
      const shell = createShellForProblem(p)
      expect(shell.fs.isDir(PLAYER_HOME), p.id).toBe(true)
    }
  })
})

describe('모든 모범답안은 검증기를 통과한다', () => {
  for (const problem of allProblems) {
    it(`${problem.id}: solution passes check`, async () => {
      const ctx = await runAnswer(problem, problem.solution)
      expect(ctx.lastResult.stderr, `${problem.id} 의 모범답안이 stderr 를 냈다`).toBe('')
      expect(problem.check(ctx)).toBe(true)
    })
  }
})

describe('모든 오답은 검증기에 걸린다', () => {
  for (const problem of allProblems) {
    it(`${problem.id}: wrongAnswer fails check`, async () => {
      const ctx = await runAnswer(problem, problem.wrongAnswer)
      expect(problem.check(ctx)).toBe(false)
    })
  }
})

describe('검증기는 아무것도 하지 않은 상태를 통과시키지 않는다', () => {
  for (const problem of allProblems) {
    it(`${problem.id}: 초기 상태는 미해결`, async () => {
      const ctx = await runAnswer(problem, 'true')
      expect(problem.check(ctx)).toBe(false)
    })
  }
})

describe('검증기는 예외를 던지지 않는다', () => {
  for (const problem of allProblems) {
    it(`${problem.id}: rm -rf 이후에도 죽지 않는다`, async () => {
      const ctx = await runAnswer(problem, 'rm -rf *\nrm -rf .*')
      expect(() => problem.check(ctx)).not.toThrow()
    })
  }
})
