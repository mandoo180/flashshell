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

  it('en 필드에 한글이 없다 — 60문제 번역 완료의 기계적 증명', () => {
    for (const p of allProblems) {
      for (const [name, tx] of textFields(p)) {
        expect(/[가-힣]/.test(tx.en), `${p.id} ${name}.en 에 한글 잔존: ${tx.en}`).toBe(false)
      }
    }
  })
})
