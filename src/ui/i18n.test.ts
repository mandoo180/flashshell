import { describe, it, expect, beforeEach } from 'vitest'
import {
  detectLang, loadLang, saveLang, applyDocumentLang,
  LANG_STORAGE_KEY, t, lockedStatus, STRINGS, EXEC_LIMIT_MARKER,
} from './i18n'

describe('detectLang: 저장값 > 브라우저 감지 > en 기본', () => {
  it('유효한 저장값이 감지보다 우선한다', () => {
    expect(detectLang('en', 'ko-KR')).toBe('en')
    expect(detectLang('ko', 'en-US')).toBe('ko')
  })
  it('저장값이 없거나 손상이면 navigator 언어로 감지한다', () => {
    expect(detectLang(null, 'ko')).toBe('ko')
    expect(detectLang(null, 'ko-KR')).toBe('ko')
    expect(detectLang('fr', 'ko-KR')).toBe('ko') // 손상 저장값은 무시하고 감지로
    expect(detectLang(null, 'en-US')).toBe('en')
    expect(detectLang(null, 'ja-JP')).toBe('en') // ko 외 전부 en
    expect(detectLang(null, undefined)).toBe('en')
  })
})

describe('loadLang/saveLang', () => {
  beforeEach(() => { localStorage.clear() })
  it('saveLang 이 flashshell.lang.v1 에 쓰고 loadLang 이 읽는다', () => {
    saveLang('en')
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en')
    expect(loadLang()).toBe('en')
  })
  it('저장값이 없으면 감지로 — 테스트 환경은 navigator ko-KR 오버라이드라 ko', () => {
    expect(loadLang()).toBe('ko')
  })
})

describe('applyDocumentLang / t / lockedStatus', () => {
  it('<html lang> 을 갱신한다', () => {
    applyDocumentLang('en')
    expect(document.documentElement.lang).toBe('en')
    applyDocumentLang('ko')
    expect(document.documentElement.lang).toBe('ko')
  })
  it('t 는 언어·키로 사전을 찾는다', () => {
    expect(t('ko', 'sheetSolution')).toBe('모범답안')
    expect(t('en', 'sheetSolution')).toBe('SOLUTION')
  })
  it('lockedStatus 는 문항 수를 보간한다', () => {
    expect(lockedStatus('ko', 8)).toBe('LOCKED — 이전 레벨 8문제 필요')
    expect(lockedStatus('en', 8)).toBe('LOCKED — solve 8 in the previous level')
  })
  it('STRINGS 전 키의 en/ko 가 비어 있지 않다', () => {
    for (const [key, tx] of Object.entries(STRINGS)) {
      expect(tx.en.trim(), `${key}.en`).not.toBe('')
      expect(tx.ko.trim(), `${key}.ko`).not.toBe('')
    }
  })
})

describe('EXEC_LIMIT_MARKER', () => {
  it('ko 사전 값과 정확히 일치한다 (엔진이 내는 상수의 UI측 미러)', () => {
    expect(STRINGS.execLimit.ko).toBe(EXEC_LIMIT_MARKER)
    expect(EXEC_LIMIT_MARKER.endsWith('\n')).toBe(true)
  })
})
