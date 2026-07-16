import { describe, it, expect } from 'vitest'
import { allProblems } from './index'
import type { LocalizedText } from '../types'

function textFields(p: (typeof allProblems)[number]): [string, LocalizedText][] {
  return [
    ['title', p.title],
    ['prompt', p.prompt],
    ['explanation', p.explanation],
    ...p.hints.map((h, i) => [`hints[${i}]`, h] as [string, LocalizedText]),
  ]
}

describe('문제 텍스트 무결성 (60문제 × title/prompt/hints/explanation)', () => {
  it('모든 필드의 en/ko 가 비어 있지 않다', () => {
    expect(allProblems.length).toBe(60)
    for (const p of allProblems) {
      for (const [name, tx] of textFields(p)) {
        expect(tx.en.trim(), `${p.id} ${name}.en`).not.toBe('')
        expect(tx.ko.trim(), `${p.id} ${name}.ko`).not.toBe('')
      }
    }
  })
})
