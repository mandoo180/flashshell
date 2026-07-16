# FlashShell EN/KO 로컬라이제이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 60문제 콘텐츠 + UI 크롬 + README를 EN/KO 이중 언어로 만들고, 브라우저 감지 + `[EN|KO]` 토글 + localStorage 유지를 붙인다.

**Architecture:** i18n 라이브러리 없이 `LocalizedText = { en, ko }`를 문제 정의에 병기(colocate)한다 — TS strict가 번역 누락을 컴파일 에러로 강제한다. UI 크롬은 `src/ui/i18n.ts`의 타입된 사전 하나 + `useT` 훅. 언어 상태는 Zustand 스토어의 `lang` 필드 하나이며, 전환은 리렌더만 일으키고 셸 세션·워커에는 아무 메시지도 보내지 않는다.

**Tech Stack:** 기존 그대로 — Vite 8 + React 19 + TS strict + Zustand 5, Vitest(projects: shell=node / ui=jsdom), Playwright. **신규 의존성 0.**

## Global Constraints

(스펙: `docs/superpowers/specs/2026-07-16-flashshell-i18n-design.md`)

- **`src/shell/**` 및 `tests/shell/golden/` 절대 무변경.** 태스크마다 `git diff --stat main -- src/shell tests/shell/golden/` 출력이 비어 있어야 한다. diff가 생기면 그 자체가 리뷰 리젝트 사유.
- **KO 원문 무변경**: 기존 한국어 문자열은 바이트 단위로 그대로. 번역 태스크의 diff에서 `ko:` 값이 바뀌면 리젝트.
- **번역 금지 영역**: `solution`/`wrongAnswer`(명령어), `setup()`이 만드는 파일 내용, 지문·힌트·해설 속 파일명/디렉터리명/명령/기대 출력 리터럴(`readme.txt`, `ACCESS GRANTED` 등)은 en에서도 동일 문자열이어야 한다.
- **영어 고정 라벨(양 언어 공통, 사전에 넣지 않는다)**: `FLASHSHELL`, `✓ SOLVED`, `n/m SOLVED`, `RESET`, `HINT n/m`, `← LEVELS`, `[ SOLVED ]`, `NEXT ▸`, `COMING SOON`, `LOCKED —` 접두, `LEVEL n`.
- localStorage 키는 정확히 `flashshell.lang.v1`. (진행도 키 `flashshell.progress.v1`과 같은 verbatim 규칙.)
- `LocalizedText` 필드에 옵셔널 없음 — `{ en: string; ko: string }` 둘 다 필수.
- EN 톤: 간결한 사이버펑크 미션 브리핑체. 기술 용어(concatenate, change directory 등)는 원어 그대로.
- 커밋 메시지는 기존 컨벤션(`feat(i18n): …`, `test(i18n): …`, `docs: …`).

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/game/types.ts` | `Lang`, `LocalizedText` 타입 + `Problem` 텍스트 필드 전환 |
| `src/ui/i18n.ts` (신규) | 저장 키, `detectLang`/`loadLang`/`saveLang`/`applyDocumentLang`, `STRINGS` 사전, `t`, `lockedStatus` — **스토어 무의존(순수)** |
| `src/ui/useT.ts` (신규) | `useT()` 훅 — 스토어 `lang` 구독 (useSignal.ts 패턴; i18n.ts↔store.ts 순환 import 방지용 분리) |
| `src/ui/LangToggle.tsx` (신규) | `[EN\|KO]` 토글 컴포넌트 (LevelSelect 우상단 + HudCard 메타 행) |
| `src/ui/store.ts` | `lang` 상태 + `setLang` 액션 |
| `src/ui/LevelSelect.tsx` `HudCard.tsx` `RevealSheet.tsx` | 크롬 문자열 사전 전환 + 문제 필드 `[lang]` 인덱싱 |
| `src/game/problems/l1~l6.ts` | 60문제 텍스트 병기 |
| `src/game/problems/integrity.test.ts` (신규) | en/ko 비어있지 않음 + en 무한글 검증 |
| `src/ui/test-setup.ts`, `vitest.config.ts`, `playwright.config.ts` | 테스트 환경을 ko 로케일로 고정(기존 한국어 쿼리 테스트 무변경 통과) |
| `README.md`, `README.ko.md` (신규) | EN 전환 + KO 이동, 상호 링크 |

**태스크 경계의 핵심 트릭:** Task 3이 `Problem` 타입을 한 번에 뒤집으면서 6개 레벨 파일 전부를 **en=ko 복사본**으로 기계적 병기한다(컴파일·전 테스트 초록 유지). Task 4~6이 그 en 복사본을 진짜 번역으로 교체한다 — 번역 태스크의 diff는 `en:` 줄만 바뀌는 순수 텍스트 리뷰가 된다.

---

### Task 1: i18n 코어 — 타입, 사전 모듈, 스토어 lang

**Files:**
- Modify: `src/game/types.ts`
- Create: `src/ui/i18n.ts`
- Create: `src/ui/useT.ts`
- Modify: `src/ui/store.ts` (interface + create 초기화 부근, `GameStore`에 2줄 + 구현 몇 줄)
- Modify: `src/ui/test-setup.ts` (navigator.language 오버라이드)
- Modify: `vitest.config.ts` (ui 프로젝트 include에 `src/ui/i18n.test.ts` 추가)
- Test: `src/ui/i18n.test.ts` (신규), `src/ui/store.test.ts` (추가)

**Interfaces:**
- Consumes: 없음 (기반 태스크)
- Produces (이후 전 태스크가 사용):
  - `src/game/types.ts`: `export type Lang = 'en' | 'ko'`, `export interface LocalizedText { en: string; ko: string }`
  - `src/ui/i18n.ts`: `LANG_STORAGE_KEY = 'flashshell.lang.v1'`, `detectLang(stored: string | null, navLang: string | undefined): Lang`, `loadLang(): Lang`, `saveLang(lang: Lang): void`, `applyDocumentLang(lang: Lang): void`, `STRINGS`(아래 키 전부), `type StringKey = keyof typeof STRINGS`, `t(lang: Lang, key: StringKey): string`, `lockedStatus(lang: Lang, n: number): string`
  - `src/ui/useT.ts`: `useT(): (key: StringKey) => string`
  - `src/ui/store.ts`: `lang: Lang`, `setLang(lang: Lang): void`

- [ ] **Step 1: 타입 추가** — `src/game/types.ts`의 `export type Level` 근처에:

```ts
export type Lang = 'en' | 'ko'

/** UI·문제 텍스트의 이중 언어 병기. 둘 다 필수 — 번역 누락은 컴파일 에러다. */
export interface LocalizedText {
  en: string
  ko: string
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `src/ui/i18n.test.ts` (jsdom에서 돈다 — Step 5에서 include 추가):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  detectLang, loadLang, saveLang, applyDocumentLang,
  LANG_STORAGE_KEY, t, lockedStatus, STRINGS,
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
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/ui/i18n.test.ts`
Expected: FAIL — `Cannot find module './i18n'` (또는 include 미반영으로 "No test files found" → Step 5의 vitest.config 수정을 먼저 적용하고 다시 실패 확인)

- [ ] **Step 4: `src/ui/i18n.ts` 구현**

```ts
import type { Lang, LocalizedText } from '../game/types'

export const LANG_STORAGE_KEY = 'flashshell.lang.v1'

/** 저장값 > 브라우저 감지 > en. 순수 함수 — 저장소·navigator 는 loadLang 이 주입한다. */
export function detectLang(stored: string | null, navLang: string | undefined): Lang {
  if (stored === 'en' || stored === 'ko') return stored
  return navLang?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function loadLang(): Lang {
  try {
    return detectLang(
      globalThis.localStorage?.getItem(LANG_STORAGE_KEY) ?? null,
      globalThis.navigator?.language,
    )
  } catch {
    // 손상된 저장소나 localStorage 부재가 게임을 막아서는 안 된다. (progress.ts 와 동일 방침)
    return 'en'
  }
}

export function saveLang(lang: Lang): void {
  try {
    globalThis.localStorage?.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // 저장 실패는 조용히 무시 — 이번 세션 동안은 스토어 상태로 유지된다.
  }
}

export function applyDocumentLang(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

/**
 * UI 크롬 사전. 문제 텍스트는 여기 넣지 않는다(문제 정의에 병기).
 * HINT/RESET/SOLVED/NEXT ▸ 등 테마 라벨은 양 언어 공통 영어라 사전 밖이다.
 */
export const STRINGS = {
  levelsSub: {
    en: 'Problems only the command line can solve. Pick a level.',
    ko: '명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.',
  },
  langGroup: { en: 'Language', ko: '언어' },
  prevProblem: { en: 'Previous problem', ko: '이전 문제' },
  nextProblem: { en: 'Next problem', ko: '다음 문제' },
  expandCard: { en: 'Expand problem card', ko: '문제 카드 펼치기' },
  collapseCard: { en: 'Collapse problem card', ko: '문제 카드 접기' },
  explanationDialog: { en: 'Explanation', ko: '해설' },
  sheetSolution: { en: 'SOLUTION', ko: '모범답안' },
  sheetExplanation: { en: 'EXPLANATION', ko: '해설' },
} satisfies Record<string, LocalizedText>

export type StringKey = keyof typeof STRINGS

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[key][lang]
}

/** LOCKED 문구는 문항 수 보간이 필요해 사전이 아니라 함수다. */
export function lockedStatus(lang: Lang, n: number): string {
  return lang === 'ko'
    ? `LOCKED — 이전 레벨 ${n}문제 필요`
    : `LOCKED — solve ${n} in the previous level`
}
```

- [ ] **Step 5: 테스트 환경 배선**

`vitest.config.ts`의 ui 프로젝트 include를:

```ts
test: { name: 'ui', environment: 'jsdom', include: ['src/ui/**/*.test.tsx', 'src/ui/i18n.test.ts'], setupFiles: ['./src/ui/test-setup.ts'] },
```

`src/ui/test-setup.ts` 끝에 추가:

```ts
// jsdom 의 navigator.language 기본값은 'en-US'다. 기존 컴포넌트 테스트는 전부
// 한국어 문자열을 쿼리하므로, 테스트 브라우저를 한국어 로케일로 고정한다 —
// localStorage.clear() + vi.resetModules() 로 스토어를 다시 만드는 테스트
// (Play.test.tsx 레벨 해제 테스트)에서도 감지 결과가 ko 로 안정된다.
// EN 경로는 detectLang 단위 테스트와 LangToggle/e2e 가 명시적으로 검증한다.
Object.defineProperty(window.navigator, 'language', { value: 'ko-KR', configurable: true })
```

- [ ] **Step 6: 스토어에 lang 추가** — `src/ui/store.ts`:

import에 추가:

```ts
import type { Lang, Level, Problem } from '../game/types'
import { loadLang, saveLang, applyDocumentLang } from './i18n'
```

`GameStore` 인터페이스에 (`screen` 아래):

```ts
  lang: Lang
```

액션 선언부에 (`openLevel` 위):

```ts
  setLang(lang: Lang): void
```

모듈 스코프, `export const useGame = create...` 바로 위에:

```ts
// 언어는 스토어 생성 시점에 한 번 결정하고(저장값 > 브라우저 감지), <html lang> 도
// 즉시 맞춘다 — index.html 의 정적 lang="ko" 는 JS 로드 전의 초기값일 뿐이다.
const initialLang = loadLang()
applyDocumentLang(initialLang)
```

create 초기 상태에 (`screen: 'levels',` 아래):

```ts
  lang: initialLang,
```

액션 구현에 (`openLevel` 위):

```ts
  setLang: (lang) => {
    saveLang(lang)
    applyDocumentLang(lang)
    set({ lang })
  },
```

- [ ] **Step 7: useT 훅** — `src/ui/useT.ts` (신규):

```ts
import { useGame } from './store'
import { t, type StringKey } from './i18n'

/**
 * UI 크롬 문자열용 훅. 스토어의 lang 을 구독하므로 토글 시 사용처가 리렌더된다.
 * i18n.ts 는 스토어를 모른다(순수) — 순환 import 를 피하려고 훅만 분리했다.
 * 문제 텍스트는 이 훅이 아니라 `problem.title[lang]` 처럼 직접 인덱싱한다.
 */
export function useT(): (key: StringKey) => string {
  const lang = useGame((s) => s.lang)
  return (key) => t(lang, key)
}
```

- [ ] **Step 8: store.test.ts에 setLang 테스트 추가** (파일 끝, 기존 describe 형식을 따라):

```ts
describe('setLang', () => {
  it('lang 상태를 갱신한다 (node 환경 — localStorage/document 부재에도 안전)', () => {
    useGame.setState({ lang: 'ko' })
    useGame.getState().setLang('en')
    expect(useGame.getState().lang).toBe('en')
  })
})
```

- [ ] **Step 9: 전체 확인**

Run: `npx vitest run src/ui/i18n.test.ts src/ui/store.test.ts`
Expected: PASS (신규 전부 + 기존 store 테스트 무변경 통과)

Run: `npm run build && npm test`
Expected: PASS — 기존 1786개 전부 초록 (이 태스크는 아직 아무 렌더도 바꾸지 않았다)

Run: `git diff --stat main -- src/shell tests/shell/golden/`
Expected: 출력 없음

- [ ] **Step 10: 커밋**

```bash
git add src/game/types.ts src/ui/i18n.ts src/ui/useT.ts src/ui/store.ts src/ui/test-setup.ts src/ui/i18n.test.ts src/ui/store.test.ts vitest.config.ts
git commit -m "feat(i18n): Lang/LocalizedText types, i18n core module, store lang state"
```

---

### Task 2: LangToggle + UI 크롬 전환

**Files:**
- Create: `src/ui/LangToggle.tsx`
- Modify: `src/ui/LevelSelect.tsx`, `src/ui/HudCard.tsx`, `src/ui/RevealSheet.tsx`, `src/ui/theme.css`
- Modify: `playwright.config.ts` (전역 `locale: 'ko-KR'`)
- Test: `src/ui/LangToggle.test.tsx` (신규)

**Interfaces:**
- Consumes: Task 1의 `useT`, `t`, `lockedStatus`, `LocalizedText`, 스토어 `lang`/`setLang`
- Produces: `LangToggle({ className?: string })` 컴포넌트; LevelSelect의 `LEVELS: { level: Level; name: LocalizedText; topic: LocalizedText }[]` (EN 레벨명은 아래 표 verbatim — e2e가 `Exploration`을 쿼리한다)

레벨명·주제 확정값 (verbatim):

| level | name.en | name.ko | topic.en | topic.ko |
|---|---|---|---|---|
| 1 | `Exploration` | `탐색` | `ls · cd · cat · head · tail` | (en과 동일) |
| 2 | `Manipulation` | `조작` | `cp · mv · mkdir · redirection` | `cp · mv · mkdir · 리다이렉션` |
| 3 | `Text Processing` | `텍스트 처리` | `grep · sed · awk · pipes` | `grep · sed · awk · 파이프` |
| 4 | `System` | `시스템` | `find · xargs · chmod` | (en과 동일) |
| 5 | `Scripting` | `스크립팅` | `if · for · while · functions` | `if · for · while · 함수` |
| 6 | `Automation` | `자동화` | `arrays · read · scripts` | `배열 · read · 스크립트` |

- [ ] **Step 1: 실패하는 테스트 작성** — `src/ui/LangToggle.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelSelect } from './LevelSelect'
import { useGame } from './store'

beforeEach(() => {
  localStorage.clear()
  useGame.setState({ lang: 'ko' })
})

describe('LangToggle: EN/KO 전환', () => {
  it('EN 클릭 → 크롬이 영어로 바뀌고, 저장·<html lang> 이 갱신된다', async () => {
    render(<LevelSelect />)
    expect(screen.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'EN' }))

    expect(screen.getByText('Problems only the command line can solve. Pick a level.')).toBeInTheDocument()
    expect(screen.getByText('Exploration')).toBeInTheDocument()
    expect(screen.getAllByText('LOCKED — solve 8 in the previous level').length).toBeGreaterThan(0)
    expect(localStorage.getItem('flashshell.lang.v1')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('KO 로 되돌리면 한국어 크롬으로 복귀한다', async () => {
    render(<LevelSelect />)
    await userEvent.click(screen.getByRole('button', { name: 'EN' }))
    await userEvent.click(screen.getByRole('button', { name: 'KO' }))
    expect(screen.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeInTheDocument()
    expect(screen.getByText('탐색')).toBeInTheDocument()
    expect(localStorage.getItem('flashshell.lang.v1')).toBe('ko')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/ui/LangToggle.test.tsx`
Expected: FAIL — `EN` 버튼 없음 (`Cannot find module './LangToggle'`는 아직 import 안 하므로 없음; getByRole 실패가 맞다)

- [ ] **Step 3: LangToggle 구현** — `src/ui/LangToggle.tsx`:

```tsx
import { useGame } from './store'
import { useT } from './useT'

/** [EN|KO] 토글. 전환은 스토어 lang 만 바꾼다 — 셸 세션·워커·진행도 무접촉. */
export function LangToggle({ className }: { className?: string }) {
  const lang = useGame((s) => s.lang)
  const setLang = useGame((s) => s.setLang)
  const t = useT()
  return (
    <div className={className ? `lang-toggle ${className}` : 'lang-toggle'} role="group" aria-label={t('langGroup')}>
      <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
      <button aria-pressed={lang === 'ko'} onClick={() => setLang('ko')}>KO</button>
    </div>
  )
}
```

- [ ] **Step 4: LevelSelect 전환** — `src/ui/LevelSelect.tsx` 전체를 다음으로:

```tsx
import { useGame } from './store'
import { allProblems } from '../game/problems/index'
import { isLevelUnlocked, solvedInLevel, UNLOCK_THRESHOLD } from '../game/progress'
import type { Level, LocalizedText } from '../game/types'
import { lockedStatus } from './i18n'
import { useT } from './useT'
import { LangToggle } from './LangToggle'

const LEVELS: { level: Level; name: LocalizedText; topic: LocalizedText }[] = [
  { level: 1, name: { en: 'Exploration', ko: '탐색' }, topic: { en: 'ls · cd · cat · head · tail', ko: 'ls · cd · cat · head · tail' } },
  { level: 2, name: { en: 'Manipulation', ko: '조작' }, topic: { en: 'cp · mv · mkdir · redirection', ko: 'cp · mv · mkdir · 리다이렉션' } },
  { level: 3, name: { en: 'Text Processing', ko: '텍스트 처리' }, topic: { en: 'grep · sed · awk · pipes', ko: 'grep · sed · awk · 파이프' } },
  { level: 4, name: { en: 'System', ko: '시스템' }, topic: { en: 'find · xargs · chmod', ko: 'find · xargs · chmod' } },
  { level: 5, name: { en: 'Scripting', ko: '스크립팅' }, topic: { en: 'if · for · while · functions', ko: 'if · for · while · 함수' } },
  { level: 6, name: { en: 'Automation', ko: '자동화' }, topic: { en: 'arrays · read · scripts', ko: '배열 · read · 스크립트' } },
]

export function LevelSelect() {
  const progress = useGame((s) => s.progress)
  const openLevel = useGame((s) => s.openLevel)
  const lang = useGame((s) => s.lang)
  const t = useT()

  return (
    <div className="levels">
      <LangToggle className="lang-toggle-levels" />
      <h1 className="levels-title">FLASHSHELL</h1>
      <p className="levels-sub">{t('levelsSub')}</p>

      <ul className="levels-list">
        {LEVELS.map(({ level, name, topic }) => {
          const total = allProblems.filter((p) => p.level === level).length
          const unlocked = total > 0 && isLevelUnlocked(level, progress, allProblems)
          const solved = solvedInLevel(progress, level, allProblems)

          return (
            <li key={level}>
              <button
                className={`level ${unlocked ? '' : 'level-locked'}`}
                disabled={!unlocked}
                onClick={() => openLevel(level)}
              >
                <span className="level-num">LEVEL {level}</span>
                <span className="level-name">{name[lang]}</span>
                <span className="level-topic">{topic[lang]}</span>
                <span className="level-status">
                  {total === 0
                    ? 'COMING SOON'
                    : unlocked
                      ? `${solved}/${total}`
                      : lockedStatus(lang, UNLOCK_THRESHOLD)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: HudCard 크롬 전환** — `src/ui/HudCard.tsx`:

import 추가: `import { useT } from './useT'` / `import { LangToggle } from './LangToggle'`
컴포넌트 상단 셀렉터들 옆에: `const t = useT()`

aria-label 세 곳 교체:

```tsx
          aria-label={t('prevProblem')}
```

```tsx
          aria-label={t('nextProblem')}
```

```tsx
          aria-label={collapsed ? t('expandCard') : t('collapseCard')}
```

`← LEVELS` 버튼 바로 앞(hud-meta 행 안)에 토글 삽입:

```tsx
        <LangToggle />
        <button className="hud-exit" onClick={backToLevels}>← LEVELS</button>
```

(스펙 §2의 "우상단 고정"의 실구현: 플레이 화면에서는 HUD 메타 행이 화면 최상단 행이므로 그 행의 오른쪽 끝 그룹에 넣는다 — HUD와 겹치는 별도 오버레이를 만들지 않는다. 375px에서는 `flex-wrap: wrap`이 이미 안전하게 줄바꿈하고, `--hud-height` 실측정이 높이 변화를 흡수한다.)

- [ ] **Step 6: RevealSheet 크롬 전환** — `src/ui/RevealSheet.tsx`:

```tsx
import { useGame } from './store'
import { useT } from './useT'

export function RevealSheet() {
  const problem = useGame((s) => s.problem)
  const status = useGame((s) => s.status)
  const nextProblem = useGame((s) => s.nextProblem)
  const t = useT()

  if (!problem || status !== 'solved') return null

  return (
    <div className="sheet" role="dialog" aria-label={t('explanationDialog')}>
      <div className="sheet-header">[ SOLVED ]</div>

      <div className="sheet-label">{t('sheetSolution')}</div>
      <pre className="sheet-code">{problem.solution}</pre>

      <div className="sheet-label">{t('sheetExplanation')}</div>
      <p className="sheet-body">{problem.explanation}</p>

      <button className="sheet-next" onClick={nextProblem} autoFocus>NEXT ▸</button>
    </div>
  )
}
```

(`problem.explanation`은 Task 3에서 `[lang]` 인덱싱으로 바뀐다 — 이 태스크에서는 아직 string이다.)

- [ ] **Step 7: theme.css** — `.hud-nav` 규칙 블록 근처에 추가:

```css
.lang-toggle { display: inline-flex; gap: 0.25rem; }
.lang-toggle button { background: none; border: 1px solid var(--phos-border); color: var(--phos-dim); font: inherit; font-size: 0.65rem; letter-spacing: 0.18em; padding: 0.15rem 0.5rem; cursor: pointer; }
.lang-toggle button[aria-pressed='true'] { color: var(--phos-green); border-color: var(--phos-green); text-shadow: var(--glow-green); }
.lang-toggle-levels { position: absolute; top: 1.2rem; right: 1.5rem; }
```

기존 focus-visible 선택자 묶음(`theme.css:180` 부근 `.hud-fold:focus-visible, ...`)에 `.lang-toggle button:focus-visible`를 추가한다.

- [ ] **Step 8: Playwright 전역 ko 로케일** — `playwright.config.ts`:

```ts
  use: { baseURL: 'http://localhost:5173', locale: 'ko-KR' },
```

(기존 e2e 5개 스펙은 전부 한국어 텍스트를 쿼리한다. Playwright 기본 locale은 en-US라 감지가 EN이 되어 깨진다 — jsdom의 navigator 오버라이드와 같은 이유로 전역을 ko-KR로 고정하고, EN 경로는 Task 7의 i18n.spec이 `test.use({ locale: 'en-US' })`로 명시 검증한다.)

- [ ] **Step 9: 확인**

Run: `npx vitest run src/ui/LangToggle.test.tsx`
Expected: PASS

Run: `npm run build && npm test`
Expected: PASS — 기존 컴포넌트 테스트(한국어 쿼리) 무변경 통과

Run: `npm run e2e`
Expected: 기존 11개 전부 PASS (ko-KR 로케일 고정 덕)

Run: `git diff --stat main -- src/shell tests/shell/golden/`
Expected: 출력 없음

- [ ] **Step 10: 커밋**

```bash
git add src/ui/LangToggle.tsx src/ui/LangToggle.test.tsx src/ui/LevelSelect.tsx src/ui/HudCard.tsx src/ui/RevealSheet.tsx src/ui/theme.css playwright.config.ts
git commit -m "feat(i18n): [EN|KO] toggle + UI chrome localization"
```

---

### Task 3: Problem 텍스트 필드 → LocalizedText (기계적 병기)

**Files:**
- Modify: `src/game/types.ts` (`Problem` 인터페이스), `src/game/problems/l1.ts`~`l6.ts` (기계적 변환), `src/ui/HudCard.tsx`, `src/ui/RevealSheet.tsx` (렌더 `[lang]`)
- Test: `src/game/problems/integrity.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `LocalizedText`, 스토어 `lang`
- Produces: `Problem { title: LocalizedText; prompt: LocalizedText; hints: LocalizedText[]; explanation: LocalizedText }` — Task 4~6은 이 구조에서 `en:` 값만 교체한다

**이 태스크의 en 값은 ko의 임시 복사본이다.** 진짜 번역은 Task 4~6. 이 태스크의 목적은 타입 전환을 컴파일 초록 상태로 한 번에 통과시키는 것 — diff가 크지만 전부 기계적이라 리뷰 부담이 낮다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/game/problems/integrity.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/game/problems/integrity.test.ts`
Expected: FAIL — `p.title`이 string이라 `tx.en`이 undefined (타입 에러로 컴파일 단계에서 실패해도 같은 의미)

- [ ] **Step 3: Problem 타입 전환** — `src/game/types.ts`:

```ts
export interface Problem {
  id: string // 'l1-01'
  level: Level
  title: LocalizedText // HUD 카드 제목
  prompt: LocalizedText // 지문
  setup(fs: VFS): void
  hints: LocalizedText[]
  check(ctx: CheckContext): boolean
  solution: string
  wrongAnswer: string // 그럴듯하지만 틀린 답. 음성 테스트용.
  explanation: LocalizedText
}
```

- [ ] **Step 4: l1~l6 기계적 병기** — 6개 파일 각각, 문제마다 4종 필드를 다음 규칙으로 변환한다. **문자열 리터럴은 글자 하나 바꾸지 말고 그대로 복사한다** (en에도 동일 리터럴):

변환 전 (l1-01 예):

```ts
    title: '첫 접속',
    prompt: '홈 디렉터리에 readme.txt 가 있습니다. 그 내용을 화면에 출력하세요.',
    hints: ['어떤 파일이 있는지 먼저 보고 싶다면 ls 입니다.', '파일 내용을 그대로 뱉는 명령은 cat 입니다.'],
    explanation:
      'cat 은 concatenate 의 준말입니다. 파일 여러 개를 이어붙여 표준출력으로 내보내는 것이 본래 목적이고, 하나만 주면 그냥 내용을 보여줍니다.',
```

변환 후:

```ts
    title: { en: '첫 접속', ko: '첫 접속' },
    prompt: {
      en: '홈 디렉터리에 readme.txt 가 있습니다. 그 내용을 화면에 출력하세요.',
      ko: '홈 디렉터리에 readme.txt 가 있습니다. 그 내용을 화면에 출력하세요.',
    },
    hints: [
      { en: '어떤 파일이 있는지 먼저 보고 싶다면 ls 입니다.', ko: '어떤 파일이 있는지 먼저 보고 싶다면 ls 입니다.' },
      { en: '파일 내용을 그대로 뱉는 명령은 cat 입니다.', ko: '파일 내용을 그대로 뱉는 명령은 cat 입니다.' },
    ],
    explanation: {
      en: 'cat 은 concatenate 의 준말입니다. 파일 여러 개를 이어붙여 표준출력으로 내보내는 것이 본래 목적이고, 하나만 주면 그냥 내용을 보여줍니다.',
      ko: 'cat 은 concatenate 의 준말입니다. 파일 여러 개를 이어붙여 표준출력으로 내보내는 것이 본래 목적이고, 하나만 주면 그냥 내용을 보여줍니다.',
    },
```

`setup`/`check`/`solution`/`wrongAnswer`/`id`/`level`은 한 글자도 건드리지 않는다. 파일마다 변환 후 `npm run build`(tsc)로 누락을 잡는다.

- [ ] **Step 5: 렌더 경로 `[lang]` 인덱싱**

`src/ui/HudCard.tsx` — 셀렉터에 `const lang = useGame((s) => s.lang)` 추가 후:

```tsx
          <h2 className="hud-title">{problem.title[lang]}</h2>
          <p className="hud-prompt">{problem.prompt[lang]}</p>

          {problem.hints.slice(0, hintsShown).map((hint, i) => (
            <p key={i} className="hud-hint">▸ {hint[lang]}</p>
          ))}
```

`src/ui/RevealSheet.tsx` — `const lang = useGame((s) => s.lang)` 추가 후:

```tsx
      <p className="sheet-body">{problem.explanation[lang]}</p>
```

- [ ] **Step 6: 전체 확인**

Run: `npm run build && npm test`
Expected: PASS — integrity 테스트 포함 전부 초록. 기존 테스트는 ko 렌더 결과가 동일하므로 무변경 통과.

Run: `npm run e2e`
Expected: 11개 전부 PASS (ko 로케일 → 렌더 결과 현행 동일)

Run: `git diff --stat main -- src/shell tests/shell/golden/`
Expected: 출력 없음

- [ ] **Step 7: 커밋**

```bash
git add src/game/types.ts src/game/problems/ src/ui/HudCard.tsx src/ui/RevealSheet.tsx
git commit -m "feat(i18n): Problem text fields to LocalizedText (en = ko copy, translations follow)"
```

---

### Task 4: L1+L2 EN 번역 (20문제)

**Files:**
- Modify: `src/game/problems/l1.ts`, `src/game/problems/l2.ts` — **`en:` 값만** 교체

**Interfaces:**
- Consumes: Task 3의 병기 구조
- Produces: **`l1-01`의 `title.en`은 정확히 `First Contact`** (Task 7의 e2e가 이 문자열을 쿼리한다 — verbatim 필수). 그 외 번역문은 구현자 재량.

**번역 규칙 (Task 5·6 공통 — 리뷰 기준):**
1. `ko:` 값·따옴표·줄바꿈 등 기존 줄은 바이트 단위 무변경 — diff에 `ko:` 줄이 나타나면 리젝트.
2. `setup`/`check`/`solution`/`wrongAnswer` 무접촉.
3. 파일명·디렉터리명·명령·플래그·기대 출력 리터럴(`readme.txt`, `.keycard`, `ACCESS GRANTED`, `ls -a` …)은 en에서도 동일 문자열.
4. 톤: 간결한 사이버펑크 미션 브리핑체. 해설은 원문의 교육 내용(어원, 동작 원리, 함정)을 빠짐없이 옮긴다 — 요약·생략 금지.
5. en에 한글이 남으면 안 된다 (Task 6의 무한글 무결성 테스트가 최종 강제).

l1-01 확정 번역 (worked example — verbatim 사용):

```ts
    title: { en: 'First Contact', ko: '첫 접속' },
    prompt: {
      en: 'There is a readme.txt in your home directory. Print its contents to the screen.',
      ko: '홈 디렉터리에 readme.txt 가 있습니다. 그 내용을 화면에 출력하세요.',
    },
    hints: [
      { en: 'Want to see which files are here first? That is ls.', ko: '어떤 파일이 있는지 먼저 보고 싶다면 ls 입니다.' },
      { en: 'The command that dumps a file exactly as it is: cat.', ko: '파일 내용을 그대로 뱉는 명령은 cat 입니다.' },
    ],
    explanation: {
      en: 'cat is short for concatenate. Its original job is to join multiple files and send them to standard output — given just one, it simply shows its contents.',
      ko: 'cat 은 concatenate 의 준말입니다. 파일 여러 개를 이어붙여 표준출력으로 내보내는 것이 본래 목적이고, 하나만 주면 그냥 내용을 보여줍니다.',
    },
```

- [ ] **Step 1: l1.ts 10문제 en 교체** (l1-01은 위 verbatim)
- [ ] **Step 2: l2.ts 10문제 en 교체**
- [ ] **Step 3: 확인**

Run: `npm run build && npx vitest run src/game/problems/integrity.test.ts src/ui/`
Expected: PASS

Run: `git diff --stat main -- src/shell tests/shell/golden/`
Expected: 출력 없음

Run: `git diff main -- src/game/problems/l1.ts src/game/problems/l2.ts | grep '^[-+]' | grep -c "ko:"`
Expected: `0` (ko 줄 무변경 — grep이 0 매치로 exit code 1을 내는 것이 정상)

- [ ] **Step 4: 커밋**

```bash
git add src/game/problems/l1.ts src/game/problems/l2.ts
git commit -m "feat(i18n): L1+L2 English translations"
```

---

### Task 5: L3+L4 EN 번역 (20문제)

**Files:**
- Modify: `src/game/problems/l3.ts`, `src/game/problems/l4.ts` — **`en:` 값만** 교체

**Interfaces:**
- Consumes: Task 3의 병기 구조. Task 4의 번역 규칙 1~5 전부 동일 적용.
- Produces: l3·l4 en 번역 완료 상태.

L3은 grep/sed/awk/파이프, L4는 find/xargs/chmod/권한 지문 — 정규식 패턴, 옵션 플래그, 경로 리터럴이 많다. **코드로 보이는 모든 토큰은 그대로 두고 산문만 옮긴다.** 예: `'로그에서 ERROR 를 포함한 줄만 추려…'` → `'Pull only the lines containing ERROR from the log…'` (`ERROR`는 대소문자 그대로).

- [ ] **Step 1: l3.ts 10문제 en 교체**
- [ ] **Step 2: l4.ts 10문제 en 교체**
- [ ] **Step 3: 확인**

Run: `npm run build && npx vitest run src/game/problems/integrity.test.ts src/ui/`
Expected: PASS

Run: `git diff main -- src/game/problems/l3.ts src/game/problems/l4.ts | grep '^[-+]' | grep -c "ko:"`
Expected: `0` (exit 1 정상)

- [ ] **Step 4: 커밋**

```bash
git add src/game/problems/l3.ts src/game/problems/l4.ts
git commit -m "feat(i18n): L3+L4 English translations"
```

---

### Task 6: L5+L6 EN 번역 (20문제) + 번역 완료 무결성 강제

**Files:**
- Modify: `src/game/problems/l5.ts`, `src/game/problems/l6.ts` — **`en:` 값만** 교체
- Modify: `src/game/problems/integrity.test.ts` — 무한글 테스트 추가

**Interfaces:**
- Consumes: Task 3의 병기 구조. Task 4의 번역 규칙 1~5 동일 적용.
- Produces: 60문제 번역 완료 + `en` 필드 무한글 불변식 (이후 새 문제 추가 시에도 CI가 강제).

L5·L6은 스크립트 지문(here-doc, 배열, while read)이 많다 — 지문 속 스크립트 조각·변수명·파일명은 그대로.

- [ ] **Step 1: l5.ts 10문제 en 교체**
- [ ] **Step 2: l6.ts 10문제 en 교체**
- [ ] **Step 3: 무한글 테스트 추가** — `integrity.test.ts`의 describe 안에:

```ts
  it('en 필드에 한글이 없다 — 60문제 번역 완료의 기계적 증명', () => {
    for (const p of allProblems) {
      for (const [name, tx] of textFields(p)) {
        expect(/[가-힣]/.test(tx.en), `${p.id} ${name}.en 에 한글 잔존: ${tx.en}`).toBe(false)
      }
    }
  })
```

- [ ] **Step 4: 확인**

Run: `npm run build && npm test`
Expected: PASS — 무한글 테스트가 l1~l6 전체(앞 태스크 포함)의 번역 완료를 증명

Run: `npm run e2e`
Expected: 11개 전부 PASS

Run: `git diff main -- src/game/problems/l5.ts src/game/problems/l6.ts | grep '^[-+]' | grep -c "ko:"`
Expected: `0` (exit 1 정상)

Run: `git diff --stat main -- src/shell tests/shell/golden/`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/game/problems/l5.ts src/game/problems/l6.ts src/game/problems/integrity.test.ts
git commit -m "feat(i18n): L5+L6 English translations + no-Hangul-in-en integrity gate"
```

---

### Task 7: README EN/KO + i18n e2e + 전체 게이트

**Files:**
- Modify: `README.md` (EN 전환)
- Create: `README.ko.md` (현행 KO 이동)
- Create: `e2e/i18n.spec.ts`

**Interfaces:**
- Consumes: Task 2의 토글(`KO`/`EN` 버튼, `Exploration`), Task 4의 `First Contact`(verbatim), Task 1~2의 STRINGS EN 값들.
- Produces: 최종 게이트 초록 상태 (머지 준비 완료).

- [ ] **Step 1: README.ko.md 생성** — 현행 `README.md` 내용 그대로 옮기되, 제목 줄 아래에 언어 링크 추가:

```markdown
# FlashShell

[English](README.md)

명령줄로만 풀 수 있는 문제들 — 브라우저에서 도는 셸 학습 게임.
(…이하 현행 README.md 본문 그대로…)
```

- [ ] **Step 2: README.md EN 전환** — 전체를 다음으로 교체:

```markdown
# FlashShell

[한국어](README.ko.md)

Problems only the command line can solve — a shell-learning game that runs in your browser.

**▶ Play: <https://flashshell.anonpengling.org/>**

Learn the Linux shell like a flashcard game. 60 problems from Level 1 (exploration) to Level 6 (automation — arrays, read, scripts), solved by typing real commands. Problems are graded on the **final state of the filesystem**, not on the command string you typed.

## Features

- **bash-accurate engine** — a hand-rolled bash-subset interpreter (lexer → parser → expander → interpreter) running on a virtual filesystem. Every behavior is differentially verified against bash 5 on `debian:stable-slim`; golden fixtures are regenerated with real bash and compared byte-for-byte (enforced in CI on every push).
- **Fully client-side** — no server. The shell runs in a Web Worker with a 2-second deadline that isolates runaways (infinite loops, ReDoS).
- **Supported syntax** — pipes · redirection · globs, `if`/`for`/`while`/`case` · functions, `$(( ))` arithmetic · `${...}` parameter expansion, arrays · `read` · `while read` · here-docs, 30+ coreutils.
- **English / Korean** — auto-detected from your browser, switchable in-game with the `[EN|KO]` toggle.

## Development

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (engine · game · UI)
npm run e2e        # Playwright (needs Chromium: npx playwright install chromium)
npm run golden     # regenerate golden fixtures — requires Docker (bash 5 differential)
npm run build      # static build (dist/)
```

Stack: Vite · React · TypeScript · Zustand · Vitest · Playwright.
```

- [ ] **Step 3: e2e 작성** — `e2e/i18n.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// playwright.config.ts 가 전역 locale 을 ko-KR 로 고정한다(기존 스펙들의 한국어
// 쿼리 유지). EN 감지 경로는 이 파일에서 locale 을 명시적으로 되돌려 검증한다.

test.describe('EN 감지 (비 ko 로케일)', () => {
  test.use({ locale: 'en-US' })

  test('첫 방문이 EN 이고, KO 전환이 새로고침을 넘어 유지된다', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    await expect(page.getByText('Problems only the command line can solve. Pick a level.')).toBeVisible()
    await expect(page.getByText('Exploration')).toBeVisible()

    await page.getByRole('button', { name: 'KO' }).click()
    await expect(page.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeVisible()

    await page.reload()
    await expect(page.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeVisible()
  })

  test('EN 으로 문제 진입·해결·해설까지 영어로 동작한다', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    await page.getByRole('button', { name: /LEVEL 1/ }).click()
    await expect(page.getByText('First Contact')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Previous problem' })).toBeVisible()

    await page.getByRole('textbox').fill('cat readme.txt')
    await page.getByRole('textbox').press('Enter')

    const sheet = page.getByRole('dialog', { name: 'Explanation' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('SOLUTION')).toBeVisible()
    await expect(sheet.getByText('cat readme.txt')).toBeVisible()
  })
})

test('ko 로케일(전역 기본)은 첫 방문이 KO 다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeVisible()
})
```

- [ ] **Step 4: e2e 실행**

Run: `npm run e2e`
Expected: 기존 11 + 신규 3 = 14개 전부 PASS

- [ ] **Step 5: 전체 게이트**

Run: `npm run build && npm test && npm run e2e`
Expected: 전부 PASS

Run: `npm run golden && git diff --exit-code tests/shell/golden/`
Expected: 바이트 동일 (Docker 필요)

Run: `git diff --stat main -- src/shell tests/shell/golden/`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add README.md README.ko.md e2e/i18n.spec.ts
git commit -m "docs+test(i18n): English README + README.ko.md, i18n e2e (detect/toggle/persist)"
```

---

## 셀프 리뷰 노트 (계획 검증)

- 스펙 §1~§7 전부 태스크 매핑: §1→T1·T3, §2→T1·T2, §3→T1·T2, §4→T3·T4·T5·T6, §5→전 태스크 게이트, §6→T7(+T1의 applyDocumentLang), §7→T1(단위)·T3/T6(무결성)·T2(컴포넌트)·T7(e2e)·전 태스크(게이트 불변).
- 기존 테스트 호환의 두 축: jsdom은 test-setup의 `navigator.language='ko-KR'` 오버라이드(T1), Playwright는 전역 `locale:'ko-KR'`(T2) — 이 두 줄이 기존 한국어-쿼리 테스트 전체를 무변경 통과시킨다. `vi.resetModules()`로 스토어를 재생성하는 Play.test의 레벨 해제 테스트도 navigator 오버라이드로 안정.
- e2e 앵커 verbatim 핀: `First Contact`(T4↔T7), `Exploration`(T2↔T7), STRINGS EN 값들(T1↔T2 테스트↔T7).
