# FlashShell M0 + M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저에서 도는 bash 서브셋 인터프리터와 가상 파일시스템 위에, Phosphor CRT 터미널로 L1·L2 문제 20개를 실제로 풀 수 있는 플레이 가능한 게임을 만든다.

**Architecture:** 셸 엔진(`src/shell/`)은 순수 TypeScript이며 React도 브라우저도 모른다. 렉서 → 파서 → 확장기 → 인터프리터의 4단 파이프라인이 AST를 실행하고, 모든 명령은 `CommandFn`이라는 하나의 함수 시그니처를 공유한다. 게임 레이어(`src/game/`)는 매 명령 실행 후 VFS 객체를 직접 읽어 정답을 판정한다. UI(`src/ui/`)는 이 둘을 소비할 뿐이다.

**Tech Stack:** Vite, React, TypeScript, Zustand, Vitest, Playwright. 터미널은 xterm.js가 아니라 직접 만든 DOM 컴포넌트.

## Global Constraints

- 셸 엔진(`src/shell/**`)은 `react`, `zustand`, `window`, `document`, `localStorage`를 import하거나 참조하지 않는다. Node 환경에서 단독으로 테스트 가능해야 한다.
- 모든 코드는 TypeScript strict 모드를 통과한다 (`"strict": true`).
- 커밋 메시지는 Conventional Commits 형식을 쓴다 (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- 정오답·난이도를 **밝기만으로** 표현하지 않는다. 항상 색(녹색/앰버) 또는 텍스트가 동반된다.
- 모든 애니메이션은 `prefers-reduced-motion: reduce`에서 비활성화된다.
- 색은 두 가지만 쓴다: 인광 녹색 `--phos-green: #4ee06a`, 앰버 `--phos-amber: #ffb03a`. 배경은 `--phos-bg: #0b0e08`.
- 구현하지 않은 명령은 `command not found`가 아니라 `flashshell: <cmd>: 이 환경에는 없는 명령입니다`를 반환한다.

## 이 계획의 범위

**포함:** M0(스캐폴드 + CRT 껍데기), M1(1층 엔진 + 코어유틸 16개 + L1·L2 문제 20개 + UI 배선).

**제외:** M2(2층 엔진, L3~L5), M3(3층 엔진). 각각 별도 계획을 받는다. M1 완료 후 사용자 테스트를 거친다.

**스펙과의 의도적 차이:** 스펙 §10은 M1에 "코어유틸 30개"라고 적었다. 실제로 L1·L2 문제 20개가 요구하는 명령은 16개다. `sed`, `awk`, `cut`, `tr`, `uniq`, `find`, `xargs`, `diff`는 L3·L4 전용이므로 M2에서 해당 문제와 함께 만든다. 쓰지 않는 코드를 미리 만들지 않는다.

## File Structure

```
package.json                     의존성, 스크립트
vite.config.ts                   Vite 설정
vitest.config.ts                 Vitest 설정 (node 환경)
tsconfig.json                    strict
playwright.config.ts             스모크 테스트 설정
index.html                       진입점

src/shell/
  types.ts        ExecResult, Shell, CommandFn, CommandEnv, CommandOutput
  errors.ts       VfsError, ExecutionLimitError, errnoText
  vfs.ts          VFS 클래스 — inode 트리, 경로 해석, 권한
  lexer.ts        문자열 → Token[]
  parser.ts       Token[] → ListNode (AST)
  glob.ts         글롭 패턴 매칭
  expand.ts       Word → string[] (변수, 명령치환, 틸드, 글롭, 분할)
  interpreter.ts  AST 실행 — 파이프, 리다이렉션, &&/||, 스텝 예산
  registry.ts     명령 등록표 + 미구현 명령 판별
  index.ts        createShell()
  builtins/
    index.ts      builtins 등록표
    cd.ts pwd.ts echo.ts export.ts unset.ts truefalse.ts type.ts
  coreutils/
    index.ts      coreutils 등록표
    shared.ts     readSources, parseFlags, toLines, normalizeCountFlag
    ls.ts cat.ts head.ts tail.ts wc.ts stat.ts       (조회)
    cp.ts mv.ts rm.ts mkdir.ts rmdir.ts touch.ts ln.ts chmod.ts  (조작)
    grep.ts sort.ts                                   (텍스트)

src/game/
  types.ts          Problem, CheckContext
  harness.ts        createShellForProblem()
  progress.ts       localStorage 진행도 + 레벨 해제 규칙
  check-helpers.ts  safeRead, safeReaddir, trimEq — 검증기가 절대 던지지 않게
  problems/
    index.ts      allProblems
    l1.ts         L1 문제 10개
    l2.ts         L2 문제 10개

src/ui/
  store.ts        Zustand 게임 상태
  App.tsx         라우팅 (레벨선택 ↔ 플레이)
  Play.tsx        터미널 + HUD + 시트 합성
  Crt.tsx         곡률·비네팅·주사선 래퍼
  Terminal.tsx    DOM 터미널 (히스토리, Tab 완성, Ctrl+C/L)
  HudCard.tsx     문제 카드 + 힌트 + 접기
  RevealSheet.tsx 해설 바텀시트
  LevelSelect.tsx 레벨 선택
  useSignal.ts    120ms 뒤 wrong 신호 해제
  theme.css       CSS 변수, Dual Phosphor, 글리치

tests/
  shell/golden/seed.sh            골든 테스트용 초기 파일시스템 (평문 명령만)
  tests/shell/golden/cases/*.sh   케이스 (진짜 bash로 기대출력 생성)
  tests/shell/golden/*.expected   생성된 기대 출력 (커밋됨)
  golden.test.ts                  대조 테스트
  problems.test.ts                solution 통과 / wrongAnswer 불통과
scripts/
  gen-golden.sh                   진짜 bash로 .expected 재생성
e2e/
  smoke.spec.ts                   Playwright 스모크
```

---

## Task 1: 프로젝트 스캐폴드와 툴링

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`
- Test: `src/shell/smoke.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `npm test`가 Vitest를 node 환경에서 실행한다. `npm run dev`가 Vite 개발 서버를 띄운다.

- [ ] **Step 1: 의존성 설치**

```bash
npm init -y
npm i react react-dom zustand
npm i -D typescript vite @vitejs/plugin-react vitest @types/react @types/react-dom @playwright/test jsdom
```

- [ ] **Step 2: `tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests", "e2e"]
}
```

`noUncheckedIndexedAccess`는 파서와 렉서에서 배열 인덱싱 실수를 컴파일 타임에 잡아준다. 이 프로젝트에서 값어치를 한다.

- [ ] **Step 3: `vite.config.ts`와 `vitest.config.ts` 작성**

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
```

셸 테스트는 `node` 환경에서 돈다. 이것이 "엔진은 브라우저를 모른다"는 제약을 강제하는 장치다. 엔진 코드가 실수로 `document`를 건드리면 테스트가 즉시 깨진다.

- [ ] **Step 4: `package.json` 스크립트 추가**

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "golden": "bash scripts/gen-golden.sh"
  }
}
```

- [ ] **Step 5: 실패하는 스모크 테스트 작성**

```ts
// src/shell/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs vitest in node environment', () => {
    expect(typeof globalThis.document).toBe('undefined')
  })
})
```

- [ ] **Step 6: 테스트 실행**

Run: `npm test`
Expected: PASS — 1 test. `document`가 undefined임이 확인되면 node 환경 설정이 맞다.

- [ ] **Step 7: 최소 진입점 작성**

```html
<!-- index.html -->
<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /><title>FlashShell</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'

createRoot(document.getElementById('root')!).render(<App />)
```

```tsx
// src/ui/App.tsx
export function App() {
  return <div>FlashShell</div>
}
```

- [ ] **Step 8: 빌드가 통과하는지 확인**

Run: `npm run build`
Expected: 타입 에러 0개, `dist/`가 생성된다.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "chore: scaffold vite + react + typescript + vitest"
```

---

## Task 2: CRT 껍데기와 에코 터미널 (M0 완료)

엔진을 만들기 전에 비주얼을 못박는다. 이 태스크가 끝나면 화면에 인광 CRT 터미널이 뜨고, 입력한 글자를 그대로 되뱉는다. 실제 셸은 아직 없다.

**Files:**
- Create: `src/ui/theme.css`, `src/ui/Crt.tsx`, `src/ui/Terminal.tsx`
- Modify: `src/ui/App.tsx`
- Test: `src/ui/Terminal.test.tsx` (jsdom 환경)

**Interfaces:**
- Consumes: Task 1의 스캐폴드
- Produces:
  - `Crt: React.FC<{children: React.ReactNode}>` — 곡률·비네팅·주사선 래퍼
  - `Terminal: React.FC<TerminalProps>` 여기서
    ```ts
    export interface TermLine { text: string; tone: 'green' | 'amber' | 'dim' }
    export interface TerminalProps {
      lines: TermLine[]
      prompt: string
      onSubmit(line: string): void
      completions?(partial: string): string[]   // Tab 자동완성 후보
      disabled?: boolean
    }
    ```

- [ ] **Step 1: `vitest.config.ts`에 jsdom 프로젝트 추가**

셸은 node에서, UI는 jsdom에서 돌려야 한다.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: 'shell', environment: 'node', include: ['src/shell/**/*.test.ts', 'tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'ui', environment: 'jsdom', include: ['src/ui/**/*.test.tsx'], setupFiles: ['./src/ui/test-setup.ts'] },
      },
    ],
  },
})
```

```bash
npm i -D @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

```ts
// src/ui/test-setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 2: 실패하는 터미널 테스트 작성**

```tsx
// src/ui/Terminal.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Terminal } from './Terminal'

describe('Terminal', () => {
  it('엔터를 치면 입력한 줄로 onSubmit을 부른다', async () => {
    const onSubmit = vi.fn()
    render(<Terminal lines={[]} prompt="$ " onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('textbox'), 'ls -a{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('ls -a')
  })

  it('위 화살표로 직전 명령을 되살린다', async () => {
    const onSubmit = vi.fn()
    render(<Terminal lines={[]} prompt="$ " onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'echo hi{Enter}')
    await userEvent.type(input, '{ArrowUp}')
    expect(input).toHaveValue('echo hi')
  })

  it('Tab을 누르면 유일한 후보로 완성한다', async () => {
    render(<Terminal lines={[]} prompt="$ " onSubmit={vi.fn()} completions={() => ['readme.md']} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'cat rea{Tab}')
    expect(input).toHaveValue('cat readme.md')
  })

  it('출력 줄을 tone에 따라 다른 클래스로 그린다', () => {
    render(<Terminal lines={[{ text: 'oops', tone: 'amber' }]} prompt="$ " onSubmit={vi.fn()} />)
    expect(screen.getByText('oops')).toHaveClass('tone-amber')
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npx vitest run --project ui`
Expected: FAIL — "Failed to resolve import ./Terminal"

- [ ] **Step 4: 테마 CSS 작성**

```css
/* src/ui/theme.css */
:root {
  --phos-bg: #0b0e08;
  --phos-green: #4ee06a;
  --phos-amber: #ffb03a;
  --phos-dim: #2e7a3f;
  --glow-green: 0 0 6px rgba(78, 224, 106, 0.55);
  --glow-amber: 0 0 7px rgba(255, 176, 58, 0.6);
}

.crt {
  position: relative;
  min-height: 100vh;
  background: var(--phos-bg);
  font-family: "Courier New", ui-monospace, monospace;
  overflow: hidden;
}

/* 주사선 + 비네팅. pointer-events:none 이라 클릭을 가로채지 않는다. */
.crt::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at center, transparent 58%, rgba(0, 0, 0, 0.55) 100%),
    repeating-linear-gradient(180deg, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 2px);
}

.terminal {
  padding: 1rem;
  color: var(--phos-green);
  line-height: 1.6;
  height: 100vh;
  overflow-y: auto;
}

.tone-green { color: var(--phos-green); text-shadow: var(--glow-green); }
.tone-amber { color: var(--phos-amber); text-shadow: var(--glow-amber); }
.tone-dim   { color: var(--phos-dim); }

.term-line { white-space: pre-wrap; word-break: break-all; }

.term-inputline { display: flex; }
.term-prompt { color: var(--phos-dim); white-space: pre; }

/* caret-color가 인광색이어야 커서도 빛난다. */
.term-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--phos-green);
  caret-color: var(--phos-green);
  text-shadow: var(--glow-green);
  font: inherit;
  padding: 0;
}

@media (prefers-reduced-motion: reduce) {
  .crt::after { background: radial-gradient(ellipse at center, transparent 58%, rgba(0, 0, 0, 0.55) 100%); }
}
```

- [ ] **Step 5: `Crt.tsx` 작성**

```tsx
// src/ui/Crt.tsx
import type { ReactNode } from 'react'
import './theme.css'

export function Crt({ children }: { children: ReactNode }) {
  return <div className="crt">{children}</div>
}
```

- [ ] **Step 6: `Terminal.tsx` 작성**

공용 접두사까지만 완성하는 것이 진짜 bash의 Tab 동작이다. 후보가 하나면 전부 완성되고, 여럿이면 공통 부분까지만 채운 뒤 후보를 출력한다.

```tsx
// src/ui/Terminal.tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface TermLine { text: string; tone: 'green' | 'amber' | 'dim' }

export interface TerminalProps {
  lines: TermLine[]
  prompt: string
  onSubmit(line: string): void
  completions?(partial: string): string[]
  disabled?: boolean
}

function commonPrefix(items: string[]): string {
  if (items.length === 0) return ''
  let prefix = items[0]!
  for (const item of items.slice(1)) {
    while (!item.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return prefix
}

export function Terminal({ lines, prompt, onSubmit, completions, disabled }: TerminalProps) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState(-1) // -1 = 히스토리 바깥, 편집 중
  const [extra, setExtra] = useState<TermLine[]>([]) // Tab이 뿌린 후보 목록
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView() }, [lines, extra])

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const line = value
      setHistory((h) => (line.trim() ? [...h, line] : h))
      setCursor(-1)
      setValue('')
      setExtra([])
      onSubmit(line)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const next = cursor === -1 ? history.length - 1 : Math.max(0, cursor - 1)
      setCursor(next)
      setValue(history[next]!)
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (cursor === -1) return
      const next = cursor + 1
      if (next >= history.length) { setCursor(-1); setValue('') }
      else { setCursor(next); setValue(history[next]!) }
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (!completions) return
      const lastSpace = value.lastIndexOf(' ')
      const head = value.slice(0, lastSpace + 1)
      const partial = value.slice(lastSpace + 1)
      const candidates = completions(partial)
      if (candidates.length === 0) return
      const filled = commonPrefix(candidates)
      setValue(head + filled)
      setExtra(candidates.length > 1 ? [{ text: candidates.join('  '), tone: 'dim' }] : [])
      return
    }

    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault()
      setValue('')
      setCursor(-1)
      setExtra([])
      return
    }

    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      onSubmit('clear')
      return
    }
  }

  return (
    <div className="terminal" onClick={() => inputRef.current?.focus()}>
      {lines.map((l, i) => (
        <div key={i} className={`term-line tone-${l.tone}`}>{l.text}</div>
      ))}
      {extra.map((l, i) => (
        <div key={`x${i}`} className={`term-line tone-${l.tone}`}>{l.text}</div>
      ))}
      <div className="term-inputline">
        <span className="term-prompt">{prompt}</span>
        <input
          ref={inputRef}
          className="term-input"
          role="textbox"
          value={value}
          disabled={disabled}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
        />
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 7: 테스트 실행해 통과 확인**

Run: `npx vitest run --project ui`
Expected: PASS — 4 tests.

- [ ] **Step 8: `App.tsx`를 에코 터미널로 연결**

```tsx
// src/ui/App.tsx
import { useState } from 'react'
import { Crt } from './Crt'
import { Terminal, type TermLine } from './Terminal'

export function App() {
  const [lines, setLines] = useState<TermLine[]>([
    { text: 'FlashShell v0 — 아직 셸이 없습니다. 입력을 되뱉습니다.', tone: 'dim' },
  ])

  function handleSubmit(line: string) {
    setLines((prev) => [
      ...prev,
      { text: `player@flashshell:~$ ${line}`, tone: 'dim' },
      { text: line, tone: 'green' },
    ])
  }

  return (
    <Crt>
      <Terminal lines={lines} prompt="player@flashshell:~$ " onSubmit={handleSubmit} />
    </Crt>
  )
}
```

- [ ] **Step 9: 눈으로 확인**

Run: `npm run dev`
Expected: 어두운 인광 화면, 주사선, 비네팅. 타이핑하면 녹색 글자가 빛난다. 입력한 줄이 그대로 되돌아온다. `↑`로 히스토리가 돈다.

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "feat: phosphor CRT shell and DOM terminal with history and tab completion"
```

**M0 완료.** 여기서 비주얼에 대한 사용자 확인을 받고 넘어간다.

---

## Task 3: 가상 파일시스템 (VFS)

게임 전체가 이 객체 위에 선다. 검증기가 직접 읽는 대상이므로, API는 명료하고 예외는 실제 리눅스의 errno를 흉내내야 한다.

**Files:**
- Create: `src/shell/errors.ts`, `src/shell/vfs.ts`
- Test: `src/shell/vfs.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:

```ts
// src/shell/errors.ts
export type ErrCode = 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EACCES' | 'EINVAL'
export class VfsError extends Error {
  constructor(public code: ErrCode, public path: string) { super(`${code}: ${path}`) }
}
export class ExecutionLimitError extends Error {
  constructor() { super('execution limit exceeded') }
}
```

```ts
// src/shell/vfs.ts
export type NodeKind = 'file' | 'dir' | 'symlink'
export interface VNode {
  kind: NodeKind
  mode: number                      // 8진 권한 비트, 예: 0o644
  content: string                   // file일 때만 의미 있음
  target: string                    // symlink일 때만 의미 있음
  children: Map<string, VNode>      // dir일 때만 의미 있음
  mtime: number                     // 논리 시계. 매 변경마다 1 증가.
}

export class VFS {
  resolve(path: string, cwd: string): string          // 절대경로로 정규화 ('.' '..' 처리, 후행 '/' 제거)
  lookup(abs: string): VNode | null                   // 심볼릭 링크를 따라간다
  lstat(abs: string): VNode | null                    // 따라가지 않는다
  exists(abs: string): boolean
  isDir(abs: string): boolean
  readFile(abs: string): string                       // ENOENT, EISDIR
  writeFile(abs: string, content: string, mode?: number): void  // ENOENT(부모없음), EISDIR
  appendFile(abs: string, content: string): void
  readdir(abs: string): string[]                      // 정렬됨. ENOENT, ENOTDIR
  mkdir(abs: string, opts?: { recursive?: boolean }): void      // EEXIST, ENOENT
  rmdir(abs: string): void                            // ENOTEMPTY, ENOENT, ENOTDIR
  unlink(abs: string): void                           // ENOENT, EISDIR
  rm(abs: string, opts?: { recursive?: boolean }): void
  rename(from: string, to: string): void
  symlink(target: string, abs: string): void
  chmod(abs: string, mode: number): void
  touch(abs: string): void                            // 없으면 빈 파일 생성, 있으면 mtime만 갱신
}
```

`mtime`을 실제 시간이 아니라 **단조 증가하는 논리 시계**로 두는 것이 중요하다. 테스트가 결정적이 되고, 골든 테스트에서 시간이 흔들리지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/vfs.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from './vfs'
import { VfsError } from './errors'

let fs: VFS
beforeEach(() => { fs = new VFS() })

describe('VFS.resolve', () => {
  it('상대경로를 cwd 기준 절대경로로 만든다', () => {
    expect(fs.resolve('a/b', '/home')).toBe('/home/a/b')
  })
  it('. 과 .. 를 접는다', () => {
    expect(fs.resolve('./a/../b/./c', '/home')).toBe('/home/b/c')
  })
  it('루트 위로 올라가지 않는다', () => {
    expect(fs.resolve('../../..', '/home')).toBe('/')
  })
  it('후행 슬래시를 제거하되 루트는 보존한다', () => {
    expect(fs.resolve('/a/b/', '/')).toBe('/a/b')
    expect(fs.resolve('/', '/')).toBe('/')
  })
})

describe('VFS 파일 조작', () => {
  it('디렉터리를 만들고 파일을 쓰고 읽는다', () => {
    fs.mkdir('/home', { recursive: true })
    fs.writeFile('/home/a.txt', 'hello')
    expect(fs.readFile('/home/a.txt')).toBe('hello')
  })

  it('부모가 없으면 writeFile은 ENOENT', () => {
    expect(() => fs.writeFile('/nope/a.txt', 'x')).toThrow(VfsError)
    try { fs.writeFile('/nope/a.txt', 'x') } catch (e) { expect((e as VfsError).code).toBe('ENOENT') }
  })

  it('recursive 없이 중첩 mkdir은 ENOENT', () => {
    try { fs.mkdir('/a/b') } catch (e) { expect((e as VfsError).code).toBe('ENOENT') }
  })

  it('이미 있는 디렉터리에 mkdir은 EEXIST', () => {
    fs.mkdir('/a')
    try { fs.mkdir('/a') } catch (e) { expect((e as VfsError).code).toBe('EEXIST') }
  })

  it('recursive mkdir은 이미 있어도 조용하다', () => {
    fs.mkdir('/a/b', { recursive: true })
    expect(() => fs.mkdir('/a/b', { recursive: true })).not.toThrow()
  })

  it('비어있지 않은 디렉터리 rmdir은 ENOTEMPTY', () => {
    fs.mkdir('/a'); fs.writeFile('/a/f', '')
    try { fs.rmdir('/a') } catch (e) { expect((e as VfsError).code).toBe('ENOTEMPTY') }
  })

  it('rm -r 은 하위를 통째로 지운다', () => {
    fs.mkdir('/a/b', { recursive: true }); fs.writeFile('/a/b/f', 'x')
    fs.rm('/a', { recursive: true })
    expect(fs.exists('/a')).toBe(false)
  })

  it('디렉터리를 readFile 하면 EISDIR', () => {
    fs.mkdir('/a')
    try { fs.readFile('/a') } catch (e) { expect((e as VfsError).code).toBe('EISDIR') }
  })

  it('readdir은 정렬된 이름을 준다', () => {
    fs.mkdir('/a'); fs.writeFile('/a/c', ''); fs.writeFile('/a/b', ''); fs.mkdir('/a/A')
    expect(fs.readdir('/a')).toEqual(['A', 'b', 'c'])
  })

  it('appendFile은 이어붙인다', () => {
    fs.writeFile('/f', 'a'); fs.appendFile('/f', 'b')
    expect(fs.readFile('/f')).toBe('ab')
  })

  it('rename은 파일을 옮긴다', () => {
    fs.writeFile('/a', 'x'); fs.rename('/a', '/b')
    expect(fs.exists('/a')).toBe(false)
    expect(fs.readFile('/b')).toBe('x')
  })

  it('touch는 없으면 만들고 있으면 mtime만 올린다', () => {
    fs.touch('/f')
    const t1 = fs.lstat('/f')!.mtime
    fs.touch('/f')
    expect(fs.lstat('/f')!.mtime).toBeGreaterThan(t1)
    expect(fs.readFile('/f')).toBe('')
  })
})

describe('VFS 심볼릭 링크', () => {
  it('lookup은 링크를 따라가고 lstat은 따라가지 않는다', () => {
    fs.writeFile('/real', 'data')
    fs.symlink('/real', '/link')
    expect(fs.lookup('/link')!.kind).toBe('file')
    expect(fs.lstat('/link')!.kind).toBe('symlink')
    expect(fs.readFile('/link')).toBe('data')
  })

  it('끊어진 링크를 읽으면 ENOENT', () => {
    fs.symlink('/gone', '/link')
    try { fs.readFile('/link') } catch (e) { expect((e as VfsError).code).toBe('ENOENT') }
  })

  it('순환 링크는 ELOOP 대신 ENOENT로 끝난다 (무한루프 금지)', () => {
    fs.symlink('/b', '/a'); fs.symlink('/a', '/b')
    expect(() => fs.readFile('/a')).toThrow(VfsError)
  })
})

describe('VFS.chmod', () => {
  it('권한 비트를 바꾼다', () => {
    fs.writeFile('/f', '')
    fs.chmod('/f', 0o755)
    expect(fs.lstat('/f')!.mode).toBe(0o755)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/vfs.test.ts`
Expected: FAIL — "Failed to resolve import ./vfs"

- [ ] **Step 3: `errors.ts` 작성**

```ts
// src/shell/errors.ts
export type ErrCode =
  | 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EACCES' | 'EINVAL'

export class VfsError extends Error {
  constructor(public readonly code: ErrCode, public readonly path: string) {
    super(`${code}: ${path}`)
    this.name = 'VfsError'
  }
}

export class ExecutionLimitError extends Error {
  constructor() {
    super('execution limit exceeded')
    this.name = 'ExecutionLimitError'
  }
}

const ERRNO_TEXT: Record<ErrCode, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  EACCES: 'Permission denied',
  EINVAL: 'Invalid argument',
}

/** 예외를 리눅스가 쓰는 사람 읽는 문구로 옮긴다. 인터프리터와 코어유틸이 함께 쓴다. */
export function errnoText(error: unknown): string {
  if (error instanceof VfsError) return ERRNO_TEXT[error.code]
  return error instanceof Error ? error.message : String(error)
}
```

- [ ] **Step 4: `vfs.ts` 구현**

```ts
// src/shell/vfs.ts
import { VfsError } from './errors'

export type NodeKind = 'file' | 'dir' | 'symlink'

export interface VNode {
  kind: NodeKind
  mode: number
  content: string
  target: string
  children: Map<string, VNode>
  mtime: number
}

const MAX_SYMLINK_HOPS = 32

function makeNode(kind: NodeKind, mode: number, mtime: number): VNode {
  return { kind, mode, content: '', target: '', children: new Map(), mtime }
}

export class VFS {
  private root: VNode
  private clock = 1

  constructor() {
    this.root = makeNode('dir', 0o755, this.clock)
  }

  private tick(): number { return ++this.clock }

  resolve(path: string, cwd: string): string {
    const start = path.startsWith('/') ? '/' : cwd
    const segments = `${start}/${path}`.split('/')
    const stack: string[] = []
    for (const seg of segments) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') { stack.pop(); continue }
      stack.push(seg)
    }
    return '/' + stack.join('/')
  }

  private split(abs: string): string[] {
    return abs.split('/').filter((s) => s !== '')
  }

  /** 심볼릭 링크를 따라가지 않고 노드를 찾는다. */
  lstat(abs: string): VNode | null {
    const parts = this.split(abs)
    let node: VNode = this.root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      // 중간 경로 요소는 반드시 디렉터리여야 한다. 링크면 따라간다.
      if (node.kind === 'symlink') {
        const resolved = this.lookup(node.target)
        if (!resolved) return null
        node = resolved
      }
      if (node.kind !== 'dir') return null
      const child = node.children.get(name)
      if (!child) return null
      node = child
    }
    return node
  }

  /** 심볼릭 링크를 끝까지 따라간다. */
  lookup(abs: string): VNode | null {
    let current = abs
    for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop++) {
      const node = this.lstat(current)
      if (!node) return null
      if (node.kind !== 'symlink') return node
      current = node.target.startsWith('/') ? node.target : this.resolve(node.target, this.dirname(current))
    }
    return null // 순환. ENOENT로 취급한다.
  }

  private dirname(abs: string): string {
    const parts = this.split(abs)
    parts.pop()
    return '/' + parts.join('/')
  }

  private basename(abs: string): string {
    const parts = this.split(abs)
    return parts[parts.length - 1] ?? ''
  }

  /** 부모 디렉터리 노드를 얻는다. 없거나 디렉터리가 아니면 던진다. */
  private parentDir(abs: string): VNode {
    const parent = this.dirname(abs)
    const node = this.lookup(parent)
    if (!node) throw new VfsError('ENOENT', parent)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', parent)
    return node
  }

  exists(abs: string): boolean { return this.lookup(abs) !== null }

  isDir(abs: string): boolean { return this.lookup(abs)?.kind === 'dir' }

  readFile(abs: string): string {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind === 'dir') throw new VfsError('EISDIR', abs)
    return node.content
  }

  writeFile(abs: string, content: string, mode = 0o644): void {
    const parent = this.parentDir(abs)
    const name = this.basename(abs)
    const existing = parent.children.get(name)
    if (existing?.kind === 'dir') throw new VfsError('EISDIR', abs)
    if (existing?.kind === 'file') {
      existing.content = content
      existing.mtime = this.tick()
      return
    }
    const node = makeNode('file', mode, this.tick())
    node.content = content
    parent.children.set(name, node)
  }

  appendFile(abs: string, content: string): void {
    if (!this.exists(abs)) { this.writeFile(abs, content); return }
    this.writeFile(abs, this.readFile(abs) + content)
  }

  readdir(abs: string): string[] {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', abs)
    return [...node.children.keys()].sort()
  }

  mkdir(abs: string, opts: { recursive?: boolean } = {}): void {
    if (opts.recursive) {
      const parts = this.split(abs)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        const node = this.lookup(current)
        if (node?.kind === 'dir') continue
        if (node) throw new VfsError('ENOTDIR', current)
        this.parentDir(current).children.set(part, makeNode('dir', 0o755, this.tick()))
      }
      return
    }
    if (this.exists(abs)) throw new VfsError('EEXIST', abs)
    this.parentDir(abs).children.set(this.basename(abs), makeNode('dir', 0o755, this.tick()))
  }

  rmdir(abs: string): void {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', abs)
    if (node.children.size > 0) throw new VfsError('ENOTEMPTY', abs)
    this.parentDir(abs).children.delete(this.basename(abs))
  }

  unlink(abs: string): void {
    const node = this.lstat(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind === 'dir') throw new VfsError('EISDIR', abs)
    this.parentDir(abs).children.delete(this.basename(abs))
  }

  rm(abs: string, opts: { recursive?: boolean } = {}): void {
    const node = this.lstat(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind === 'dir' && !opts.recursive) throw new VfsError('EISDIR', abs)
    this.parentDir(abs).children.delete(this.basename(abs))
  }

  rename(from: string, to: string): void {
    const node = this.lstat(from)
    if (!node) throw new VfsError('ENOENT', from)
    const destParent = this.parentDir(to)
    this.parentDir(from).children.delete(this.basename(from))
    node.mtime = this.tick()
    destParent.children.set(this.basename(to), node)
  }

  symlink(target: string, abs: string): void {
    const parent = this.parentDir(abs)
    if (parent.children.has(this.basename(abs))) throw new VfsError('EEXIST', abs)
    const node = makeNode('symlink', 0o777, this.tick())
    node.target = target
    parent.children.set(this.basename(abs), node)
  }

  chmod(abs: string, mode: number): void {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    node.mode = mode
    node.mtime = this.tick()
  }

  touch(abs: string): void {
    const node = this.lookup(abs)
    if (!node) { this.writeFile(abs, ''); return }
    node.mtime = this.tick()
  }
}
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/vfs.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 6: 커밋**

```bash
git add src/shell/vfs.ts src/shell/errors.ts src/shell/vfs.test.ts
git commit -m "feat(shell): virtual filesystem with inode tree, symlinks, and posix errno"
```

---

## Task 4: 렉서

따옴표 정보를 토큰 너머로 살려 보내는 것이 이 태스크의 핵심이다. `'$X'`와 `"$X"`와 `$X`는 확장기에서 전혀 다르게 취급되므로, 렉서가 그 구분을 지워버리면 복구할 수 없다. 그래서 WORD 토큰은 문자열이 아니라 **조각의 배열**이다.

**Files:**
- Create: `src/shell/lexer.ts`
- Test: `src/shell/lexer.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:

```ts
export type WordPart =
  | { kind: 'literal'; text: string }   // 작은따옴표 안 / 이스케이프됨 → 확장 없음
  | { kind: 'raw'; text: string }       // 따옴표 없음 → 확장 + 단어분할 + 글롭
  | { kind: 'dquote'; text: string }    // 큰따옴표 안 → 확장만, 분할·글롭 없음

export type Word = WordPart[]

export type Token =
  | { type: 'WORD'; word: Word }
  | { type: 'OP'; value: Operator }
  | { type: 'EOF' }

export type Operator = '|' | '||' | '&&' | ';' | '>' | '>>' | '<' | '2>' | '2>>'

export function tokenize(input: string): Token[]
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/lexer.test.ts
import { describe, it, expect } from 'vitest'
import { tokenize, type Token } from './lexer'

const words = (ts: Token[]) => ts.filter((t) => t.type === 'WORD')
const ops = (ts: Token[]) => ts.filter((t) => t.type === 'OP').map((t) => t.value)

describe('tokenize', () => {
  it('공백으로 단어를 나눈다', () => {
    expect(words(tokenize('ls -a /tmp'))).toHaveLength(3)
  })

  it('연속 공백을 하나로 취급한다', () => {
    expect(words(tokenize('ls    -a'))).toHaveLength(2)
  })

  it('EOF 토큰으로 끝난다', () => {
    const ts = tokenize('ls')
    expect(ts[ts.length - 1]).toEqual({ type: 'EOF' })
  })

  it('연산자를 인식한다', () => {
    expect(ops(tokenize('a | b && c || d ; e'))).toEqual(['|', '&&', '||', ';'])
  })

  it('긴 연산자를 짧은 것보다 먼저 먹는다', () => {
    expect(ops(tokenize('a >> b'))).toEqual(['>>'])
    expect(ops(tokenize('a > b'))).toEqual(['>'])
    expect(ops(tokenize('a 2>> b'))).toEqual(['2>>'])
    expect(ops(tokenize('a 2> b'))).toEqual(['2>'])
  })

  it('연산자에 공백이 없어도 나눈다', () => {
    expect(ops(tokenize('a|b'))).toEqual(['|'])
    expect(words(tokenize('a|b'))).toHaveLength(2)
  })

  it('2> 는 연산자지만 2 는 단어다', () => {
    expect(ops(tokenize('echo 2'))).toEqual([])
    expect(ops(tokenize('echo 2>f'))).toEqual(['2>'])
  })

  it('작은따옴표 안은 literal 조각이다', () => {
    const ts = tokenize("echo '$HOME'")
    expect(words(ts)[1]!.word).toEqual([{ kind: 'literal', text: '$HOME' }])
  })

  it('큰따옴표 안은 dquote 조각이다', () => {
    const ts = tokenize('echo "$HOME"')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'dquote', text: '$HOME' }])
  })

  it('따옴표 없는 부분은 raw 조각이다', () => {
    const ts = tokenize('echo $HOME')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$HOME' }])
  })

  it('한 단어 안에서 조각들이 이어붙는다', () => {
    const ts = tokenize(`echo a'b'"c"`)
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'raw', text: 'a' },
      { kind: 'literal', text: 'b' },
      { kind: 'dquote', text: 'c' },
    ])
  })

  it('백슬래시 이스케이프는 literal 조각이 된다', () => {
    const ts = tokenize('echo a\\ b')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'raw', text: 'a' },
      { kind: 'literal', text: ' ' },
      { kind: 'raw', text: 'b' },
    ])
  })

  it('따옴표 안의 연산자는 연산자가 아니다', () => {
    expect(ops(tokenize(`echo '|'`))).toEqual([])
  })

  it('$( ) 안의 공백과 연산자는 통째로 한 조각이다', () => {
    const ts = tokenize('echo $(ls | wc -l)')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(ls | wc -l)' }])
  })

  it('중첩된 $( ) 괄호를 센다', () => {
    const ts = tokenize('echo $(echo $(echo hi))')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(echo $(echo hi))' }])
  })

  it('닫히지 않은 따옴표는 던진다', () => {
    expect(() => tokenize(`echo 'abc`)).toThrow(/unexpected EOF/)
  })

  it('빈 입력은 EOF만 낸다', () => {
    expect(tokenize('   ')).toEqual([{ type: 'EOF' }])
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/lexer.test.ts`
Expected: FAIL — "Failed to resolve import ./lexer"

- [ ] **Step 3: `lexer.ts` 구현**

```ts
// src/shell/lexer.ts
export type WordPart =
  | { kind: 'literal'; text: string }
  | { kind: 'raw'; text: string }
  | { kind: 'dquote'; text: string }

export type Word = WordPart[]

export type Operator = '|' | '||' | '&&' | ';' | '>' | '>>' | '<' | '2>' | '2>>'

export type Token =
  | { type: 'WORD'; word: Word }
  | { type: 'OP'; value: Operator }
  | { type: 'EOF' }

// 긴 것부터. 앞선 것이 먼저 매칭된다.
const OPERATORS: Operator[] = ['2>>', '2>', '>>', '&&', '||', '|', ';', '>', '<']

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let word: Word = []

  const flush = () => {
    if (word.length > 0) { tokens.push({ type: 'WORD', word }); word = [] }
  }

  // 같은 종류의 조각이 이어지면 합친다. 빈 텍스트라도 조각은 반드시 남는다 —
  // 그래야 `echo ""` 가 빈 단어 하나를 만든다.
  const push = (kind: WordPart['kind'], text: string) => {
    const last = word[word.length - 1]
    if (last && last.kind === kind) last.text += text
    else word.push({ kind, text } as WordPart)
  }

  while (i < input.length) {
    const ch = input[i]!

    if (ch === ' ' || ch === '\t' || ch === '\n') { flush(); i++; continue }

    // 연산자. 단, '2>' 계열은 앞에 다른 글자가 붙어있지 않을 때만 연산자다.
    // (`echo 2` 의 2는 단어, `echo 2>f` 의 2>는 연산자)
    const op = OPERATORS.find((o) => input.startsWith(o, i))
    if (op) {
      const isFdRedirect = op.startsWith('2')
      if (!isFdRedirect || word.length === 0) {
        flush()
        tokens.push({ type: 'OP', value: op })
        i += op.length
        continue
      }
    }

    if (ch === '\\') {
      const next = input[i + 1]
      if (next === undefined) throw new Error('unexpected EOF after backslash')
      push('literal', next)
      i += 2
      continue
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end === -1) throw new Error("unexpected EOF while looking for matching `'`")
      push('literal', input.slice(i + 1, end))
      i = end + 1
      continue
    }

    if (ch === '"') {
      let j = i + 1
      let text = ''
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && (input[j + 1] === '"' || input[j + 1] === '\\' || input[j + 1] === '$')) {
          text += input[j + 1]!
          j += 2
          continue
        }
        text += input[j]!
        j++
      }
      if (j >= input.length) throw new Error('unexpected EOF while looking for matching `"`')
      push('dquote', text)
      i = j + 1
      continue
    }

    // $( ... ) 는 괄호 깊이를 세어 통째로 삼킨다. 안의 공백·연산자는 렉서가 건드리지 않는다.
    if (ch === '$' && input[i + 1] === '(') {
      let depth = 0
      let j = i + 1
      for (; j < input.length; j++) {
        if (input[j] === '(') depth++
        else if (input[j] === ')') { depth--; if (depth === 0) break }
      }
      if (depth !== 0) throw new Error('unexpected EOF while looking for matching `)`')
      push('raw', input.slice(i, j + 1))
      i = j + 1
      continue
    }

    push('raw', ch)
    i++
  }

  flush()
  tokens.push({ type: 'EOF' })
  return tokens
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/lexer.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: 커밋**

```bash
git add src/shell/lexer.ts src/shell/lexer.test.ts
git commit -m "feat(shell): lexer preserving quote context in word parts"
```

---

## Task 5: 파서

**Files:**
- Create: `src/shell/parser.ts`
- Test: `src/shell/parser.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `Word`, `Operator` (Task 4)
- Produces:

```ts
export interface Redir { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; target: Word }
export interface Assignment { name: string; value: Word }

export interface CommandNode {
  kind: 'command'
  assignments: Assignment[]   // 명령 앞에 붙은 FOO=bar
  words: Word[]               // 명령 이름 + 인자
  redirs: Redir[]
}

export interface PipelineNode { kind: 'pipeline'; commands: CommandNode[] }

/** items[0].op 은 항상 null. 이후 항목의 op 는 앞 파이프라인과의 연결자. */
export interface ListNode {
  kind: 'list'
  items: { op: ';' | '&&' | '||' | null; pipeline: PipelineNode }[]
}

export function parse(input: string): ListNode
```

M1의 문법은 이것이 전부다.

```
list      := pipeline (( ';' | '&&' | '||' ) pipeline)* ';'?
pipeline  := command ('|' command)*
command   := assignment* word* redirect*     (순서는 섞여도 된다)
redirect  := ('>' | '>>' | '<' | '2>' | '2>>') word
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/parser.test.ts
import { describe, it, expect } from 'vitest'
import { parse } from './parser'

const raw = (text: string) => [{ kind: 'raw' as const, text }]

describe('parse', () => {
  it('단일 명령을 파싱한다', () => {
    const ast = parse('ls -a')
    expect(ast.items).toHaveLength(1)
    expect(ast.items[0]!.op).toBeNull()
    const cmd = ast.items[0]!.pipeline.commands[0]!
    expect(cmd.words).toEqual([raw('ls'), raw('-a')])
    expect(cmd.redirs).toEqual([])
  })

  it('파이프라인을 파싱한다', () => {
    const ast = parse('cat f | grep x | wc -l')
    expect(ast.items[0]!.pipeline.commands).toHaveLength(3)
  })

  it('&& 와 || 와 ; 를 연결자로 기록한다', () => {
    const ast = parse('a && b || c ; d')
    expect(ast.items.map((i) => i.op)).toEqual([null, '&&', '||', ';'])
  })

  it('후행 세미콜론은 빈 항목을 만들지 않는다', () => {
    expect(parse('ls ;').items).toHaveLength(1)
  })

  it('출력 리다이렉션을 fd 1로 기록한다', () => {
    const cmd = parse('echo hi > out.txt').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs).toEqual([{ fd: 1, op: '>', target: raw('out.txt') }])
    expect(cmd.words).toEqual([raw('echo'), raw('hi')])
  })

  it('추가 리다이렉션 >>', () => {
    const cmd = parse('echo hi >> out').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs[0]).toEqual({ fd: 1, op: '>>', target: raw('out') })
  })

  it('입력 리다이렉션을 fd 0으로 기록한다', () => {
    const cmd = parse('wc -l < in').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs[0]).toEqual({ fd: 0, op: '<', target: raw('in') })
  })

  it('2> 와 2>> 를 fd 2로 기록한다', () => {
    expect(parse('cmd 2> e').items[0]!.pipeline.commands[0]!.redirs[0])
      .toEqual({ fd: 2, op: '>', target: raw('e') })
    expect(parse('cmd 2>> e').items[0]!.pipeline.commands[0]!.redirs[0])
      .toEqual({ fd: 2, op: '>>', target: raw('e') })
  })

  it('리다이렉션이 명령 중간에 와도 된다', () => {
    const cmd = parse('echo > out hi').items[0]!.pipeline.commands[0]!
    expect(cmd.words).toEqual([raw('echo'), raw('hi')])
    expect(cmd.redirs).toHaveLength(1)
  })

  it('여러 리다이렉션을 순서대로 모은다', () => {
    const cmd = parse('cmd > o 2> e < i').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs.map((r) => r.fd)).toEqual([1, 2, 0])
  })

  it('선행 변수 대입을 분리한다', () => {
    const cmd = parse('FOO=bar ls').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([{ name: 'FOO', value: raw('bar') }])
    expect(cmd.words).toEqual([raw('ls')])
  })

  it('명령 없는 순수 대입도 파싱한다', () => {
    const cmd = parse('X=1').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toHaveLength(1)
    expect(cmd.words).toEqual([])
  })

  it('명령 뒤에 오는 FOO=bar 는 대입이 아니라 인자다', () => {
    const cmd = parse('echo FOO=bar').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([])
    expect(cmd.words).toHaveLength(2)
  })

  it('따옴표 붙은 FOO 는 대입이 아니다', () => {
    const cmd = parse(`'FOO'=bar`).items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([])
  })

  it('리다이렉션 대상이 없으면 던진다', () => {
    expect(() => parse('echo >')).toThrow(/syntax error/)
  })

  it('파이프 뒤에 명령이 없으면 던진다', () => {
    expect(() => parse('ls |')).toThrow(/syntax error/)
  })

  it('&& 로 시작하면 던진다', () => {
    expect(() => parse('&& ls')).toThrow(/syntax error/)
  })

  it('빈 입력은 항목 없는 리스트다', () => {
    expect(parse('   ').items).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/parser.test.ts`
Expected: FAIL — "Failed to resolve import ./parser"

- [ ] **Step 3: `parser.ts` 구현**

```ts
// src/shell/parser.ts
import { tokenize, type Operator, type Token, type Word } from './lexer'

export interface Redir { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; target: Word }
export interface Assignment { name: string; value: Word }

export interface CommandNode {
  kind: 'command'
  assignments: Assignment[]
  words: Word[]
  redirs: Redir[]
}

export interface PipelineNode { kind: 'pipeline'; commands: CommandNode[] }

export interface ListNode {
  kind: 'list'
  items: { op: ';' | '&&' | '||' | null; pipeline: PipelineNode }[]
}

const REDIR_OPS: Operator[] = ['>', '>>', '<', '2>', '2>>']
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s

function syntaxError(near: string): never {
  throw new Error(`syntax error near \`${near}'`)
}

/** 따옴표 없이 순수 raw 조각 하나로만 이루어진 단어의 텍스트. 아니면 null. */
function pureRaw(word: Word): string | null {
  if (word.length !== 1) return null
  const part = word[0]!
  return part.kind === 'raw' ? part.text : null
}

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]! }

  private next(): Token { return this.tokens[this.pos++]! }

  private atOp(...ops: Operator[]): boolean {
    const t = this.peek()
    return t.type === 'OP' && ops.includes(t.value)
  }

  parseList(): ListNode {
    const items: ListNode['items'] = []
    if (this.peek().type === 'EOF') return { kind: 'list', items }
    if (this.peek().type === 'OP') syntaxError((this.peek() as { value: string }).value)

    items.push({ op: null, pipeline: this.parsePipeline() })

    while (this.atOp(';', '&&', '||')) {
      const op = (this.next() as { value: ';' | '&&' | '||' }).value
      if (this.peek().type === 'EOF') {
        if (op === ';') break              // 후행 세미콜론은 허용
        syntaxError(op)
      }
      items.push({ op, pipeline: this.parsePipeline() })
    }

    if (this.peek().type !== 'EOF') syntaxError('unexpected token')
    return { kind: 'list', items }
  }

  private parsePipeline(): PipelineNode {
    const commands: CommandNode[] = [this.parseCommand()]
    while (this.atOp('|')) {
      this.next()
      if (this.peek().type === 'EOF') syntaxError('|')
      commands.push(this.parseCommand())
    }
    return { kind: 'pipeline', commands }
  }

  private parseCommand(): CommandNode {
    const cmd: CommandNode = { kind: 'command', assignments: [], words: [], redirs: [] }
    let sawWord = false

    for (;;) {
      const t = this.peek()

      if (t.type === 'OP' && REDIR_OPS.includes(t.value)) {
        this.next()
        const target = this.peek()
        if (target.type !== 'WORD') syntaxError(t.value)
        this.next()
        const fd = t.value.startsWith('2') ? 2 : t.value === '<' ? 0 : 1
        const op = t.value === '<' ? '<' : t.value.endsWith('>>') ? '>>' : '>'
        cmd.redirs.push({ fd, op, target: target.word })
        continue
      }

      if (t.type !== 'WORD') break

      this.next()
      // 첫 단어가 나오기 전의 FOO=bar 만 대입이다. 그것도 따옴표가 없을 때만.
      if (!sawWord) {
        const text = pureRaw(t.word)
        const m = text ? ASSIGN_RE.exec(text) : null
        if (m) {
          cmd.assignments.push({ name: m[1]!, value: [{ kind: 'raw', text: m[2]! }] })
          continue
        }
      }
      sawWord = true
      cmd.words.push(t.word)
    }

    if (cmd.words.length === 0 && cmd.assignments.length === 0 && cmd.redirs.length === 0) {
      syntaxError('unexpected token')
    }
    return cmd
  }
}

export function parse(input: string): ListNode {
  return new Parser(tokenize(input)).parseList()
}
```

`&&`로 시작하는 입력을 거부하는 검사가 `parseList` 맨 앞에 있는 이유는, 그러지 않으면 `parseCommand`가 "빈 명령" 에러를 내면서 메시지가 엉뚱해지기 때문이다. 사용자에게 정확한 위치를 알려주는 편이 낫다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/parser.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 5: 커밋**

```bash
git add src/shell/parser.ts src/shell/parser.test.ts
git commit -m "feat(shell): recursive descent parser for lists, pipelines, redirections"
```

---

## Task 6: 글롭

**Files:**
- Create: `src/shell/glob.ts`
- Test: `src/shell/glob.test.ts`

**Interfaces:**
- Consumes: `VFS` (Task 3)
- Produces:

```ts
/** 패턴 하나를 파일명 하나에 맞춰본다. 경로 구분자는 다루지 않는다. */
export function matchSegment(pattern: string, name: string): boolean

/**
 * 글롭을 확장한다. 매칭이 하나도 없으면 패턴 문자열 자체를 담은 배열을 돌려준다
 * (bash 기본 동작. nullglob 없음). 결과는 사전순 정렬.
 */
export function expandGlob(pattern: string, cwd: string, fs: VFS): string[]

/** 글롭 메타문자가 들어있는가? */
export function hasGlob(text: string): boolean
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/glob.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from './vfs'
import { matchSegment, expandGlob, hasGlob } from './glob'

describe('matchSegment', () => {
  it('* 는 아무 문자열에나 맞는다', () => {
    expect(matchSegment('*', 'abc')).toBe(true)
    expect(matchSegment('*.txt', 'a.txt')).toBe(true)
    expect(matchSegment('*.txt', 'a.md')).toBe(false)
  })
  it('? 는 정확히 한 글자', () => {
    expect(matchSegment('a?c', 'abc')).toBe(true)
    expect(matchSegment('a?c', 'ac')).toBe(false)
  })
  it('[abc] 는 문자 집합', () => {
    expect(matchSegment('[abc].txt', 'b.txt')).toBe(true)
    expect(matchSegment('[abc].txt', 'd.txt')).toBe(false)
  })
  it('[a-c] 는 범위', () => {
    expect(matchSegment('[a-c]', 'b')).toBe(true)
    expect(matchSegment('[a-c]', 'd')).toBe(false)
  })
  it('[!a] 와 [^a] 는 부정', () => {
    expect(matchSegment('[!a]', 'b')).toBe(true)
    expect(matchSegment('[!a]', 'a')).toBe(false)
    expect(matchSegment('[^a]', 'b')).toBe(true)
  })
  it('정규식 메타문자를 문자 그대로 취급한다', () => {
    expect(matchSegment('a.b', 'a.b')).toBe(true)
    expect(matchSegment('a.b', 'axb')).toBe(false)
    expect(matchSegment('a+b', 'a+b')).toBe(true)
  })
  it('* 는 점으로 시작하는 이름에 맞지 않는다', () => {
    expect(matchSegment('*', '.hidden')).toBe(false)
    expect(matchSegment('.*', '.hidden')).toBe(true)
  })
})

describe('hasGlob', () => {
  it('메타문자를 감지한다', () => {
    expect(hasGlob('*.txt')).toBe(true)
    expect(hasGlob('a?b')).toBe(true)
    expect(hasGlob('[ab]')).toBe(true)
    expect(hasGlob('plain.txt')).toBe(false)
  })
})

describe('expandGlob', () => {
  let fs: VFS
  beforeEach(() => {
    fs = new VFS()
    fs.mkdir('/w/sub', { recursive: true })
    fs.writeFile('/w/a.txt', '')
    fs.writeFile('/w/b.txt', '')
    fs.writeFile('/w/c.md', '')
    fs.writeFile('/w/.hidden', '')
    fs.writeFile('/w/sub/d.txt', '')
  })

  it('cwd 안에서 확장하고 정렬한다', () => {
    expect(expandGlob('*.txt', '/w', fs)).toEqual(['a.txt', 'b.txt'])
  })

  it('매칭이 없으면 패턴 그대로 돌려준다', () => {
    expect(expandGlob('*.zip', '/w', fs)).toEqual(['*.zip'])
  })

  it('경로 중간의 글롭도 확장한다', () => {
    expect(expandGlob('/w/*/d.txt', '/', fs)).toEqual(['/w/sub/d.txt'])
  })

  it('절대경로 패턴은 절대경로를 돌려준다', () => {
    expect(expandGlob('/w/*.md', '/', fs)).toEqual(['/w/c.md'])
  })

  it('숨김파일은 명시적으로 점을 써야 잡힌다', () => {
    expect(expandGlob('*', '/w', fs)).toEqual(['a.txt', 'b.txt', 'c.md', 'sub'])
    expect(expandGlob('.*', '/w', fs)).toEqual(['.hidden'])
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/glob.test.ts`
Expected: FAIL — "Failed to resolve import ./glob"

- [ ] **Step 3: `glob.ts` 구현**

```ts
// src/shell/glob.ts
import type { VFS } from './vfs'

export function hasGlob(text: string): boolean {
  return /[*?[]/.test(text)
}

/** 글롭 패턴을 정규식으로 옮긴다. 정규식 메타문자는 전부 이스케이프한다. */
function toRegExp(pattern: string): RegExp {
  let out = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (ch === '*') { out += '[^/]*'; i++; continue }
    if (ch === '?') { out += '[^/]'; i++; continue }
    if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) { out += '\\['; i++; continue }   // 닫히지 않은 [ 는 문자 그대로
      let body = pattern.slice(i + 1, close)
      if (body.startsWith('!') || body.startsWith('^')) body = '^' + body.slice(1)
      out += `[${body}]`
      i = close + 1
      continue
    }
    out += ch.replace(/[.+^${}()|\\]/g, '\\$&')
    i++
  }
  return new RegExp(out + '$')
}

export function matchSegment(pattern: string, name: string): boolean {
  // bash: 글롭의 * 와 ? 는 선행 점에 맞지 않는다. 점을 쓰려면 패턴에 명시해야 한다.
  if (name.startsWith('.') && !pattern.startsWith('.')) return false
  return toRegExp(pattern).test(name)
}

export function expandGlob(pattern: string, cwd: string, fs: VFS): string[] {
  if (!hasGlob(pattern)) return [pattern]

  const absolute = pattern.startsWith('/')
  const segments = pattern.split('/').filter((s) => s !== '')

  // 시작 디렉터리에서 출발해 세그먼트를 하나씩 넓혀 나간다.
  let frontier: string[] = [absolute ? '' : '']
  const base = absolute ? '/' : cwd

  for (const segment of segments) {
    const next: string[] = []
    for (const prefix of frontier) {
      const dir = fs.resolve(prefix === '' ? '.' : prefix, base)
      if (!fs.isDir(dir)) continue

      if (!hasGlob(segment)) {
        const candidate = prefix === '' ? segment : `${prefix}/${segment}`
        if (fs.exists(fs.resolve(candidate, base))) next.push(candidate)
        continue
      }

      for (const name of fs.readdir(dir)) {
        if (!matchSegment(segment, name)) continue
        next.push(prefix === '' ? name : `${prefix}/${name}`)
      }
    }
    frontier = next
  }

  if (frontier.length === 0) return [pattern]
  const results = absolute ? frontier.map((p) => `/${p}`) : frontier
  return results.sort()
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/glob.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: 커밋**

```bash
git add src/shell/glob.ts src/shell/glob.test.ts
git commit -m "feat(shell): glob matching with *, ?, character classes, and dotfile rules"
```

---

## Task 7: 확장기

여기가 셸에서 가장 미묘한 부분이다. bash는 단어 하나를 이 순서로 처리한다: **틸드 → 변수 → 명령치환 → 단어분할 → 글롭 → 따옴표 제거.** 순서가 틀리면 `X="a b"; echo $X`가 두 단어가 아니라 한 단어가 된다.

명령치환은 인터프리터를 호출해야 하는데, 인터프리터는 확장기를 호출한다. 순환이다. **콜백 주입으로 끊는다** — 확장기는 `runSubshell` 함수를 받을 뿐, 인터프리터를 import하지 않는다.

**Files:**
- Create: `src/shell/expand.ts`
- Test: `src/shell/expand.test.ts`

**Interfaces:**
- Consumes: `Word`, `WordPart` (Task 4), `expandGlob`, `hasGlob` (Task 6), `VFS` (Task 3), `ExecResult` (Task 8에서 정의되지만 형태는 `{ stdout: string; stderr: string; exitCode: number }`)
- Produces:

```ts
export interface ExpandCtx {
  env: Record<string, string>
  cwd: string
  home: string
  fs: VFS
  lastExitCode: number
  runSubshell(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

/** 단어 하나를 0개 이상의 문자열로 확장한다. */
export function expandWord(word: Word, ctx: ExpandCtx): Promise<string[]>

/** 리다이렉션 대상처럼 단어분할·글롭 없이 정확히 하나여야 하는 경우. */
export function expandToSingle(word: Word, ctx: ExpandCtx): Promise<string>
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/expand.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from './vfs'
import { tokenize, type Word } from './lexer'
import { expandWord, expandToSingle, type ExpandCtx } from './expand'

function wordOf(source: string): Word {
  const tokens = tokenize(source)
  const first = tokens[0]
  if (!first || first.type !== 'WORD') throw new Error(`not a word: ${source}`)
  return first.word
}

let ctx: ExpandCtx
beforeEach(() => {
  const fs = new VFS()
  fs.mkdir('/w', { recursive: true })
  fs.writeFile('/w/a.txt', '')
  fs.writeFile('/w/b.txt', '')
  ctx = {
    env: { HOME: '/home/player', X: 'a b', EMPTY: '', NAME: 'world' },
    cwd: '/w',
    home: '/home/player',
    fs,
    lastExitCode: 0,
    runSubshell: async (script) => ({ stdout: `<${script}>`, stderr: '', exitCode: 0 }),
  }
})

describe('expandWord — 변수', () => {
  it('$VAR 를 치환한다', async () => {
    expect(await expandWord(wordOf('$NAME'), ctx)).toEqual(['world'])
  })
  it('${VAR} 를 치환한다', async () => {
    expect(await expandWord(wordOf('${NAME}x'), ctx)).toEqual(['worldx'])
  })
  it('없는 변수는 빈 문자열이고 단어가 사라진다', async () => {
    expect(await expandWord(wordOf('$NOPE'), ctx)).toEqual([])
  })
  it('$? 는 직전 exit code', async () => {
    ctx.lastExitCode = 3
    expect(await expandWord(wordOf('$?'), ctx)).toEqual(['3'])
  })
  it('작은따옴표 안에서는 확장하지 않는다', async () => {
    expect(await expandWord(wordOf("'$NAME'"), ctx)).toEqual(['$NAME'])
  })
  it('큰따옴표 안에서는 확장한다', async () => {
    expect(await expandWord(wordOf('"$NAME"'), ctx)).toEqual(['world'])
  })
})

describe('expandWord — 단어분할', () => {
  it('따옴표 없는 $X 는 공백으로 쪼개진다', async () => {
    expect(await expandWord(wordOf('$X'), ctx)).toEqual(['a', 'b'])
  })
  it('큰따옴표 안의 $X 는 쪼개지지 않는다', async () => {
    expect(await expandWord(wordOf('"$X"'), ctx)).toEqual(['a b'])
  })
  it('빈 변수는 따옴표가 없으면 단어를 남기지 않는다', async () => {
    expect(await expandWord(wordOf('$EMPTY'), ctx)).toEqual([])
  })
  it('빈 변수도 큰따옴표 안이면 빈 단어를 남긴다', async () => {
    expect(await expandWord(wordOf('"$EMPTY"'), ctx)).toEqual([''])
  })
  it('리터럴 텍스트는 분할되지 않는다', async () => {
    expect(await expandWord(wordOf(`'a b'`), ctx)).toEqual(['a b'])
  })
})

describe('expandWord — 틸드', () => {
  it('맨 앞의 ~ 만 홈으로 바꾼다', async () => {
    expect(await expandWord(wordOf('~/x'), ctx)).toEqual(['/home/player/x'])
    expect(await expandWord(wordOf('~'), ctx)).toEqual(['/home/player'])
  })
  it('중간의 ~ 는 그대로 둔다', async () => {
    expect(await expandWord(wordOf('a~b'), ctx)).toEqual(['a~b'])
  })
  it('따옴표 안의 ~ 는 확장하지 않는다', async () => {
    expect(await expandWord(wordOf('"~"'), ctx)).toEqual(['~'])
  })
})

describe('expandWord — 명령치환', () => {
  it('$(...) 를 stdout 으로 바꾼다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'hi\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('$(echo hi)'), ctx)).toEqual(['hi'])
  })
  it('후행 개행을 전부 벗긴다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'hi\n\n\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('$(x)'), ctx)).toEqual(['hi'])
  })
  it('내부 개행은 단어분할 대상이다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'a\nb\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('$(x)'), ctx)).toEqual(['a', 'b'])
  })
  it('큰따옴표 안이면 개행이 보존된다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'a\nb\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('"$(x)"'), ctx)).toEqual(['a\nb'])
  })
})

describe('expandWord — 글롭', () => {
  it('따옴표 없는 패턴을 확장한다', async () => {
    expect(await expandWord(wordOf('*.txt'), ctx)).toEqual(['a.txt', 'b.txt'])
  })
  it('따옴표 붙은 패턴은 확장하지 않는다', async () => {
    expect(await expandWord(wordOf(`'*.txt'`), ctx)).toEqual(['*.txt'])
  })
  it('변수에서 나온 글롭 문자도 확장된다 (bash 동작)', async () => {
    ctx.env.P = '*.txt'
    expect(await expandWord(wordOf('$P'), ctx)).toEqual(['a.txt', 'b.txt'])
  })
  it('큰따옴표 안에서 나온 글롭 문자는 확장되지 않는다', async () => {
    ctx.env.P = '*.txt'
    expect(await expandWord(wordOf('"$P"'), ctx)).toEqual(['*.txt'])
  })
})

describe('expandToSingle', () => {
  it('정확히 한 문자열을 준다', async () => {
    expect(await expandToSingle(wordOf('out.txt'), ctx)).toBe('out.txt')
  })
  it('여러 개로 확장되면 ambiguous redirect', async () => {
    await expect(expandToSingle(wordOf('*.txt'), ctx)).rejects.toThrow(/ambiguous redirect/)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/expand.test.ts`
Expected: FAIL — "Failed to resolve import ./expand"

- [ ] **Step 3: `expand.ts` 구현**

핵심 자료구조는 **필드(field)** 다. 확장 도중 각 문자에 "이 문자는 따옴표 안에서 나왔는가"를 함께 들고 다닌다. 그래야 나중에 분할과 글롭을 어디에 적용할지 알 수 있다. 이 정보를 버리면 `"$X"`와 `$X`를 구분할 방법이 사라진다.

```ts
// src/shell/expand.ts
import type { VFS } from './vfs'
import type { Word, WordPart } from './lexer'
import { expandGlob } from './glob'

export interface ExpandCtx {
  env: Record<string, string>
  cwd: string
  home: string
  fs: VFS
  lastExitCode: number
  runSubshell(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

/**
 * 확장 중간 표현.
 * - quoted[i] 는 text[i] 가 따옴표 보호를 받는지 나타낸다.
 * - hadQuotes 는 "따옴표 조각이 하나라도 있었는가"다. 내용이 비어도 참일 수 있다.
 *   `""` 는 빈 단어를 남기고 `$EMPTY` 는 단어를 남기지 않는 차이가 여기서 갈린다.
 */
interface Field { text: string; quoted: boolean[]; hadQuotes: boolean }

const empty = (): Field => ({ text: '', quoted: [], hadQuotes: false })

function append(field: Field, text: string, quoted: boolean): void {
  field.text += text
  for (let i = 0; i < text.length; i++) field.quoted.push(quoted)
}

const IFS = [' ', '\t', '\n']

/** $VAR, ${VAR}, $?, $(...) 를 치환한다. protectedResult 면 결과 문자는 따옴표 보호를 받는다. */
async function expandDollar(source: string, protectedResult: boolean, field: Field, ctx: ExpandCtx): Promise<void> {
  let i = 0
  while (i < source.length) {
    const ch = source[i]!

    if (ch !== '$') { append(field, ch, protectedResult); i++; continue }

    // $(...)
    if (source[i + 1] === '(') {
      let depth = 0
      let j = i + 1
      for (; j < source.length; j++) {
        if (source[j] === '(') depth++
        else if (source[j] === ')') { depth--; if (depth === 0) break }
      }
      const script = source.slice(i + 2, j)
      const result = await ctx.runSubshell(script)
      // 명령치환 결과의 후행 개행은 전부 벗긴다. 이것이 bash 동작이다.
      const output = result.stdout.replace(/\n+$/, '')
      // 결과는 따옴표 보호를 물려받는다. 안 그러면 "$(x)"가 쪼개진다.
      append(field, output, protectedResult)
      i = j + 1
      continue
    }

    // $?
    if (source[i + 1] === '?') {
      append(field, String(ctx.lastExitCode), protectedResult)
      i += 2
      continue
    }

    // ${NAME}
    if (source[i + 1] === '{') {
      const close = source.indexOf('}', i + 2)
      if (close === -1) { append(field, ch, protectedResult); i++; continue }
      const name = source.slice(i + 2, close)
      append(field, ctx.env[name] ?? '', protectedResult)
      i = close + 1
      continue
    }

    // $NAME
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i + 1))
    if (!match) { append(field, ch, protectedResult); i++; continue }
    append(field, ctx.env[match[0]] ?? '', protectedResult)
    i += 1 + match[0].length
  }
}

/** 따옴표 보호를 받지 않는 IFS 문자에서 필드를 쪼갠다. */
function splitFields(field: Field): Field[] {
  const out: Field[] = []
  let current = empty()
  let started = false

  for (let i = 0; i < field.text.length; i++) {
    const ch = field.text[i]!
    const isQuoted = field.quoted[i]!
    if (!isQuoted && IFS.includes(ch)) {
      if (started) { out.push(current); current = empty(); started = false }
      continue
    }
    append(current, ch, isQuoted)
    started = true
  }
  if (started) out.push(current)

  // 내용이 하나도 안 나왔지만 따옴표는 있었다면(`""`), 빈 단어 하나를 남긴다.
  if (out.length === 0 && field.hadQuotes) out.push(empty())
  return out
}

/**
 * 이 필드를 글롭 패턴으로 볼 것인가?
 * 따옴표 보호를 받지 않는 메타문자가 하나라도 있어야 패턴이다.
 *
 * 알려진 한계: 한 단어 안에 따옴표 보호를 받는 메타문자와 받지 않는 메타문자가
 * 섞이면(`"*"*`) 글롭하지 않고 리터럴로 취급한다. 진짜 bash는 글롭한다.
 * 문제 출제에서 이 조합을 쓰지 않는다.
 */
function globPattern(field: Field): string | null {
  let hasUnquotedMeta = false
  for (let i = 0; i < field.text.length; i++) {
    if (!field.quoted[i] && '*?['.includes(field.text[i]!)) hasUnquotedMeta = true
  }
  if (!hasUnquotedMeta) return null

  for (let i = 0; i < field.text.length; i++) {
    if (field.quoted[i] && '*?['.includes(field.text[i]!)) return null
  }
  return field.text
}

export async function expandWord(word: Word, ctx: ExpandCtx): Promise<string[]> {
  const field = empty()

  for (let index = 0; index < word.length; index++) {
    const part = word[index]! as WordPart

    if (part.kind === 'literal') { field.hadQuotes = true; append(field, part.text, true); continue }
    if (part.kind === 'dquote') { field.hadQuotes = true; await expandDollar(part.text, true, field, ctx); continue }

    // raw: 맨 앞 조각의 맨 앞 ~ 만 홈으로 바꾼다.
    let text = part.text
    if (index === 0 && text.startsWith('~') && (text.length === 1 || text[1] === '/')) {
      append(field, ctx.home, true)   // 홈 경로는 다시 분할되면 안 된다
      text = text.slice(1)
    }
    await expandDollar(text, false, field, ctx)
  }

  // 아무 조각도 없으면(있을 수 없지만) 빈 배열
  if (word.length === 0) return []

  const fields = splitFields(field)

  // 따옴표가 전혀 없고 내용도 비었으면 단어가 통째로 사라진다 ($NOPE, $EMPTY)
  if (fields.length === 0) return []

  const results: string[] = []
  for (const f of fields) {
    const pattern = globPattern(f)
    if (pattern === null) { results.push(f.text); continue }
    results.push(...expandGlob(pattern, ctx.cwd, ctx.fs))
  }
  return results
}

export async function expandToSingle(word: Word, ctx: ExpandCtx): Promise<string> {
  const results = await expandWord(word, ctx)
  if (results.length !== 1) throw new Error('ambiguous redirect')
  return results[0]!
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/expand.test.ts`
Expected: PASS — 21 tests.

빨간불이 나면 십중팔구 `splitFields`의 빈 단어 처리다. `""`는 빈 단어를 남기고 `$EMPTY`는 남기지 않는다는 규칙을 다시 읽어라.

- [ ] **Step 5: 커밋**

```bash
git add src/shell/expand.ts src/shell/expand.test.ts
git commit -m "feat(shell): word expansion with quote-aware splitting and globbing"
```

---

## Task 8: 명령 타입, 레지스트리, 빌트인

모든 명령 — 빌트인이든 코어유틸이든 — 은 **하나의 함수 시그니처**를 공유한다. 이 결정이 나머지 전부를 단순하게 만든다. 인터프리터는 `cd`와 `ls`를 구별하지 않는다. 차이는 오직 빌트인이 `state`를 변경할 수 있다는 것뿐이다.

**Files:**
- Create: `src/shell/types.ts`, `src/shell/registry.ts`, `src/shell/builtins/index.ts`, `src/shell/builtins/cd.ts`, `pwd.ts`, `echo.ts`, `export.ts`, `unset.ts`, `truefalse.ts`, `type.ts`
- Test: `src/shell/builtins/builtins.test.ts`, `src/shell/registry.test.ts`

**Interfaces:**
- Consumes: `VFS`, `VfsError` (Task 3)
- Produces:

```ts
// src/shell/types.ts
export interface ExecResult { stdout: string; stderr: string; exitCode: number }

/** 셸의 변경 가능한 상태. 빌트인은 이것을 직접 고친다. */
export interface ShellState {
  cwd: string
  oldPwd: string
  env: Record<string, string>
  lastExitCode: number
  readonly home: string
}

export interface CommandEnv {
  name: string                 // argv[0]
  args: string[]               // argv[1..]
  stdin: string
  fs: VFS
  state: ShellState
}

export type CommandOutput = ExecResult
export type CommandFn = (e: CommandEnv) => CommandOutput | Promise<CommandOutput>

export interface Shell {
  exec(line: string): Promise<ExecResult>
  readonly fs: VFS
  readonly cwd: string
  readonly env: Record<string, string>
}

export const ok = (stdout = ''): CommandOutput => ({ stdout, stderr: '', exitCode: 0 })
export const fail = (stderr: string, exitCode = 1): CommandOutput => ({ stdout: '', stderr, exitCode })
```

```ts
// src/shell/registry.ts
export function lookupCommand(name: string): CommandFn | undefined
export function isKnownUnimplemented(name: string): boolean
/** 자동완성용. 등록된 모든 명령 이름. */
export function commandNames(): string[]
```

- [ ] **Step 1: 실패하는 레지스트리 테스트 작성**

```ts
// src/shell/registry.test.ts
import { describe, it, expect } from 'vitest'
import { lookupCommand, isKnownUnimplemented, commandNames } from './registry'

describe('registry', () => {
  it('빌트인을 찾는다', () => {
    expect(lookupCommand('cd')).toBeTypeOf('function')
    expect(lookupCommand('echo')).toBeTypeOf('function')
  })

  it('없는 명령은 undefined', () => {
    expect(lookupCommand('rsyncc')).toBeUndefined()
  })

  it('진짜 리눅스에 있지만 우리가 안 만든 명령을 구별한다', () => {
    expect(isKnownUnimplemented('sed')).toBe(true)
    expect(isKnownUnimplemented('awk')).toBe(true)
    expect(isKnownUnimplemented('find')).toBe(true)
  })

  it('우리가 만든 명령은 미구현이 아니다', () => {
    expect(isKnownUnimplemented('echo')).toBe(false)
  })

  it('오타는 미구현이 아니라 그냥 없는 명령이다', () => {
    expect(isKnownUnimplemented('sedd')).toBe(false)
  })

  it('commandNames 는 정렬된 이름을 준다', () => {
    const names = commandNames()
    expect(names).toContain('echo')
    expect([...names].sort()).toEqual(names)
  })
})
```

- [ ] **Step 2: 실패하는 빌트인 테스트 작성**

```ts
// src/shell/builtins/builtins.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from '../vfs'
import type { CommandEnv, ShellState } from '../types'
import { builtins } from './index'

let fs: VFS
let state: ShellState

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/home/player/docs', { recursive: true })
  state = { cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' }, lastExitCode: 0, home: '/home/player' }
})

const env = (name: string, args: string[], stdin = ''): CommandEnv => ({ name, args, stdin, fs, state })
const run = (name: string, ...args: string[]) => builtins[name]!(env(name, args))

describe('cd', () => {
  it('상대경로로 이동한다', async () => {
    await run('cd', 'docs')
    expect(state.cwd).toBe('/home/player/docs')
  })
  it('인자가 없으면 홈으로 간다', async () => {
    state.cwd = '/'
    await run('cd')
    expect(state.cwd).toBe('/home/player')
  })
  it('cd - 는 직전 디렉터리로 가고 그 경로를 출력한다', async () => {
    await run('cd', 'docs')
    const out = await run('cd', '-')
    expect(state.cwd).toBe('/home/player')
    expect(out.stdout).toBe('/home/player\n')
  })
  it('없는 디렉터리는 실패한다', async () => {
    const out = await run('cd', 'nope')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('No such file or directory')
    expect(state.cwd).toBe('/home/player')
  })
  it('파일로 cd 하면 Not a directory', async () => {
    fs.writeFile('/home/player/f', '')
    const out = await run('cd', 'f')
    expect(out.stderr).toContain('Not a directory')
  })
})

describe('pwd', () => {
  it('현재 디렉터리를 출력한다', async () => {
    expect((await run('pwd')).stdout).toBe('/home/player\n')
  })
})

describe('echo', () => {
  it('인자를 공백으로 이어 출력하고 개행을 붙인다', async () => {
    expect((await run('echo', 'a', 'b')).stdout).toBe('a b\n')
  })
  it('-n 은 개행을 생략한다', async () => {
    expect((await run('echo', '-n', 'a')).stdout).toBe('a')
  })
  it('-e 는 \\n 을 해석한다', async () => {
    expect((await run('echo', '-e', 'a\\nb')).stdout).toBe('a\nb\n')
  })
  it('-e 없이는 \\n 을 문자 그대로 둔다', async () => {
    expect((await run('echo', 'a\\nb')).stdout).toBe('a\\nb\n')
  })
  it('인자가 없으면 빈 줄', async () => {
    expect((await run('echo')).stdout).toBe('\n')
  })
})

describe('export / unset', () => {
  it('export NAME=value 는 env 에 넣는다', async () => {
    await run('export', 'FOO=bar')
    expect(state.env.FOO).toBe('bar')
  })
  it('unset 은 지운다', async () => {
    state.env.FOO = 'bar'
    await run('unset', 'FOO')
    expect(state.env.FOO).toBeUndefined()
  })
})

describe('true / false / :', () => {
  it('true 는 0', async () => { expect((await run('true')).exitCode).toBe(0) })
  it('false 는 1', async () => { expect((await run('false')).exitCode).toBe(1) })
  it(': 는 0', async () => { expect((await run(':')).exitCode).toBe(0) })
})

describe('type', () => {
  it('빌트인을 빌트인이라 말한다', async () => {
    expect((await run('type', 'cd')).stdout).toBe('cd is a shell builtin\n')
  })
  it('없는 명령은 실패한다', async () => {
    expect((await run('type', 'nope')).exitCode).toBe(1)
  })
})
```

- [ ] **Step 3: 두 테스트 모두 실패하는지 확인**

Run: `npx vitest run --project shell src/shell/registry.test.ts src/shell/builtins/builtins.test.ts`
Expected: FAIL — 모듈 해석 실패.

- [ ] **Step 4: `types.ts` 작성**

```ts
// src/shell/types.ts
import type { VFS } from './vfs'

export interface ExecResult { stdout: string; stderr: string; exitCode: number }

export interface ShellState {
  cwd: string
  oldPwd: string
  env: Record<string, string>
  lastExitCode: number
  readonly home: string
}

export interface CommandEnv {
  name: string
  args: string[]
  stdin: string
  fs: VFS
  state: ShellState
}

export type CommandOutput = ExecResult
export type CommandFn = (e: CommandEnv) => CommandOutput | Promise<CommandOutput>

export interface Shell {
  exec(line: string): Promise<ExecResult>
  readonly fs: VFS
  readonly cwd: string
  readonly env: Record<string, string>
}

export const ok = (stdout = ''): CommandOutput => ({ stdout, stderr: '', exitCode: 0 })
export const fail = (stderr: string, exitCode = 1): CommandOutput => ({ stdout: '', stderr, exitCode })
```

- [ ] **Step 5: 빌트인 구현**

```ts
// src/shell/builtins/cd.ts
import type { CommandFn } from '../types'
import { ok, fail } from '../types'

export const cd: CommandFn = ({ args, fs, state }) => {
  const raw = args[0]
  let target: string

  if (raw === undefined) target = state.home
  else if (raw === '-') target = state.oldPwd
  else target = fs.resolve(raw, state.cwd)

  if (!fs.exists(target)) return fail(`cd: ${raw}: No such file or directory\n`)
  if (!fs.isDir(target)) return fail(`cd: ${raw}: Not a directory\n`)

  state.oldPwd = state.cwd
  state.cwd = target
  state.env.PWD = target
  // `cd -` 만 새 경로를 출력한다. 진짜 bash가 그렇다.
  return ok(raw === '-' ? `${target}\n` : '')
}
```

```ts
// src/shell/builtins/pwd.ts
import type { CommandFn } from '../types'
import { ok } from '../types'

export const pwd: CommandFn = ({ state }) => ok(`${state.cwd}\n`)
```

```ts
// src/shell/builtins/echo.ts
import type { CommandFn } from '../types'
import { ok } from '../types'

function unescape(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
}

export const echo: CommandFn = ({ args }) => {
  let noNewline = false
  let interpret = false
  let i = 0
  while (i < args.length && (args[i] === '-n' || args[i] === '-e')) {
    if (args[i] === '-n') noNewline = true
    if (args[i] === '-e') interpret = true
    i++
  }
  const body = args.slice(i).join(' ')
  const text = interpret ? unescape(body) : body
  return ok(noNewline ? text : `${text}\n`)
}
```

```ts
// src/shell/builtins/export.ts
import type { CommandFn } from '../types'
import { ok } from '../types'

export const exportCmd: CommandFn = ({ args, state }) => {
  for (const arg of args) {
    const eq = arg.indexOf('=')
    if (eq === -1) continue          // `export FOO` — 이미 있는 변수를 내보낼 뿐, 우리에겐 무의미
    state.env[arg.slice(0, eq)] = arg.slice(eq + 1)
  }
  return ok()
}
```

```ts
// src/shell/builtins/unset.ts
import type { CommandFn } from '../types'
import { ok } from '../types'

export const unset: CommandFn = ({ args, state }) => {
  for (const name of args) delete state.env[name]
  return ok()
}
```

```ts
// src/shell/builtins/truefalse.ts
import type { CommandFn } from '../types'
import { ok } from '../types'

export const trueCmd: CommandFn = () => ok()
export const falseCmd: CommandFn = () => ({ stdout: '', stderr: '', exitCode: 1 })
export const colon: CommandFn = () => ok()
```

```ts
// src/shell/builtins/type.ts
import type { CommandFn } from '../types'
import { ok, fail } from '../types'
import { builtins } from './index'
import { coreutils } from '../coreutils/index'

export const typeCmd: CommandFn = ({ args }) => {
  const name = args[0]
  if (!name) return ok()
  if (name in builtins) return ok(`${name} is a shell builtin\n`)
  if (name in coreutils) return ok(`${name} is /usr/bin/${name}\n`)
  return fail(`type: ${name}: not found\n`)
}
```

```ts
// src/shell/builtins/index.ts
import type { CommandFn } from '../types'
import { cd } from './cd'
import { pwd } from './pwd'
import { echo } from './echo'
import { exportCmd } from './export'
import { unset } from './unset'
import { trueCmd, falseCmd, colon } from './truefalse'
import { typeCmd } from './type'

export const builtins: Record<string, CommandFn> = {
  cd, pwd, echo, unset,
  export: exportCmd,
  true: trueCmd,
  false: falseCmd,
  ':': colon,
  type: typeCmd,
}
```

- [ ] **Step 6: 빈 coreutils 등록표를 만들어 `type.ts` 의 import를 만족시킨다**

Task 9~11에서 채운다. 지금은 빈 객체다.

```ts
// src/shell/coreutils/index.ts
import type { CommandFn } from '../types'

export const coreutils: Record<string, CommandFn> = {}
```

- [ ] **Step 7: `registry.ts` 작성**

```ts
// src/shell/registry.ts
import type { CommandFn } from './types'
import { builtins } from './builtins/index'
import { coreutils } from './coreutils/index'

/**
 * 진짜 리눅스에는 있지만 FlashShell이 구현하지 않은 명령들.
 * 이 목록에 있으면 `command not found`가 아니라 "이 환경에는 없다"고 정직하게 말한다.
 * 사용자가 자기 오타를 의심하며 시간을 낭비하지 않게 하려는 것이다.
 */
const KNOWN_UNIMPLEMENTED = new Set([
  'sed', 'awk', 'find', 'xargs', 'cut', 'tr', 'uniq', 'diff', 'comm', 'tee',
  'nl', 'rev', 'basename', 'dirname', 'realpath', 'seq', 'du', 'df',
  'ps', 'kill', 'top', 'chown', 'chgrp', 'tar', 'gzip', 'zip', 'unzip',
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'git', 'make', 'gcc',
  'vim', 'vi', 'nano', 'emacs', 'less', 'more', 'man',
  'python', 'python3', 'node', 'perl', 'ruby',
  'sudo', 'su', 'mount', 'umount', 'systemctl', 'service',
])

export function lookupCommand(name: string): CommandFn | undefined {
  return builtins[name] ?? coreutils[name]
}

export function isKnownUnimplemented(name: string): boolean {
  if (lookupCommand(name)) return false
  return KNOWN_UNIMPLEMENTED.has(name)
}

export function commandNames(): string[] {
  return [...Object.keys(builtins), ...Object.keys(coreutils)].sort()
}
```

- [ ] **Step 8: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/registry.test.ts src/shell/builtins/builtins.test.ts`
Expected: PASS — 6 + 17 = 23 tests.

- [ ] **Step 9: 커밋**

```bash
git add src/shell/types.ts src/shell/registry.ts src/shell/registry.test.ts src/shell/builtins src/shell/coreutils
git commit -m "feat(shell): command registry, builtins, and honest unimplemented-command errors"
```

---

## Task 9: 인터프리터와 `createShell`

**Files:**
- Create: `src/shell/interpreter.ts`, `src/shell/index.ts`
- Test: `src/shell/interpreter.test.ts`

**Interfaces:**
- Consumes: `parse` (Task 5), `expandWord`/`expandToSingle` (Task 7), `lookupCommand`/`isKnownUnimplemented` (Task 8), `VFS` (Task 3)
- Produces:

```ts
// src/shell/index.ts
export interface CreateShellOptions {
  fs?: VFS
  cwd?: string
  home?: string
  env?: Record<string, string>
  /** 한 번의 exec 안에서 실행 가능한 최대 명령 수. 무한루프 방어. 기본 100000. */
  stepBudget?: number
}
export function createShell(opts?: CreateShellOptions): Shell

export { VFS } from './vfs'
export { VfsError, ExecutionLimitError } from './errors'
export type { Shell, ExecResult, CommandEnv, CommandOutput, CommandFn, ShellState } from './types'
export { commandNames } from './registry'
```

의미론 규칙 세 가지를 못박는다.

1. **파이프라인의 exit code는 마지막 명령의 것이다.** 앞 단계가 실패해도 뒤가 성공하면 0이다.
2. **`>` 리다이렉션은 명령 실행 전에 파일을 비운다.** `cat f > f`가 f를 날려버리는 이유이며, 좋은 문제 소재다.
3. **stderr는 파이프를 타지 않는다.** `2>`로 잡지 않으면 그대로 터미널로 나간다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/interpreter.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createShell } from './index'
import { VFS } from './vfs'
import type { Shell } from './types'

let fs: VFS
let sh: Shell

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/home/player', { recursive: true })
  fs.writeFile('/home/player/a.txt', 'alpha\n')
  fs.writeFile('/home/player/b.txt', 'beta\n')
  sh = createShell({ fs, cwd: '/home/player', home: '/home/player' })
})

describe('기본 실행', () => {
  it('명령을 실행하고 stdout 을 준다', async () => {
    expect(await sh.exec('echo hi')).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 })
  })

  it('빈 줄은 exit code 0 이고 아무 출력이 없다', async () => {
    expect(await sh.exec('')).toEqual({ stdout: '', stderr: '', exitCode: 0 })
    expect(await sh.exec('   ')).toEqual({ stdout: '', stderr: '', exitCode: 0 })
  })

  it('없는 명령은 command not found 이고 exit 127', async () => {
    const r = await sh.exec('nosuchthing')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toBe('bash: nosuchthing: command not found\n')
  })

  it('미구현 명령은 다른 메시지를 준다', async () => {
    const r = await sh.exec('sed s/a/b/')
    expect(r.exitCode).toBe(127)
    expect(r.stderr).toBe('flashshell: sed: 이 환경에는 없는 명령입니다\n')
  })

  it('문법 오류는 exit 2', async () => {
    const r = await sh.exec('echo >')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toMatch(/syntax error/)
  })
})

describe('상태 유지', () => {
  it('cd 가 셸의 cwd 를 바꾸고 다음 명령에 이어진다', async () => {
    fs.mkdir('/home/player/docs')
    await sh.exec('cd docs')
    expect(sh.cwd).toBe('/home/player/docs')
    expect((await sh.exec('pwd')).stdout).toBe('/home/player/docs\n')
  })

  it('변수 대입이 다음 명령에 이어진다', async () => {
    await sh.exec('X=hello')
    expect((await sh.exec('echo $X')).stdout).toBe('hello\n')
  })

  it('명령 앞의 대입은 그 명령에만 적용되고 사라진다', async () => {
    await sh.exec('FOO=bar echo $FOO')   // 확장이 먼저 일어나므로 빈 줄이 나온다
    expect(sh.env.FOO).toBeUndefined()
  })

  it('$? 가 직전 exit code 를 반영한다', async () => {
    await sh.exec('false')
    expect((await sh.exec('echo $?')).stdout).toBe('1\n')
  })
})

describe('리다이렉션', () => {
  it('> 로 파일에 쓴다', async () => {
    await sh.exec('echo hi > out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('hi\n')
  })

  it('> 는 기존 내용을 덮어쓴다', async () => {
    await sh.exec('echo one > out.txt')
    await sh.exec('echo two > out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('two\n')
  })

  it('>> 는 이어붙인다', async () => {
    await sh.exec('echo one > out.txt')
    await sh.exec('echo two >> out.txt')
    expect(fs.readFile('/home/player/out.txt')).toBe('one\ntwo\n')
  })

  it('< 로 stdin 을 읽는다', async () => {
    expect((await sh.exec('cat < a.txt')).stdout).toBe('alpha\n')
  })

  it('2> 는 stderr 만 잡고 stdout 은 통과시킨다', async () => {
    const r = await sh.exec('cat a.txt nope.txt 2> err.txt')
    expect(r.stdout).toBe('alpha\n')
    expect(r.stderr).toBe('')
    expect(fs.readFile('/home/player/err.txt')).toContain('No such file or directory')
  })

  it('리다이렉션 대상이 여러 개로 확장되면 ambiguous redirect', async () => {
    const r = await sh.exec('echo hi > *.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toMatch(/ambiguous redirect/)
  })

  it('> 는 명령 실행 전에 파일을 비운다', async () => {
    await sh.exec('cat a.txt > a.txt')
    expect(fs.readFile('/home/player/a.txt')).toBe('')
  })
})

describe('파이프라인', () => {
  it('stdout 을 다음 명령의 stdin 으로 넘긴다', async () => {
    expect((await sh.exec('echo hi | cat')).stdout).toBe('hi\n')
  })

  it('세 단계도 흐른다', async () => {
    expect((await sh.exec('echo hi | cat | cat')).stdout).toBe('hi\n')
  })

  it('exit code 는 마지막 명령의 것이다', async () => {
    expect((await sh.exec('false | true')).exitCode).toBe(0)
    expect((await sh.exec('true | false')).exitCode).toBe(1)
  })

  it('중간 단계의 stderr 는 파이프를 타지 않고 밖으로 나온다', async () => {
    const r = await sh.exec('cat nope.txt | cat')
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('No such file or directory')
  })
})

describe('연결자', () => {
  it('&& 는 앞이 성공해야 뒤를 실행한다', async () => {
    expect((await sh.exec('true && echo yes')).stdout).toBe('yes\n')
    expect((await sh.exec('false && echo yes')).stdout).toBe('')
  })

  it('|| 는 앞이 실패해야 뒤를 실행한다', async () => {
    expect((await sh.exec('false || echo yes')).stdout).toBe('yes\n')
    expect((await sh.exec('true || echo yes')).stdout).toBe('')
  })

  it('; 는 무조건 실행한다', async () => {
    expect((await sh.exec('false ; echo yes')).stdout).toBe('yes\n')
  })

  it('출력이 순서대로 이어붙는다', async () => {
    expect((await sh.exec('echo a ; echo b')).stdout).toBe('a\nb\n')
  })
})

describe('확장 통합', () => {
  it('글롭이 인자로 펼쳐진다', async () => {
    expect((await sh.exec('echo *.txt')).stdout).toBe('a.txt b.txt\n')
  })

  it('명령치환이 동작한다', async () => {
    expect((await sh.exec('echo $(echo nested)')).stdout).toBe('nested\n')
  })

  it('명령치환 안의 파이프도 동작한다', async () => {
    expect((await sh.exec('echo $(echo hi | cat)')).stdout).toBe('hi\n')
  })
})

describe('무한루프 방어', () => {
  it('스텝 예산을 넘기면 중단하고 앰버 메시지를 준다', async () => {
    const tiny = createShell({ fs, cwd: '/home/player', home: '/home/player', stepBudget: 3 })
    const r = await tiny.exec('echo 1 ; echo 2 ; echo 3 ; echo 4 ; echo 5')
    expect(r.exitCode).toBe(130)
    expect(r.stderr).toContain('실행 한도 초과')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/interpreter.test.ts`
Expected: FAIL — "Failed to resolve import ./index"

- [ ] **Step 3: `interpreter.ts` 구현**

```ts
// src/shell/interpreter.ts
import { VFS } from './vfs'
import { ExecutionLimitError, errnoText } from './errors'
import { parse, type CommandNode, type ListNode, type PipelineNode } from './parser'
import { expandWord, expandToSingle, type ExpandCtx } from './expand'
import { lookupCommand, isKnownUnimplemented } from './registry'
import type { CommandEnv, ExecResult, ShellState } from './types'

/** 한 번의 exec 동안만 사는 실행 컨텍스트. */
interface RunCtx {
  fs: VFS
  state: ShellState
  budget: { remaining: number }
}

function spend(ctx: RunCtx): void {
  if (--ctx.budget.remaining < 0) throw new ExecutionLimitError()
}

function expandCtxFor(ctx: RunCtx): ExpandCtx {
  return {
    env: ctx.state.env,
    cwd: ctx.state.cwd,
    home: ctx.state.home,
    fs: ctx.fs,
    lastExitCode: ctx.state.lastExitCode,
    // 서브셸은 같은 VFS와 예산을 공유하되, cwd/env 변경은 밖으로 새지 않는다.
    runSubshell: async (script) => {
      const child: RunCtx = {
        fs: ctx.fs,
        state: { ...ctx.state, env: { ...ctx.state.env } },
        budget: ctx.budget,
      }
      // 서브셸 안의 문법 오류가 exec 전체를 리젝트시켜서는 안 된다.
      // 다만 실행 한도 초과는 바깥까지 전파되어야 한다.
      try {
        return await runList(parse(script), child)
      } catch (e) {
        if (e instanceof ExecutionLimitError) throw e
        return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
      }
    },
  }
}

async function runCommand(node: CommandNode, ctx: RunCtx, stdin: string): Promise<ExecResult> {
  spend(ctx)
  const expandCtx = expandCtxFor(ctx)

  // 1. 단어를 확장한다.
  const argv: string[] = []
  for (const word of node.words) argv.push(...(await expandWord(word, expandCtx)))

  // 2. 명령 없는 순수 대입: 셸 상태를 영구히 바꾼다.
  if (argv.length === 0) {
    for (const assignment of node.assignments) {
      ctx.state.env[assignment.name] = (await expandWord(assignment.value, expandCtx)).join(' ')
    }
    return { stdout: '', stderr: '', exitCode: 0 }
  }

  // 3. 명령 앞의 대입은 이 명령의 환경에만 적용되고 사라진다.
  const commandEnv = { ...ctx.state.env }
  for (const assignment of node.assignments) {
    commandEnv[assignment.name] = (await expandWord(assignment.value, expandCtx)).join(' ')
  }

  // 4. 리다이렉션 대상을 확장한다. 여러 개로 펼쳐지면 ambiguous.
  const redirs: { fd: 0 | 1 | 2; op: '>' | '>>' | '<'; path: string }[] = []
  for (const redir of node.redirs) {
    let path: string
    try {
      path = await expandToSingle(redir.target, expandCtx)
    } catch {
      return { stdout: '', stderr: `bash: ambiguous redirect\n`, exitCode: 1 }
    }
    redirs.push({ fd: redir.fd, op: redir.op, path: ctx.fs.resolve(path, ctx.state.cwd) })
  }

  // 5. 입력 리다이렉션은 stdin 을 대체한다.
  let input = stdin
  for (const redir of redirs) {
    if (redir.fd !== 0) continue
    try {
      input = ctx.fs.readFile(redir.path)
    } catch (e) {
      return { stdout: '', stderr: `bash: ${redir.path}: ${errnoText(e)}\n`, exitCode: 1 }
    }
  }

  // 6. 출력 리다이렉션은 명령 실행 **전에** 파일을 비운다. `cat f > f` 가 f를 날리는 이유.
  for (const redir of redirs) {
    if (redir.op !== '>') continue
    try {
      ctx.fs.writeFile(redir.path, '')
    } catch (e) {
      return { stdout: '', stderr: `bash: ${redir.path}: ${errnoText(e)}\n`, exitCode: 1 }
    }
  }

  // 7. 명령을 찾는다.
  const name = argv[0]!
  const fn = lookupCommand(name)
  if (!fn) {
    const message = isKnownUnimplemented(name)
      ? `flashshell: ${name}: 이 환경에는 없는 명령입니다\n`
      : `bash: ${name}: command not found\n`
    return { stdout: '', stderr: message, exitCode: 127 }
  }

  // 8. 실행한다. 빌트인은 state 를 직접 고친다.
  const cmdEnv: CommandEnv = {
    name,
    args: argv.slice(1),
    stdin: input,
    fs: ctx.fs,
    state: { ...ctx.state, env: commandEnv } as ShellState,
  }
  let result: ExecResult
  try {
    result = await fn(cmdEnv)
  } catch (e) {
    if (e instanceof ExecutionLimitError) throw e
    return { stdout: '', stderr: `${name}: ${errnoText(e)}\n`, exitCode: 1 }
  }

  // 빌트인이 바꾼 cwd/oldPwd 를 진짜 상태로 되돌려 받는다.
  ctx.state.cwd = cmdEnv.state.cwd
  ctx.state.oldPwd = cmdEnv.state.oldPwd
  // 명령 앞 대입으로 오염된 env 는 버리고, 빌트인이 새로 넣은 키만 반영한다.
  for (const [key, value] of Object.entries(cmdEnv.state.env)) {
    const wasTemporary = node.assignments.some((a) => a.name === key)
    if (!wasTemporary) ctx.state.env[key] = value
  }
  for (const key of Object.keys(ctx.state.env)) {
    if (!(key in cmdEnv.state.env)) delete ctx.state.env[key]
  }

  // 9. 출력 리다이렉션을 적용한다.
  let stdout = result.stdout
  let stderr = result.stderr
  for (const redir of redirs) {
    if (redir.fd === 0) continue
    const text = redir.fd === 1 ? stdout : stderr
    try {
      if (redir.op === '>') ctx.fs.writeFile(redir.path, text)
      else ctx.fs.appendFile(redir.path, text)
    } catch (e) {
      return { stdout: '', stderr: `bash: ${redir.path}: ${errnoText(e)}\n`, exitCode: 1 }
    }
    if (redir.fd === 1) stdout = ''
    else stderr = ''
  }

  return { stdout, stderr, exitCode: result.exitCode }
}

async function runPipeline(node: PipelineNode, ctx: RunCtx): Promise<ExecResult> {
  let stdin = ''
  let stderr = ''
  let last: ExecResult = { stdout: '', stderr: '', exitCode: 0 }

  for (const command of node.commands) {
    last = await runCommand(command, ctx, stdin)
    // stderr 는 파이프를 타지 않는다. 모아서 한꺼번에 밖으로 낸다.
    stderr += last.stderr
    stdin = last.stdout
  }

  return { stdout: last.stdout, stderr, exitCode: last.exitCode }
}

async function runList(node: ListNode, ctx: RunCtx): Promise<ExecResult> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const item of node.items) {
    if (item.op === '&&' && exitCode !== 0) continue
    if (item.op === '||' && exitCode === 0) continue

    const result = await runPipeline(item.pipeline, ctx)
    stdout += result.stdout
    stderr += result.stderr
    exitCode = result.exitCode
    ctx.state.lastExitCode = exitCode
  }

  return { stdout, stderr, exitCode }
}

export async function run(line: string, fs: VFS, state: ShellState, stepBudget: number): Promise<ExecResult> {
  const ctx: RunCtx = { fs, state, budget: { remaining: stepBudget } }
  let ast: ListNode
  try {
    ast = parse(line)
  } catch (e) {
    return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
  }
  if (ast.items.length === 0) return { stdout: '', stderr: '', exitCode: 0 }

  try {
    return await runList(ast, ctx)
  } catch (e) {
    if (e instanceof ExecutionLimitError) {
      return { stdout: '', stderr: '^C  flashshell: 실행 한도 초과 — 무한 루프인가요?\n', exitCode: 130 }
    }
    throw e
  }
}
```

`&&` / `||` 의 단축 평가에서 미묘한 함정이 하나 있다. 건너뛴 항목은 `exitCode`를 갱신하지 않으므로, `false && echo a || echo b`에서 `|| `는 여전히 `false`의 exit code 1을 보고 `echo b`를 실행한다. 이것이 bash의 실제 동작이다. 위 구현은 `exitCode` 변수를 건너뛴 항목에서 손대지 않음으로써 이를 자연히 얻는다.

- [ ] **Step 4: `index.ts` 작성**

```ts
// src/shell/index.ts
import { VFS } from './vfs'
import { run } from './interpreter'
import type { ExecResult, Shell, ShellState } from './types'

export interface CreateShellOptions {
  fs?: VFS
  cwd?: string
  home?: string
  env?: Record<string, string>
  stepBudget?: number
}

export function createShell(opts: CreateShellOptions = {}): Shell {
  const fs = opts.fs ?? new VFS()
  const home = opts.home ?? '/home/player'
  const cwd = opts.cwd ?? home
  const stepBudget = opts.stepBudget ?? 100_000

  const state: ShellState = {
    cwd,
    oldPwd: cwd,
    env: { HOME: home, PWD: cwd, USER: 'player', SHELL: '/bin/bash', ...opts.env },
    lastExitCode: 0,
    home,
  }

  return {
    exec: (line: string): Promise<ExecResult> => run(line, fs, state, stepBudget),
    fs,
    get cwd() { return state.cwd },
    get env() { return state.env },
  }
}

export { VFS } from './vfs'
export { VfsError, ExecutionLimitError } from './errors'
export { commandNames } from './registry'
export type { Shell, ExecResult, CommandEnv, CommandOutput, CommandFn, ShellState } from './types'
```

- [ ] **Step 5: `cat` 하나만 임시로 만들어 테스트를 통과시킨다**

인터프리터 테스트는 `cat`을 쓴다. Task 10에서 제대로 만들 것이므로, 지금은 최소 구현을 넣는다.

```ts
// src/shell/coreutils/cat.ts
import type { CommandFn } from '../types'
import { VfsError } from '../errors'

export const cat: CommandFn = ({ args, stdin, fs, state }) => {
  if (args.length === 0) return { stdout: stdin, stderr: '', exitCode: 0 }
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  for (const arg of args) {
    try {
      stdout += fs.readFile(fs.resolve(arg, state.cwd))
    } catch (e) {
      const reason = e instanceof VfsError && e.code === 'EISDIR' ? 'Is a directory' : 'No such file or directory'
      stderr += `cat: ${arg}: ${reason}\n`
      exitCode = 1
    }
  }
  return { stdout, stderr, exitCode }
}
```

```ts
// src/shell/coreutils/index.ts
import type { CommandFn } from '../types'
import { cat } from './cat'

export const coreutils: Record<string, CommandFn> = { cat }
```

- [ ] **Step 6: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/interpreter.test.ts`
Expected: PASS — 25 tests.

- [ ] **Step 7: 전체 셸 테스트 실행**

Run: `npx vitest run --project shell`
Expected: PASS — 모든 셸 테스트.

- [ ] **Step 8: 커밋**

```bash
git add src/shell/interpreter.ts src/shell/index.ts src/shell/interpreter.test.ts src/shell/coreutils
git commit -m "feat(shell): interpreter with pipelines, redirections, and step budget"
```

---

## Task 10: 코어유틸 — 조회와 텍스트 (`ls` `cat` `head` `tail` `wc` `stat` `grep` `sort`)

**Files:**
- Create: `src/shell/coreutils/ls.ts`, `head.ts`, `tail.ts`, `wc.ts`, `stat.ts`, `grep.ts`, `sort.ts`
- Modify: `src/shell/coreutils/cat.ts` (플래그 추가), `src/shell/coreutils/index.ts`
- Test: `src/shell/coreutils/query.test.ts`

**Interfaces:**
- Consumes: `CommandFn`, `ok`, `fail` (Task 8), `VFS`, `VfsError` (Task 3)
- Produces: `coreutils` 등록표에 8개 키가 추가된다. 각 값은 `CommandFn`.

**의도적인 bash 이탈 두 가지.** 문서화하고 골든 테스트에서 제외한다.

1. `ls`는 항상 한 줄에 하나씩 출력한다. 진짜 bash는 tty에 붙어있을 때만 여러 열로 그린다. 우리 터미널은 tty가 아니므로 파이프에 붙었을 때의 동작(한 줄에 하나)을 항상 쓴다. 골든 테스트 케이스는 `ls -1`을 쓴다.
2. `ls -l`은 날짜를 출력하지 않는다. 논리 시계를 쓰므로 실제 시각이 없다. 골든 테스트에서 `-l`을 쓰지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/coreutils/query.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createShell, VFS } from '../index'
import type { Shell } from '../types'

let fs: VFS
let sh: Shell

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/w/sub', { recursive: true })
  fs.writeFile('/w/a.txt', 'one\ntwo\nthree\n')
  fs.writeFile('/w/b.txt', 'BETA\nbeta\n')
  fs.writeFile('/w/.hidden', 'x')
  fs.writeFile('/w/nums', '10\n9\n100\n')
  fs.chmod('/w/a.txt', 0o644)
  sh = createShell({ fs, cwd: '/w', home: '/w' })
})

const out = async (line: string) => (await sh.exec(line)).stdout

describe('ls', () => {
  it('한 줄에 하나씩, 정렬해서 낸다', async () => {
    expect(await out('ls')).toBe('a.txt\nb.txt\nnums\nsub\n')
  })
  it('숨김파일을 숨긴다', async () => {
    expect(await out('ls')).not.toContain('.hidden')
  })
  it('-a 는 숨김파일과 . .. 를 보여준다', async () => {
    expect(await out('ls -a')).toBe('.\n..\n.hidden\na.txt\nb.txt\nnums\nsub\n')
  })
  it('디렉터리를 인자로 주면 그 안을 본다', async () => {
    expect(await out('ls sub')).toBe('')
  })
  it('파일을 인자로 주면 그 이름을 낸다', async () => {
    expect(await out('ls a.txt')).toBe('a.txt\n')
  })
  it('-l 은 모드와 크기를 낸다', async () => {
    expect(await out('ls -l a.txt')).toBe('-rw-r--r-- 1 player player 14 a.txt\n')
  })
  it('-l 은 디렉터리를 d 로 표시한다', async () => {
    expect(await out('ls -l sub')).toContain('drwxr-xr-x')
  })
  it('없는 경로는 stderr 와 exit 2', async () => {
    const r = await sh.exec('ls nope')
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toBe("ls: cannot access 'nope': No such file or directory\n")
  })
})

describe('cat', () => {
  it('파일 내용을 낸다', async () => {
    expect(await out('cat a.txt')).toBe('one\ntwo\nthree\n')
  })
  it('여러 파일을 이어붙인다', async () => {
    expect(await out('cat a.txt b.txt')).toBe('one\ntwo\nthree\nBETA\nbeta\n')
  })
  it('인자가 없으면 stdin 을 낸다', async () => {
    expect(await out('echo hi | cat')).toBe('hi\n')
  })
  it('-n 은 줄번호를 붙인다', async () => {
    expect(await out('cat -n b.txt')).toBe('     1\tBETA\n     2\tbeta\n')
  })
  it('없는 파일은 계속 진행하되 exit 1', async () => {
    const r = await sh.exec('cat nope a.txt')
    expect(r.stdout).toBe('one\ntwo\nthree\n')
    expect(r.exitCode).toBe(1)
  })
})

describe('head / tail', () => {
  it('head 는 기본 10줄', async () => {
    expect(await out('head a.txt')).toBe('one\ntwo\nthree\n')
  })
  it('head -n 2', async () => {
    expect(await out('head -n 2 a.txt')).toBe('one\ntwo\n')
  })
  it('head -2 축약형', async () => {
    expect(await out('head -2 a.txt')).toBe('one\ntwo\n')
  })
  it('tail -n 1', async () => {
    expect(await out('tail -n 1 a.txt')).toBe('three\n')
  })
  it('stdin 에서도 동작한다', async () => {
    expect(await out('cat a.txt | head -n 1')).toBe('one\n')
  })
})

describe('wc', () => {
  it('기본은 줄 단어 바이트', async () => {
    expect(await out('wc a.txt')).toBe('       3       3      14 a.txt\n')
  })
  it('-l 은 줄 수만', async () => {
    expect(await out('wc -l a.txt')).toBe('       3 a.txt\n')
  })
  it('stdin 이면 파일명이 없다', async () => {
    expect(await out('cat a.txt | wc -l')).toBe('       3\n')
  })
  it('여러 파일이면 total 을 더한다', async () => {
    expect(await out('wc -l a.txt b.txt')).toBe('       3 a.txt\n       2 b.txt\n       5 total\n')
  })
})

describe('stat', () => {
  it('크기와 8진 모드를 낸다', async () => {
    expect(await out('stat -c %s a.txt')).toBe('14\n')
    expect(await out('stat -c %a a.txt')).toBe('644\n')
  })
})

describe('grep', () => {
  it('매칭되는 줄만 낸다', async () => {
    expect(await out('grep t a.txt')).toBe('two\nthree\n')
  })
  it('-i 는 대소문자를 무시한다', async () => {
    expect(await out('grep -i beta b.txt')).toBe('BETA\nbeta\n')
  })
  it('-v 는 반전한다', async () => {
    expect(await out('grep -v t a.txt')).toBe('one\n')
  })
  it('-c 는 개수만 낸다', async () => {
    expect(await out('grep -c t a.txt')).toBe('2\n')
  })
  it('-n 은 줄번호를 붙인다', async () => {
    expect(await out('grep -n two a.txt')).toBe('2:two\n')
  })
  it('여러 파일이면 파일명을 접두사로 붙인다', async () => {
    expect(await out('grep beta a.txt b.txt')).toBe('b.txt:beta\n')
  })
  it('매칭이 없으면 exit 1', async () => {
    expect((await sh.exec('grep zzz a.txt')).exitCode).toBe(1)
  })
  it('stdin 에서 동작한다', async () => {
    expect(await out('cat a.txt | grep one')).toBe('one\n')
  })
})

describe('sort', () => {
  it('사전순으로 정렬한다', async () => {
    expect(await out('sort nums')).toBe('10\n100\n9\n')
  })
  it('-n 은 수치순', async () => {
    expect(await out('sort -n nums')).toBe('9\n10\n100\n')
  })
  it('-r 은 역순', async () => {
    expect(await out('sort -nr nums')).toBe('100\n10\n9\n')
  })
  it('-u 는 중복을 없앤다', async () => {
    expect(await out('cat nums nums | sort -u -n')).toBe('9\n10\n100\n')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/coreutils/query.test.ts`
Expected: FAIL — `ls: command not found`

- [ ] **Step 3: 공용 헬퍼를 만든다**

거의 모든 코어유틸이 "인자가 있으면 파일들을, 없으면 stdin을 읽는다"는 같은 패턴을 쓴다. 한 번만 쓴다.

```ts
// src/shell/coreutils/shared.ts
import type { CommandEnv } from '../types'
import { errnoText } from '../errors'

export interface Source { label: string; text: string }

/** 파일 인자를 읽는다. 없으면 stdin 을 유일한 소스로 삼는다(label 은 빈 문자열). */
export function readSources(e: CommandEnv, files: string[]): { sources: Source[]; stderr: string; failed: boolean } {
  if (files.length === 0) return { sources: [{ label: '', text: e.stdin }], stderr: '', failed: false }

  const sources: Source[] = []
  let stderr = ''
  let failed = false
  for (const file of files) {
    try {
      sources.push({ label: file, text: e.fs.readFile(e.fs.resolve(file, e.state.cwd)) })
    } catch (err) {
      stderr += `${e.name}: ${file}: ${errnoText(err)}\n`
      failed = true
    }
  }
  return { sources, stderr, failed }
}

export { errnoText } from '../errors'

/** 후행 개행을 무시하고 줄로 쪼갠다. 빈 텍스트는 빈 배열. */
export function toLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\n$/, '').split('\n')
}

/** `head -2` 같은 숫자 축약형을 `head -n 2` 로 옮긴다. head 와 tail 이 함께 쓴다. */
export function normalizeCountFlag(args: string[]): string[] {
  return args.map((arg) => (/^-\d+$/.test(arg) ? `-n${arg.slice(1)}` : arg))
}

/** 플래그와 위치인자를 가른다. `-abc` 는 `-a -b -c` 로 펼친다. */
export function parseFlags(args: string[], takesValue: string[] = []): { flags: Map<string, string>; rest: string[] } {
  const flags = new Map<string, string>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') { rest.push(...args.slice(i + 1)); break }
    if (!arg.startsWith('-') || arg === '-') { rest.push(arg); continue }
    for (let j = 1; j < arg.length; j++) {
      const letter = arg[j]!
      if (takesValue.includes(letter)) {
        const inline = arg.slice(j + 1)
        flags.set(letter, inline !== '' ? inline : (args[++i] ?? ''))
        break
      }
      flags.set(letter, '')
    }
  }
  return { flags, rest }
}
```

- [ ] **Step 4: `ls.ts` 구현**

```ts
// src/shell/coreutils/ls.ts
import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

function modeString(kind: 'file' | 'dir' | 'symlink', mode: number): string {
  const type = kind === 'dir' ? 'd' : kind === 'symlink' ? 'l' : '-'
  const bits = ['r', 'w', 'x']
  let out = ''
  for (let shift = 6; shift >= 0; shift -= 3) {
    const group = (mode >> shift) & 0o7
    for (let bit = 0; bit < 3; bit++) out += group & (4 >> bit) ? bits[bit]! : '-'
  }
  return type + out
}

export const ls: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const showAll = flags.has('a')
  const long = flags.has('l')
  const targets = rest.length > 0 ? rest : ['.']

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  const render = (name: string, abs: string): string => {
    if (!long) return `${name}\n`
    const node = fs.lstat(abs)!
    const size = node.kind === 'dir' ? 0 : node.content.length
    return `${modeString(node.kind, node.mode)} 1 player player ${size} ${name}\n`
  }

  for (const target of targets) {
    const abs = fs.resolve(target, state.cwd)
    if (!fs.exists(abs)) {
      stderr += `ls: cannot access '${target}': No such file or directory\n`
      exitCode = 2
      continue
    }
    if (!fs.isDir(abs)) { stdout += render(target, abs); continue }

    let names: string[]
    try { names = fs.readdir(abs) } catch (e) { stderr += `ls: ${target}: ${errnoText(e)}\n`; exitCode = 2; continue }

    const visible = showAll ? ['.', '..', ...names] : names.filter((n) => !n.startsWith('.'))
    for (const name of visible) {
      const childAbs = name === '.' ? abs : name === '..' ? fs.resolve('..', abs) : `${abs === '/' ? '' : abs}/${name}`
      stdout += render(name, childAbs)
    }
  }

  return { stdout, stderr, exitCode }
}
```

- [ ] **Step 5: `cat.ts` 를 `-n` 지원하도록 고친다**

```ts
// src/shell/coreutils/cat.ts
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

export const cat: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const { sources, stderr, failed } = readSources(e, rest)

  let stdout = ''
  if (flags.has('n')) {
    let lineNumber = 1
    for (const source of sources) {
      for (const line of toLines(source.text)) {
        stdout += `${String(lineNumber++).padStart(6)}\t${line}\n`
      }
    }
  } else {
    for (const source of sources) stdout += source.text
  }

  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
```

- [ ] **Step 6: `head.ts` 와 `tail.ts` 구현**

```ts
// src/shell/coreutils/head.ts
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines, normalizeCountFlag } from './shared'

export const head: CommandFn = (e) => {
  const { flags, rest } = parseFlags(normalizeCountFlag(e.args), ['n'])
  const count = Number(flags.get('n') ?? 10)
  const { sources, stderr, failed } = readSources(e, rest)
  let stdout = ''
  for (const source of sources) {
    for (const line of toLines(source.text).slice(0, count)) stdout += `${line}\n`
  }
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
```

```ts
// src/shell/coreutils/tail.ts
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines, normalizeCountFlag } from './shared'

export const tail: CommandFn = (e) => {
  const { flags, rest } = parseFlags(normalizeCountFlag(e.args), ['n'])
  const count = Number(flags.get('n') ?? 10)
  const { sources, stderr, failed } = readSources(e, rest)
  let stdout = ''
  for (const source of sources) {
    const lines = toLines(source.text)
    for (const line of lines.slice(Math.max(0, lines.length - count))) stdout += `${line}\n`
  }
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
```

- [ ] **Step 7: `wc.ts` 구현**

```ts
// src/shell/coreutils/wc.ts
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

const pad = (n: number) => String(n).padStart(8)

export const wc: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const { sources, stderr, failed } = readSources(e, rest)

  // 플래그가 하나도 없으면 -l -w -c 전부.
  const wantLines = flags.has('l') || flags.size === 0
  const wantWords = flags.has('w') || flags.size === 0
  const wantBytes = flags.has('c') || flags.size === 0

  const format = (lines: number, words: number, bytes: number, label: string): string => {
    let row = ''
    if (wantLines) row += pad(lines)
    if (wantWords) row += pad(words)
    if (wantBytes) row += pad(bytes)
    return `${row}${label ? ` ${label}` : ''}\n`
  }

  let stdout = ''
  let totalLines = 0
  let totalWords = 0
  let totalBytes = 0

  for (const source of sources) {
    const lines = toLines(source.text).length
    const words = source.text.split(/\s+/).filter((w) => w !== '').length
    const bytes = source.text.length
    totalLines += lines; totalWords += words; totalBytes += bytes
    stdout += format(lines, words, bytes, source.label)
  }

  if (sources.length > 1) stdout += format(totalLines, totalWords, totalBytes, 'total')
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
```

- [ ] **Step 8: `stat.ts` 구현**

```ts
// src/shell/coreutils/stat.ts
import type { CommandFn } from '../types'
import { parseFlags } from './shared'

export const stat: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args, ['c'])
  const format = flags.get('c') ?? '%n %s %a'

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const target of rest) {
    const abs = fs.resolve(target, state.cwd)
    const node = fs.lstat(abs)
    if (!node) {
      stderr += `stat: cannot statx '${target}': No such file or directory\n`
      exitCode = 1
      continue
    }
    const size = node.kind === 'dir' ? 0 : node.content.length
    stdout += format
      .replace(/%n/g, target)
      .replace(/%s/g, String(size))
      .replace(/%a/g, node.mode.toString(8))
      .replace(/%F/g, node.kind === 'dir' ? 'directory' : node.kind === 'symlink' ? 'symbolic link' : 'regular file')
      + '\n'
  }
  return { stdout, stderr, exitCode }
}
```

- [ ] **Step 9: `grep.ts` 구현**

패턴은 JavaScript `RegExp`로 직행한다. bash의 BRE(기본 정규식)와는 미묘하게 다르다 — BRE에서 `+`는 문자 그대로지만 우리에겐 수량자다. **골든 테스트에서 `grep`은 문자열 리터럴 패턴이나 ERE 문법(`grep -E`와 동일)만 쓴다.** 이 한계는 문제 출제 시 지킨다.

```ts
// src/shell/coreutils/grep.ts
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

export const grep: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const pattern = rest[0]
  if (pattern === undefined) return { stdout: '', stderr: 'usage: grep PATTERN [FILE...]\n', exitCode: 2 }

  let regexp: RegExp
  try {
    regexp = new RegExp(pattern, flags.has('i') ? 'i' : '')
  } catch {
    return { stdout: '', stderr: `grep: ${pattern}: invalid regular expression\n`, exitCode: 2 }
  }

  const files = rest.slice(1)
  const { sources, stderr, failed } = readSources(e, files)
  const showFilename = files.length > 1

  let stdout = ''
  let matched = false

  for (const source of sources) {
    let count = 0
    const lines = toLines(source.text)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const hit = regexp.test(line) !== flags.has('v')
      if (!hit) continue
      matched = true
      count++
      if (flags.has('c')) continue
      const prefix = (showFilename ? `${source.label}:` : '') + (flags.has('n') ? `${i + 1}:` : '')
      stdout += `${prefix}${line}\n`
    }
    if (flags.has('c')) stdout += `${showFilename ? `${source.label}:` : ''}${count}\n`
  }

  const exitCode = failed ? 2 : matched ? 0 : 1
  return { stdout, stderr, exitCode }
}
```

- [ ] **Step 10: `sort.ts` 구현**

```ts
// src/shell/coreutils/sort.ts
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

export const sort: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const { sources, stderr, failed } = readSources(e, rest)

  let lines = sources.flatMap((source) => toLines(source.text))

  lines.sort((a, b) => (flags.has('n') ? Number(a) - Number(b) || a.localeCompare(b) : a < b ? -1 : a > b ? 1 : 0))
  if (flags.has('r')) lines.reverse()
  if (flags.has('u')) lines = lines.filter((line, i) => i === 0 || line !== lines[i - 1])

  return { stdout: lines.map((l) => `${l}\n`).join(''), stderr, exitCode: failed ? 2 : 0 }
}
```

`sort` 의 문자열 비교에 `localeCompare`를 쓰지 않고 `<` 를 쓰는 이유가 있다. `localeCompare`는 로케일에 따라 `A`와 `a`의 순서가 뒤집힌다. bash는 기본 `LC_ALL=C`에서 바이트 순으로 정렬하므로 대문자가 먼저 온다. `<` 연산자가 그 동작과 일치한다. `-n` 안에서만 동점 처리에 `localeCompare`를 쓴다.

- [ ] **Step 11: 등록표 갱신**

```ts
// src/shell/coreutils/index.ts
import type { CommandFn } from '../types'
import { ls } from './ls'
import { cat } from './cat'
import { head } from './head'
import { tail } from './tail'
import { wc } from './wc'
import { stat } from './stat'
import { grep } from './grep'
import { sort } from './sort'

export const coreutils: Record<string, CommandFn> = {
  ls, cat, head, tail, wc, stat, grep, sort,
}
```

- [ ] **Step 12: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/shell/coreutils/query.test.ts`
Expected: PASS — 30 tests.

- [ ] **Step 13: 커밋**

```bash
git add src/shell/coreutils
git commit -m "feat(shell): coreutils for querying and text — ls cat head tail wc stat grep sort"
```

---

## Task 11: 코어유틸 — 조작 (`cp` `mv` `rm` `mkdir` `rmdir` `touch` `ln` `chmod`)

**Files:**
- Create: `src/shell/coreutils/cp.ts`, `mv.ts`, `rm.ts`, `mkdir.ts`, `rmdir.ts`, `touch.ts`, `ln.ts`, `chmod.ts`
- Modify: `src/shell/coreutils/index.ts`
- Test: `src/shell/coreutils/mutate.test.ts`

**Interfaces:**
- Consumes: `CommandFn` (Task 8), `parseFlags`, `errnoText` (Task 10), `VFS` (Task 3)
- Produces: `coreutils` 등록표에 8개 키가 추가된다. 최종 16개.

`cp -r`가 디렉터리를 복사하려면 VFS 노드를 깊은 복사해야 한다. VFS에 메서드를 추가하는 대신 `cp.ts` 안에서 공개 API(`readdir`, `readFile`, `mkdir`, `writeFile`)만으로 재귀한다. VFS의 표면적을 넓히지 않는 편이 낫다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/coreutils/mutate.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createShell, VFS } from '../index'
import type { Shell } from '../types'

let fs: VFS
let sh: Shell

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/w/src/deep', { recursive: true })
  fs.mkdir('/w/empty')
  fs.writeFile('/w/a.txt', 'alpha\n')
  fs.writeFile('/w/src/inner.txt', 'inner\n')
  fs.writeFile('/w/src/deep/deep.txt', 'deep\n')
  sh = createShell({ fs, cwd: '/w', home: '/w' })
})

describe('cp', () => {
  it('파일을 복사한다', async () => {
    await sh.exec('cp a.txt b.txt')
    expect(fs.readFile('/w/b.txt')).toBe('alpha\n')
    expect(fs.exists('/w/a.txt')).toBe(true)
  })
  it('디렉터리를 대상으로 주면 그 안에 넣는다', async () => {
    await sh.exec('cp a.txt empty')
    expect(fs.readFile('/w/empty/a.txt')).toBe('alpha\n')
  })
  it('-r 없이 디렉터리를 복사하면 실패한다', async () => {
    const r = await sh.exec('cp src dst')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('omitting directory')
  })
  it('-r 은 하위 전체를 복사한다', async () => {
    await sh.exec('cp -r src dst')
    expect(fs.readFile('/w/dst/inner.txt')).toBe('inner\n')
    expect(fs.readFile('/w/dst/deep/deep.txt')).toBe('deep\n')
  })
  it('여러 파일을 디렉터리로 복사한다', async () => {
    await sh.exec('cp a.txt src/inner.txt empty')
    expect(fs.exists('/w/empty/a.txt')).toBe(true)
    expect(fs.exists('/w/empty/inner.txt')).toBe(true)
  })
  it('여러 파일인데 대상이 디렉터리가 아니면 실패한다', async () => {
    const r = await sh.exec('cp a.txt src/inner.txt b.txt')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('is not a directory')
  })
})

describe('mv', () => {
  it('이름을 바꾼다', async () => {
    await sh.exec('mv a.txt renamed.txt')
    expect(fs.exists('/w/a.txt')).toBe(false)
    expect(fs.readFile('/w/renamed.txt')).toBe('alpha\n')
  })
  it('디렉터리 안으로 옮긴다', async () => {
    await sh.exec('mv a.txt empty')
    expect(fs.readFile('/w/empty/a.txt')).toBe('alpha\n')
  })
  it('디렉터리도 옮긴다', async () => {
    await sh.exec('mv src moved')
    expect(fs.readFile('/w/moved/inner.txt')).toBe('inner\n')
  })
  it('없는 파일은 실패한다', async () => {
    expect((await sh.exec('mv nope x')).exitCode).toBe(1)
  })
})

describe('rm', () => {
  it('파일을 지운다', async () => {
    await sh.exec('rm a.txt')
    expect(fs.exists('/w/a.txt')).toBe(false)
  })
  it('-r 없이 디렉터리를 지우면 실패한다', async () => {
    const r = await sh.exec('rm empty')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('is a directory')
  })
  it('-r 은 디렉터리를 통째로 지운다', async () => {
    await sh.exec('rm -r src')
    expect(fs.exists('/w/src')).toBe(false)
  })
  it('없는 파일은 실패하지만 -f 면 조용하다', async () => {
    expect((await sh.exec('rm nope')).exitCode).toBe(1)
    const r = await sh.exec('rm -f nope')
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toBe('')
  })
  it('글롭으로 여러 개를 지운다', async () => {
    await sh.exec('rm *.txt')
    expect(fs.exists('/w/a.txt')).toBe(false)
  })
})

describe('mkdir / rmdir', () => {
  it('디렉터리를 만든다', async () => {
    await sh.exec('mkdir fresh')
    expect(fs.isDir('/w/fresh')).toBe(true)
  })
  it('중첩 경로는 -p 가 있어야 한다', async () => {
    expect((await sh.exec('mkdir a/b')).exitCode).toBe(1)
    await sh.exec('mkdir -p a/b')
    expect(fs.isDir('/w/a/b')).toBe(true)
  })
  it('이미 있으면 실패하지만 -p 면 조용하다', async () => {
    expect((await sh.exec('mkdir empty')).exitCode).toBe(1)
    expect((await sh.exec('mkdir -p empty')).exitCode).toBe(0)
  })
  it('rmdir 은 빈 디렉터리만 지운다', async () => {
    await sh.exec('rmdir empty')
    expect(fs.exists('/w/empty')).toBe(false)
    const r = await sh.exec('rmdir src')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('Directory not empty')
  })
})

describe('touch', () => {
  it('없으면 빈 파일을 만든다', async () => {
    await sh.exec('touch new.txt')
    expect(fs.readFile('/w/new.txt')).toBe('')
  })
  it('있으면 내용을 보존한다', async () => {
    await sh.exec('touch a.txt')
    expect(fs.readFile('/w/a.txt')).toBe('alpha\n')
  })
})

describe('ln -s', () => {
  it('심볼릭 링크를 만든다', async () => {
    await sh.exec('ln -s a.txt link')
    expect(fs.lstat('/w/link')!.kind).toBe('symlink')
    expect(fs.readFile('/w/link')).toBe('alpha\n')
  })
  it('-s 없이는 실패한다 (하드링크 미지원)', async () => {
    const r = await sh.exec('ln a.txt link')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('hard links')
  })
})

describe('chmod', () => {
  it('8진 모드를 적용한다', async () => {
    await sh.exec('chmod 755 a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o755)
  })
  it('+x 는 실행 비트를 켠다', async () => {
    fs.chmod('/w/a.txt', 0o644)
    await sh.exec('chmod +x a.txt')
    expect(fs.lstat('/w/a.txt')!.mode).toBe(0o755)
  })
  it('숫자가 아니고 심볼도 아니면 실패한다', async () => {
    expect((await sh.exec('chmod zzz a.txt')).exitCode).toBe(1)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/coreutils/mutate.test.ts`
Expected: FAIL — `cp: command not found`

- [ ] **Step 3: `cp.ts` 구현**

```ts
// src/shell/coreutils/cp.ts
import type { CommandFn } from '../types'
import type { VFS } from '../vfs'
import { parseFlags, errnoText } from './shared'

function copyTree(fs: VFS, from: string, to: string): void {
  const node = fs.lstat(from)!
  if (node.kind !== 'dir') { fs.writeFile(to, node.content, node.mode); return }
  fs.mkdir(to, { recursive: true })
  for (const name of fs.readdir(from)) copyTree(fs, `${from}/${name}`, `${to}/${name}`)
}

export const cp: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const recursive = flags.has('r') || flags.has('R')

  const dest = rest.pop()
  if (dest === undefined || rest.length === 0) return { stdout: '', stderr: 'usage: cp SOURCE... DEST\n', exitCode: 1 }

  const destAbs = fs.resolve(dest, state.cwd)
  const destIsDir = fs.isDir(destAbs)

  if (rest.length > 1 && !destIsDir) {
    return { stdout: '', stderr: `cp: target '${dest}' is not a directory\n`, exitCode: 1 }
  }

  let stderr = ''
  let exitCode = 0

  for (const source of rest) {
    const sourceAbs = fs.resolve(source, state.cwd)
    const node = fs.lstat(sourceAbs)
    if (!node) { stderr += `cp: cannot stat '${source}': No such file or directory\n`; exitCode = 1; continue }
    if (node.kind === 'dir' && !recursive) {
      stderr += `cp: -r not specified; omitting directory '${source}'\n`
      exitCode = 1
      continue
    }
    const name = sourceAbs.split('/').filter(Boolean).pop()!
    const target = destIsDir ? `${destAbs === '/' ? '' : destAbs}/${name}` : destAbs
    try { copyTree(fs, sourceAbs, target) } catch (e) { stderr += `cp: ${source}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
```

- [ ] **Step 4: `mv.ts` 구현**

```ts
// src/shell/coreutils/mv.ts
import type { CommandFn } from '../types'
import { errnoText } from './shared'

export const mv: CommandFn = ({ args, fs, state }) => {
  const dest = args[args.length - 1]
  const sources = args.slice(0, -1)
  if (dest === undefined || sources.length === 0) return { stdout: '', stderr: 'usage: mv SOURCE... DEST\n', exitCode: 1 }

  const destAbs = fs.resolve(dest, state.cwd)
  const destIsDir = fs.isDir(destAbs)

  if (sources.length > 1 && !destIsDir) {
    return { stdout: '', stderr: `mv: target '${dest}' is not a directory\n`, exitCode: 1 }
  }

  let stderr = ''
  let exitCode = 0

  for (const source of sources) {
    const sourceAbs = fs.resolve(source, state.cwd)
    if (!fs.lstat(sourceAbs)) {
      stderr += `mv: cannot stat '${source}': No such file or directory\n`
      exitCode = 1
      continue
    }
    const name = sourceAbs.split('/').filter(Boolean).pop()!
    const target = destIsDir ? `${destAbs === '/' ? '' : destAbs}/${name}` : destAbs
    try { fs.rename(sourceAbs, target) } catch (e) { stderr += `mv: ${source}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
```

- [ ] **Step 5: `rm.ts` 구현**

```ts
// src/shell/coreutils/rm.ts
import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

export const rm: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const recursive = flags.has('r') || flags.has('R')
  const force = flags.has('f')

  let stderr = ''
  let exitCode = 0

  for (const target of rest) {
    const abs = fs.resolve(target, state.cwd)
    const node = fs.lstat(abs)
    if (!node) {
      if (!force) { stderr += `rm: cannot remove '${target}': No such file or directory\n`; exitCode = 1 }
      continue
    }
    if (node.kind === 'dir' && !recursive) {
      stderr += `rm: cannot remove '${target}': Is a directory\n`
      exitCode = 1
      continue
    }
    try { fs.rm(abs, { recursive }) } catch (e) { stderr += `rm: ${target}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
```

- [ ] **Step 6: `mkdir.ts`, `rmdir.ts`, `touch.ts` 구현**

```ts
// src/shell/coreutils/mkdir.ts
import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

export const mkdir: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  const parents = flags.has('p')
  let stderr = ''
  let exitCode = 0
  for (const target of rest) {
    try { fs.mkdir(fs.resolve(target, state.cwd), { recursive: parents }) }
    catch (e) { stderr += `mkdir: cannot create directory '${target}': ${errnoText(e)}\n`; exitCode = 1 }
  }
  return { stdout: '', stderr, exitCode }
}
```

```ts
// src/shell/coreutils/rmdir.ts
import type { CommandFn } from '../types'
import { errnoText } from './shared'

export const rmdir: CommandFn = ({ args, fs, state }) => {
  let stderr = ''
  let exitCode = 0
  for (const target of args) {
    try { fs.rmdir(fs.resolve(target, state.cwd)) }
    catch (e) { stderr += `rmdir: failed to remove '${target}': ${errnoText(e)}\n`; exitCode = 1 }
  }
  return { stdout: '', stderr, exitCode }
}
```

```ts
// src/shell/coreutils/touch.ts
import type { CommandFn } from '../types'
import { errnoText } from './shared'

export const touch: CommandFn = ({ args, fs, state }) => {
  let stderr = ''
  let exitCode = 0
  for (const target of args) {
    try { fs.touch(fs.resolve(target, state.cwd)) }
    catch (e) { stderr += `touch: cannot touch '${target}': ${errnoText(e)}\n`; exitCode = 1 }
  }
  return { stdout: '', stderr, exitCode }
}
```

- [ ] **Step 7: `ln.ts` 와 `chmod.ts` 구현**

```ts
// src/shell/coreutils/ln.ts
import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

export const ln: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  if (!flags.has('s')) {
    return { stdout: '', stderr: 'ln: hard links are not supported in this environment; use -s\n', exitCode: 1 }
  }
  const [target, linkName] = rest
  if (!target || !linkName) return { stdout: '', stderr: 'usage: ln -s TARGET LINK\n', exitCode: 1 }
  try {
    fs.symlink(fs.resolve(target, state.cwd), fs.resolve(linkName, state.cwd))
  } catch (e) {
    return { stdout: '', stderr: `ln: failed to create symbolic link '${linkName}': ${errnoText(e)}\n`, exitCode: 1 }
  }
  return { stdout: '', stderr: '', exitCode: 0 }
}
```

```ts
// src/shell/coreutils/chmod.ts
import type { CommandFn } from '../types'
import { errnoText } from './shared'

/** `+x`, `-w`, `a+r`, `u+x` 같은 아주 좁은 심볼 모드만 지원한다. */
function applySymbolic(mode: number, spec: string): number | null {
  const match = /^([ugoa]*)([+-])([rwx]+)$/.exec(spec)
  if (!match) return null
  const [, whoRaw, op, permsRaw] = match as unknown as [string, string, '+' | '-', string]
  const who = whoRaw === '' ? 'a' : whoRaw

  let mask = 0
  const bit = { r: 4, w: 2, x: 1 } as const
  for (const perm of permsRaw) {
    const value = bit[perm as 'r' | 'w' | 'x']
    if (who.includes('u') || who.includes('a')) mask |= value << 6
    if (who.includes('g') || who.includes('a')) mask |= value << 3
    if (who.includes('o') || who.includes('a')) mask |= value
  }
  return op === '+' ? mode | mask : mode & ~mask
}

export const chmod: CommandFn = ({ args, fs, state }) => {
  const [spec, ...targets] = args
  if (!spec || targets.length === 0) return { stdout: '', stderr: 'usage: chmod MODE FILE...\n', exitCode: 1 }

  let stderr = ''
  let exitCode = 0

  for (const target of targets) {
    const abs = fs.resolve(target, state.cwd)
    const node = fs.lstat(abs)
    if (!node) { stderr += `chmod: cannot access '${target}': No such file or directory\n`; exitCode = 1; continue }

    let next: number | null
    if (/^[0-7]{3,4}$/.test(spec)) next = parseInt(spec, 8)
    else next = applySymbolic(node.mode, spec)

    if (next === null) { stderr += `chmod: invalid mode: '${spec}'\n`; exitCode = 1; continue }
    try { fs.chmod(abs, next) } catch (e) { stderr += `chmod: ${target}: ${errnoText(e)}\n`; exitCode = 1 }
  }

  return { stdout: '', stderr, exitCode }
}
```

- [ ] **Step 8: 등록표 갱신 — 최종 16개**

```ts
// src/shell/coreutils/index.ts
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

export const coreutils: Record<string, CommandFn> = {
  ls, cat, head, tail, wc, stat, grep, sort,
  cp, mv, rm, mkdir, rmdir, touch, ln, chmod,
}
```

- [ ] **Step 9: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell`
Expected: PASS — 셸 테스트 전부.

- [ ] **Step 10: 커밋**

```bash
git add src/shell/coreutils
git commit -m "feat(shell): coreutils for mutation — cp mv rm mkdir rmdir touch ln chmod"
```

---

## Task 12: 진짜 bash에 대한 골든 테스트

"bash 서브셋"이라는 주장을 검증 가능한 명제로 바꾼다. 이 장치가 없으면 우리가 만든 것은 그저 bash처럼 생긴 무언가다.

**기준 환경은 Docker의 `debian:stable-slim`이다.** macOS의 `ls`와 `sed`는 BSD 계열이라 GNU와 에러 메시지·플래그가 다르다. 개발자의 노트북에 따라 기대 출력이 달라지면 골든 테스트는 의미가 없다. 생성 스크립트만 Docker를 요구하고, `.expected` 파일은 커밋되므로 **테스트를 돌리는 데는 Docker가 필요 없다.**

**Files:**
- Create: `scripts/gen-golden.sh`, `tests/shell/golden/seed.sh`, `tests/shell/golden/cases/*.sh`, `tests/shell/golden/expected/*.txt` (생성됨), `tests/shell/golden.test.ts`
- Test: `tests/shell/golden.test.ts`

**Interfaces:**
- Consumes: `createShell`, `VFS` (Task 9)
- Produces: `npm run golden`이 기대 출력을 재생성한다. `npm test`가 대조한다.

**케이스 작성 규칙 세 가지.**

1. `ls`는 반드시 `-1`을 붙인다. `ls -l`은 쓰지 않는다(날짜 없음).
2. `grep` 패턴은 문자열 리터럴이나 ERE만 쓴다. BRE 고유 문법(`\(`, `\+`)은 금지.
3. 셸 자체의 에러 메시지(`command not found`, `syntax error`)를 유발하지 않는다. 진짜 bash는 스크립트 이름과 줄번호를 접두사로 붙이므로 대조가 불가능하다. 코어유틸의 에러(`ls: cannot access ...`)는 접두사가 없으므로 허용된다.

- [ ] **Step 1: 시드 스크립트 작성**

두 셸이 똑같이 실행할 수 있는 평문 명령만 쓴다.

```bash
# tests/shell/golden/seed.sh
mkdir -p project/src
mkdir -p project/docs
mkdir -p empty
echo 'alpha' > a.txt
echo 'beta' > b.txt
echo 'one' > project/src/one.txt
echo 'two' > project/src/two.txt
echo 'note' > project/docs/note.md
printf 'banana\napple\ncherry\napple\n' > fruit.txt
printf '10\n9\n100\n' > nums.txt
printf 'Hello\nhello\nWORLD\n' > mixed.txt
```

`printf`는 우리 셸에 없다. 시드는 **진짜 bash로만** 실행되고, 우리 쪽은 아래 `seedVfs()`가 같은 상태를 직접 만든다. 시드를 우리 셸로 돌리지 않는 이유는 시드 자체의 버그가 골든 테스트 실패로 위장되는 것을 막기 위해서다.

- [ ] **Step 2: 케이스 파일 작성**

```bash
# tests/shell/golden/cases/01-basic.sh
echo hello
echo "quoted string"
echo 'single quoted'
echo a b   c
pwd
```

```bash
# tests/shell/golden/cases/02-glob.sh
echo *.txt
echo project/*
echo nope*
ls -1 project/src
```

```bash
# tests/shell/golden/cases/03-pipes.sh
cat fruit.txt | sort
cat fruit.txt | sort -u
cat nums.txt | sort -n
cat fruit.txt | grep an
cat fruit.txt | grep -c apple
cat fruit.txt | sort | head -n 2
```

```bash
# tests/shell/golden/cases/04-redirect.sh
echo first > out.txt
echo second >> out.txt
cat out.txt
wc -l < out.txt
cat < a.txt
```

```bash
# tests/shell/golden/cases/05-vars.sh
X=hello
echo $X
echo "$X world"
echo '$X'
Y="a b"
echo $Y
echo "$Y"
echo ${X}s
echo $NOPE
echo "[$NOPE]"
```

```bash
# tests/shell/golden/cases/06-exitcode.sh
true && echo yes
false && echo no
false || echo recovered
true || echo skipped
false
echo $?
true
echo $?
```

```bash
# tests/shell/golden/cases/07-subst.sh
echo $(echo nested)
echo "$(cat a.txt)"
X=$(cat fruit.txt | wc -l)
echo $X
echo $(echo a; echo b)
```

```bash
# tests/shell/golden/cases/08-grep-sort.sh
grep -i hello mixed.txt
grep -v hello mixed.txt
grep -n o mixed.txt
sort -r nums.txt
sort -n nums.txt
```

```bash
# tests/shell/golden/cases/09-errors.sh
ls -1 nope
cat nope
cp nope dest
rmdir project
```

케이스 09가 성립하는 이유: 이 네 메시지는 GNU coreutils가 프로그램 이름만 접두사로 붙이고 줄번호를 붙이지 않기 때문이다.

- [ ] **Step 3: `scripts/gen-golden.sh` 작성**

```bash
#!/usr/bin/env bash
# 진짜 bash(데비안, GNU coreutils)로 기대 출력을 생성한다.
# 결과는 커밋된다. 테스트를 돌리는 데는 Docker가 필요 없다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GOLDEN="$ROOT/tests/shell/golden"
IMAGE="debian:stable-slim"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker가 필요합니다. .expected 파일은 이미 커밋되어 있으니, 테스트만 돌릴 거면 이 스크립트는 필요 없습니다." >&2
  exit 1
fi

mkdir -p "$GOLDEN/expected"

for case_file in "$GOLDEN"/cases/*.sh; do
  name="$(basename "$case_file" .sh)"
  echo "generating $name"

  docker run --rm -i \
    -v "$GOLDEN/seed.sh:/golden/seed.sh:ro" \
    -v "$case_file:/golden/case.sh:ro" \
    "$IMAGE" \
    bash -c '
      set +e
      mkdir -p /work && cd /work
      bash /golden/seed.sh >/dev/null 2>&1
      out=$(bash /golden/case.sh 2>/tmp/err)
      code=$?
      printf "%s" "$out"
      printf "\n===STDERR===\n"
      cat /tmp/err
      printf "===EXIT===\n%s\n" "$code"
    ' > "$GOLDEN/expected/$name.txt"
done

echo "완료. git diff 로 변화를 확인하세요."
```

```bash
chmod +x scripts/gen-golden.sh
```

- [ ] **Step 4: 기대 출력 생성**

Run: `npm run golden`
Expected: `tests/shell/golden/expected/` 에 9개 `.txt` 파일이 생긴다. 내용을 눈으로 훑어 상식적인지 본다.

- [ ] **Step 5: 실패하는 대조 테스트 작성**

```ts
// tests/shell/golden.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createShell, VFS } from '../../src/shell/index'

const here = dirname(fileURLToPath(import.meta.url))
const golden = join(here, 'golden')

/** seed.sh 와 동일한 초기 상태를 VFS 위에 직접 만든다. */
function seedVfs(): VFS {
  const fs = new VFS()
  fs.mkdir('/work/project/src', { recursive: true })
  fs.mkdir('/work/project/docs', { recursive: true })
  fs.mkdir('/work/empty', { recursive: true })
  fs.writeFile('/work/a.txt', 'alpha\n')
  fs.writeFile('/work/b.txt', 'beta\n')
  fs.writeFile('/work/project/src/one.txt', 'one\n')
  fs.writeFile('/work/project/src/two.txt', 'two\n')
  fs.writeFile('/work/project/docs/note.md', 'note\n')
  fs.writeFile('/work/fruit.txt', 'banana\napple\ncherry\napple\n')
  fs.writeFile('/work/nums.txt', '10\n9\n100\n')
  fs.writeFile('/work/mixed.txt', 'Hello\nhello\nWORLD\n')
  return fs
}

interface Expected { stdout: string; stderr: string; exitCode: number }

function parseExpected(raw: string): Expected {
  const stderrAt = raw.indexOf('\n===STDERR===\n')
  const exitAt = raw.indexOf('===EXIT===\n')
  return {
    stdout: raw.slice(0, stderrAt),
    stderr: raw.slice(stderrAt + '\n===STDERR===\n'.length, exitAt),
    exitCode: Number(raw.slice(exitAt + '===EXIT===\n'.length).trim()),
  }
}

/** 케이스 파일의 각 줄을 순서대로 실행하고 출력을 이어붙인다. */
async function runCase(script: string): Promise<Expected> {
  const sh = createShell({ fs: seedVfs(), cwd: '/work', home: '/work' })
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  for (const line of script.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const result = await sh.exec(trimmed)
    stdout += result.stdout
    stderr += result.stderr
    exitCode = result.exitCode
  }
  return { stdout, stderr, exitCode }
}

const caseFiles = readdirSync(join(golden, 'cases')).filter((f) => f.endsWith('.sh')).sort()

describe('진짜 bash 대조', () => {
  for (const file of caseFiles) {
    const name = basename(file, '.sh')
    it(name, async () => {
      const script = readFileSync(join(golden, 'cases', file), 'utf8')
      const expected = parseExpected(readFileSync(join(golden, 'expected', `${name}.txt`), 'utf8'))
      const actual = await runCase(script)

      expect(actual.stdout).toBe(expected.stdout)
      expect(actual.stderr).toBe(expected.stderr)
      expect(actual.exitCode).toBe(expected.exitCode)
    })
  }
})
```

`runCase`가 `pwd`를 `/work`로 보게 하려고 cwd를 `/work`로 둔다. 도커 쪽도 `/work`에서 돈다. 이 일치가 케이스 01의 `pwd`를 통과시킨다.

- [ ] **Step 6: 테스트 실행. 실패하는 케이스를 하나씩 고친다**

Run: `npx vitest run --project shell tests/shell/golden.test.ts`
Expected: 처음에는 몇 개가 FAIL한다. 이것이 이 태스크의 **목적**이다.

각 실패에 대해 판단한다. 우리 셸이 틀렸으면 **셸을 고친다.** bash가 우리 범위 밖의 동작을 하는 것이면 **케이스를 좁힌다.** 케이스를 지워서 초록불을 만드는 것은 부정행위다. 왜 좁혔는지 케이스 파일에 주석으로 남긴다.

예상되는 초기 실패와 처방:
- `echo $(echo a; echo b)` → 명령치환 안의 `;` 가 처리되는지. `runSubshell`이 `parse`를 통째로 돌리므로 통과해야 한다.
- `echo a b   c` → 단어분할이 연속 공백을 하나로 접는지.
- `wc -l < out.txt` → 파일명 없이 숫자만 나오는지. 진짜 wc는 `2`를 8칸 우측정렬로 낸다.
- `sort` 의 대소문자 순서 → `LC_ALL` 문제. 도커의 데비안은 기본 `C` 로케일이므로 바이트 순이다. 우리 `<` 비교와 일치한다.

- [ ] **Step 7: 모든 골든 케이스가 통과할 때까지 반복**

Run: `npx vitest run --project shell tests/shell/golden.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 8: 커밋**

```bash
git add scripts/gen-golden.sh tests/shell/golden tests/shell/golden.test.ts package.json
git commit -m "test(shell): golden tests against real bash in debian container"
```

---

## Task 13: 게임 타입, 하니스, 진행도

**Files:**
- Create: `src/game/types.ts`, `src/game/harness.ts`, `src/game/progress.ts`, `src/game/problems/index.ts`
- Test: `src/game/progress.test.ts`

**Interfaces:**
- Consumes: `VFS`, `createShell`, `Shell`, `ExecResult` (Task 9)
- Produces:

```ts
// src/game/types.ts
export type Level = 1 | 2 | 3 | 4 | 5

export interface CheckContext {
  fs: VFS
  lastResult: ExecResult
  history: string[]
  cwd: string
}

export interface Problem {
  id: string                         // 'l1-01'
  level: Level
  title: string                      // HUD 카드 제목
  prompt: string                     // 지문
  setup(fs: VFS): void
  hints: string[]
  check(ctx: CheckContext): boolean
  solution: string
  wrongAnswer: string                // 그럴듯하지만 틀린 답. 음성 테스트용.
  explanation: string
}
```

```ts
// src/game/harness.ts
export const PLAYER_HOME = '/home/player'
/** 문제의 setup 을 돌린 새 셸. 리셋도 이 함수를 다시 부르면 된다. */
export function createShellForProblem(problem: Problem): Shell
```

```ts
// src/game/progress.ts
export interface Progress { solved: string[]; hintsUsed: string[] }
export const UNLOCK_THRESHOLD = 8   // 이전 레벨에서 8문제를 풀면 다음이 열린다

export function emptyProgress(): Progress
export function loadProgress(): Progress
export function saveProgress(p: Progress): void
export function markSolved(p: Progress, id: string): Progress
export function markHintUsed(p: Progress, id: string): Progress
export function solvedInLevel(p: Progress, level: Level, problems: Problem[]): number
export function isLevelUnlocked(level: Level, p: Progress, problems: Problem[]): boolean
```

`progress.ts`는 `localStorage`를 쓰므로 셸 제약(브라우저 무관)에서 자유롭다. 다만 `localStorage`가 없는 환경(테스트)에서 죽지 않아야 한다.

- [ ] **Step 1: 실패하는 진행도 테스트 작성**

```ts
// src/game/progress.test.ts
import { describe, it, expect } from 'vitest'
import { emptyProgress, markSolved, isLevelUnlocked, solvedInLevel, UNLOCK_THRESHOLD } from './progress'
import type { Problem, Level } from './types'

function fakeProblems(): Problem[] {
  const make = (level: Level, n: number): Problem => ({
    id: `l${level}-${String(n).padStart(2, '0')}`,
    level, title: '', prompt: '', setup: () => {}, hints: [],
    check: () => false, solution: '', wrongAnswer: '', explanation: '',
  })
  return [1, 2, 3, 4, 5].flatMap((level) =>
    Array.from({ length: 10 }, (_, i) => make(level as Level, i + 1)),
  )
}

const problems = fakeProblems()

describe('레벨 해제', () => {
  it('레벨 1은 항상 열려 있다', () => {
    expect(isLevelUnlocked(1, emptyProgress(), problems)).toBe(true)
  })

  it('7문제로는 다음 레벨이 열리지 않는다', () => {
    let p = emptyProgress()
    for (let i = 1; i <= 7; i++) p = markSolved(p, `l1-0${i}`)
    expect(isLevelUnlocked(2, p, problems)).toBe(false)
  })

  it(`${UNLOCK_THRESHOLD}문제를 풀면 다음 레벨이 열린다`, () => {
    let p = emptyProgress()
    for (let i = 1; i <= UNLOCK_THRESHOLD; i++) p = markSolved(p, `l1-0${i}`)
    expect(isLevelUnlocked(2, p, problems)).toBe(true)
  })

  it('레벨 2를 건너뛰고 3이 열리지는 않는다', () => {
    let p = emptyProgress()
    for (let i = 1; i <= 10; i++) p = markSolved(p, `l1-${String(i).padStart(2, '0')}`)
    expect(isLevelUnlocked(2, p, problems)).toBe(true)
    expect(isLevelUnlocked(3, p, problems)).toBe(false)
  })

  it('solvedInLevel 은 해당 레벨만 센다', () => {
    let p = emptyProgress()
    p = markSolved(p, 'l1-01')
    p = markSolved(p, 'l2-01')
    expect(solvedInLevel(p, 1, problems)).toBe(1)
  })

  it('같은 문제를 두 번 풀어도 한 번만 센다', () => {
    let p = emptyProgress()
    p = markSolved(p, 'l1-01')
    p = markSolved(p, 'l1-01')
    expect(solvedInLevel(p, 1, problems)).toBe(1)
  })

  it('markSolved 는 원본을 변경하지 않는다', () => {
    const p = emptyProgress()
    markSolved(p, 'l1-01')
    expect(p.solved).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/game/progress.test.ts`
Expected: FAIL — "Failed to resolve import ./progress"

`vitest.config.ts`의 `shell` 프로젝트 include에 `src/game/**/*.test.ts`를 추가해야 한다. 게임 로직도 node에서 돈다.

```ts
test: { name: 'shell', environment: 'node', include: ['src/shell/**/*.test.ts', 'src/game/**/*.test.ts', 'tests/**/*.test.ts'] },
```

- [ ] **Step 3: `types.ts` 작성**

```ts
// src/game/types.ts
import type { VFS } from '../shell/vfs'
import type { ExecResult } from '../shell/types'

export type Level = 1 | 2 | 3 | 4 | 5

export interface CheckContext {
  fs: VFS
  lastResult: ExecResult
  history: string[]
  cwd: string
}

export interface Problem {
  id: string
  level: Level
  title: string
  prompt: string
  setup(fs: VFS): void
  hints: string[]
  check(ctx: CheckContext): boolean
  solution: string
  wrongAnswer: string
  explanation: string
}
```

- [ ] **Step 4: `harness.ts` 작성**

```ts
// src/game/harness.ts
import { createShell, VFS } from '../shell/index'
import type { Shell } from '../shell/types'
import type { Problem } from './types'

export const PLAYER_HOME = '/home/player'

export function createShellForProblem(problem: Problem): Shell {
  const fs = new VFS()
  fs.mkdir(PLAYER_HOME, { recursive: true })
  problem.setup(fs)
  return createShell({ fs, cwd: PLAYER_HOME, home: PLAYER_HOME })
}
```

- [ ] **Step 5: `progress.ts` 작성**

```ts
// src/game/progress.ts
import type { Level, Problem } from './types'

export interface Progress { solved: string[]; hintsUsed: string[] }

export const UNLOCK_THRESHOLD = 8
const STORAGE_KEY = 'flashshell.progress.v1'

export function emptyProgress(): Progress {
  return { solved: [], hintsUsed: [] }
}

export function loadProgress(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return emptyProgress()
    const parsed = JSON.parse(raw) as Partial<Progress>
    return {
      solved: Array.isArray(parsed.solved) ? parsed.solved : [],
      hintsUsed: Array.isArray(parsed.hintsUsed) ? parsed.hintsUsed : [],
    }
  } catch {
    // 손상된 저장소가 게임을 막아서는 안 된다.
    return emptyProgress()
  }
}

export function saveProgress(progress: Progress): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // 프라이빗 모드 등. 진행도가 안 남을 뿐 게임은 계속된다.
  }
}

function addUnique(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id]
}

export function markSolved(progress: Progress, id: string): Progress {
  return { ...progress, solved: addUnique(progress.solved, id) }
}

export function markHintUsed(progress: Progress, id: string): Progress {
  return { ...progress, hintsUsed: addUnique(progress.hintsUsed, id) }
}

export function solvedInLevel(progress: Progress, level: Level, problems: Problem[]): number {
  const ids = new Set(problems.filter((p) => p.level === level).map((p) => p.id))
  return progress.solved.filter((id) => ids.has(id)).length
}

export function isLevelUnlocked(level: Level, progress: Progress, problems: Problem[]): boolean {
  if (level === 1) return true
  const previous = (level - 1) as Level
  if (!isLevelUnlocked(previous, progress, problems)) return false
  return solvedInLevel(progress, previous, problems) >= UNLOCK_THRESHOLD
}
```

레벨 3의 해제 조건에 레벨 2의 해제 여부를 재귀로 확인하는 이유는, 그러지 않으면 레벨 1을 건너뛰고 레벨 2만 8개 푼 (불가능하지만 저장소를 조작하면 가능한) 상태에서 레벨 3이 열리기 때문이다. 규칙은 순차 해제다.

- [ ] **Step 6: 빈 문제 등록표를 만든다**

```ts
// src/game/problems/index.ts
import type { Problem } from '../types'

export const allProblems: Problem[] = []
```

- [ ] **Step 7: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/game/progress.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 8: 커밋**

```bash
git add src/game vitest.config.ts
git commit -m "feat(game): problem types, shell harness, and progress with sequential unlock"
```

---

## Task 14: 문제 검증 하니스와 L1 문제 10개

검증기는 두 방향으로 틀릴 수 있다. 정답을 거부하거나, 오답을 받아주거나. **후자가 더 나쁘고 더 흔하다.** 그래서 모든 문제는 `solution`과 `wrongAnswer`를 함께 들고 다니고, 자동 테스트가 두 방향을 모두 두들긴다.

**Files:**
- Create: `src/game/check-helpers.ts`, `src/game/problems/l1.ts`
- Modify: `src/game/problems/index.ts`
- Test: `tests/problems.test.ts`

**Interfaces:**
- Consumes: `Problem`, `CheckContext` (Task 13), `createShellForProblem` (Task 13)
- Produces: `allProblems`에 L1 문제 10개(`l1-01` … `l1-10`)가 들어간다.

**출제 규칙.** `check`는 반드시 `ctx.fs`(파일시스템 최종 상태) 또는 `ctx.lastResult.stdout`(마지막 명령의 출력)만 본다. `ctx.history`를 읽어 명령어 문자열을 매칭하는 것은 금지다 — 그 순간 이 게임은 정답 암기 게임이 된다.

- [ ] **Step 1: 실패하는 하니스 테스트 작성**

```ts
// tests/problems.test.ts
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
```

마지막 블록이 중요하다. 사용자는 반드시 `rm -rf`를 친다. 그때 `check`가 `readFile`로 없는 파일을 읽다가 던지면 게임이 크래시한다. 검증기는 항상 방어적으로 써야 하고, 이 테스트가 그것을 강제한다.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell tests/problems.test.ts`
Expected: FAIL — "문제가 하나 이상 있다"

- [ ] **Step 3: 검증 헬퍼를 만든다**

모든 `check`가 반복할 방어 코드를 한 번만 쓴다.

```ts
// src/game/check-helpers.ts
import type { VFS } from '../shell/vfs'

/** 파일을 읽는다. 없거나 디렉터리면 null. 절대 던지지 않는다. */
export function safeRead(fs: VFS, path: string): string | null {
  try { return fs.readFile(path) } catch { return null }
}

/** 디렉터리 목록. 없으면 null. 절대 던지지 않는다. */
export function safeReaddir(fs: VFS, path: string): string[] | null {
  try { return fs.readdir(path) } catch { return null }
}

/** 후행 공백·개행을 무시한 비교. */
export function trimEq(actual: string | null, expected: string): boolean {
  return actual !== null && actual.trim() === expected.trim()
}
```

- [ ] **Step 4: L1 문제 10개 작성**

```ts
// src/game/problems/l1.ts
import type { Problem } from '../types'
import { safeRead, safeReaddir, trimEq } from '../check-helpers'

const HOME = '/home/player'

export const l1: Problem[] = [
  {
    id: 'l1-01',
    level: 1,
    title: '첫 접속',
    prompt: '홈 디렉터리에 readme.txt 가 있습니다. 그 내용을 화면에 출력하세요.',
    setup: (fs) => { fs.writeFile(`${HOME}/readme.txt`, 'ACCESS GRANTED\n') },
    hints: ['어떤 파일이 있는지 먼저 보고 싶다면 ls 입니다.', '파일 내용을 그대로 뱉는 명령은 cat 입니다.'],
    check: (ctx) => ctx.lastResult.stdout === 'ACCESS GRANTED\n',
    solution: 'cat readme.txt',
    wrongAnswer: 'ls readme.txt',
    explanation: 'cat 은 concatenate 의 준말입니다. 파일 여러 개를 이어붙여 표준출력으로 내보내는 것이 본래 목적이고, 하나만 주면 그냥 내용을 보여줍니다.',
  },
  {
    id: 'l1-02',
    level: 1,
    title: '숨겨진 것',
    prompt: '이 디렉터리에는 눈에 보이지 않는 파일이 하나 있습니다. 찾아서 내용을 출력하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/decoy.txt`, 'nothing here\n')
      fs.writeFile(`${HOME}/.keycard`, 'K-7741-ZX\n')
    },
    hints: ['점(.)으로 시작하는 파일은 ls 가 기본적으로 숨깁니다.', 'ls -a 를 써보세요.'],
    check: (ctx) => ctx.lastResult.stdout === 'K-7741-ZX\n',
    solution: 'cat .keycard',
    wrongAnswer: 'cat decoy.txt',
    explanation: '유닉스에서 "숨김 파일"은 특별한 속성이 아닙니다. 그저 이름이 점으로 시작할 뿐이고, ls 가 관례적으로 감춰줍니다. -a 는 all 입니다.',
  },
  {
    id: 'l1-03',
    level: 1,
    title: '금고로',
    prompt: 'vault 디렉터리 안으로 이동하세요.',
    setup: (fs) => {
      fs.mkdir(`${HOME}/vault`)
      fs.mkdir(`${HOME}/lobby`)
    },
    hints: ['디렉터리를 옮겨다니는 명령은 cd 입니다.'],
    check: (ctx) => ctx.cwd === `${HOME}/vault`,
    solution: 'cd vault',
    wrongAnswer: 'ls vault',
    explanation: 'cd 는 change directory 입니다. 셸의 현재 작업 디렉터리를 바꾸므로, 다른 명령과 달리 자식 프로세스가 아니라 셸 자신이 실행하는 빌트인이어야만 합니다.',
  },
  {
    id: 'l1-04',
    level: 1,
    title: '깊은 곳',
    prompt: 'srv/logs/2026 디렉터리로 한 번에 이동하세요.',
    setup: (fs) => {
      fs.mkdir(`${HOME}/srv/logs/2026`, { recursive: true })
      fs.mkdir(`${HOME}/srv/logs/2025`, { recursive: true })
    },
    hints: ['cd 는 경로를 통째로 받을 수 있습니다.', '슬래시로 디렉터리를 이어붙여 보세요.'],
    check: (ctx) => ctx.cwd === `${HOME}/srv/logs/2026`,
    solution: 'cd srv/logs/2026',
    wrongAnswer: 'cd srv',
    explanation: '경로는 한 번에 여러 단계를 내려갈 수 있습니다. 반대로 cd ../.. 로 두 단계를 한 번에 올라갈 수도 있습니다.',
  },
  {
    id: 'l1-05',
    level: 1,
    title: '로그의 머리',
    prompt: 'access.log 의 첫 5줄만 출력하세요.',
    setup: (fs) => {
      const lines = Array.from({ length: 40 }, (_, i) => `entry ${i + 1}`).join('\n')
      fs.writeFile(`${HOME}/access.log`, `${lines}\n`)
    },
    hints: ['파일 앞부분만 보는 전용 명령이 있습니다.', 'head 의 -n 옵션은 줄 수를 받습니다.'],
    check: (ctx) => ctx.lastResult.stdout === 'entry 1\nentry 2\nentry 3\nentry 4\nentry 5\n',
    solution: 'head -n 5 access.log',
    wrongAnswer: 'cat access.log',
    explanation: 'head 와 tail 은 거대한 로그 파일을 다룰 때 필수입니다. cat 은 파일 전체를 메모리에 올려 화면을 밀어내지만, head 는 필요한 만큼만 읽고 멈춥니다.',
  },
  {
    id: 'l1-06',
    level: 1,
    title: '로그의 꼬리',
    prompt: 'access.log 의 마지막 3줄만 출력하세요.',
    setup: (fs) => {
      const lines = Array.from({ length: 40 }, (_, i) => `entry ${i + 1}`).join('\n')
      fs.writeFile(`${HOME}/access.log`, `${lines}\n`)
    },
    hints: ['head 의 반대말을 생각해 보세요.'],
    check: (ctx) => ctx.lastResult.stdout === 'entry 38\nentry 39\nentry 40\n',
    solution: 'tail -n 3 access.log',
    wrongAnswer: 'head -n 3 access.log',
    explanation: '실무에서 가장 많이 치는 명령 중 하나가 tail 입니다. 로그의 끝은 가장 최근에 일어난 일이니까요.',
  },
  {
    id: 'l1-07',
    level: 1,
    title: '몇 줄인가',
    prompt: 'access.log 가 몇 줄인지 세어 출력하세요. 출력에는 숫자만 있어야 합니다.',
    setup: (fs) => {
      const lines = Array.from({ length: 40 }, (_, i) => `entry ${i + 1}`).join('\n')
      fs.writeFile(`${HOME}/access.log`, `${lines}\n`)
    },
    hints: ['wc 는 word count 지만 줄도 셉니다.', 'wc 에 파일명을 주면 파일명까지 출력됩니다. 리다이렉션으로 넘기면 어떨까요?'],
    check: (ctx) => ctx.lastResult.stdout.trim() === '40',
    solution: 'wc -l < access.log',
    wrongAnswer: 'wc -c < access.log',
    explanation: 'wc -l access.log 는 "40 access.log" 를 출력합니다. 파일을 인자로 받았으니 이름을 알려주는 것이죠. 하지만 표준입력으로 흘려보내면 wc 는 파일명을 모르므로 숫자만 냅니다. 파이프 cat access.log | wc -l 도 같은 이유로 동작합니다.',
  },
  {
    id: 'l1-08',
    level: 1,
    title: '확장자로 거르기',
    prompt: '.txt 로 끝나는 파일만 한 줄에 하나씩 나열하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/notes.txt`, '')
      fs.writeFile(`${HOME}/todo.txt`, '')
      fs.writeFile(`${HOME}/image.png`, '')
      fs.writeFile(`${HOME}/script.sh`, '')
    },
    hints: ['셸은 * 를 파일명 패턴으로 해석합니다.', 'ls 에 패턴을 넘겨보세요.'],
    check: (ctx) => ctx.lastResult.stdout === 'notes.txt\ntodo.txt\n',
    solution: 'ls *.txt',
    wrongAnswer: 'ls',
    explanation: '중요한 것은 ls 가 * 를 해석하지 않는다는 점입니다. 셸이 먼저 *.txt 를 notes.txt todo.txt 로 펼친 뒤, 그 두 인자를 ls 에게 건넵니다. ls 는 별표를 본 적조차 없습니다.',
  },
  {
    id: 'l1-09',
    level: 1,
    title: '한 줄 찾기',
    prompt: 'users.txt 에서 admin 이 들어간 줄만 출력하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/users.txt`, 'guest:x:1001\nadmin:x:0\noperator:x:1002\n')
    },
    hints: ['패턴에 맞는 줄만 걸러내는 명령이 grep 입니다.', 'grep 패턴 파일명 순서입니다.'],
    check: (ctx) => ctx.lastResult.stdout === 'admin:x:0\n',
    solution: 'grep admin users.txt',
    wrongAnswer: 'cat users.txt',
    explanation: 'grep 이라는 이름은 ed 편집기의 명령 g/re/p — globally search for a regular expression and print — 에서 왔습니다. 이름 자체가 사용법입니다.',
  },
  {
    id: 'l1-10',
    level: 1,
    title: '증거 남기기',
    prompt: 'vault 안에 파일이 몇 개인지 세어, 그 숫자만 report.txt 에 저장하세요.',
    setup: (fs) => {
      fs.mkdir(`${HOME}/vault`)
      fs.writeFile(`${HOME}/vault/alpha`, '')
      fs.writeFile(`${HOME}/vault/beta`, '')
      fs.writeFile(`${HOME}/vault/gamma`, '')
    },
    hints: [
      'ls 의 출력을 wc 에게 넘기려면 파이프 | 를 씁니다.',
      '명령의 출력을 파일로 보내려면 > 를 씁니다.',
      'ls vault | wc -l > report.txt 처럼 이어붙일 수 있습니다.',
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/report.txt`), '3'),
    solution: 'ls vault | wc -l > report.txt',
    wrongAnswer: 'ls vault > report.txt',
    explanation: '파이프는 앞 명령의 표준출력을 뒤 명령의 표준입력에 연결합니다. 리다이렉션 > 는 표준출력을 파일로 돌립니다. 둘은 다른 장치이고, 한 줄에서 함께 쓸 수 있습니다. 여기서 wc 는 파일명을 모르므로 숫자만 냈고, 그 숫자가 파일에 담겼습니다.',
  },
]
```

L1은 `safeRead`와 `trimEq`만 import한다. `safeReaddir`는 `check-helpers.ts`에 정의만 해두고 M2의 L3·L4 문제에서 쓴다 — 미리 import하면 `noUnusedLocals`가 잡는다.

- [ ] **Step 5: 등록표 갱신**

```ts
// src/game/problems/index.ts
import type { Problem } from '../types'
import { l1 } from './l1'

export const allProblems: Problem[] = [...l1]
```

- [ ] **Step 6: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell tests/problems.test.ts`
Expected: PASS — 4 + 10 + 10 + 10 + 10 = 44 tests.

`l1-08`이 실패하면 `ls`가 한 줄에 하나씩 내는지 확인하라. `l1-07`이 실패하면 `wc -l < file`이 파일명 없이 숫자만 내는지 확인하라.

- [ ] **Step 7: 커밋**

```bash
git add src/game tests/problems.test.ts
git commit -m "feat(game): problem verification harness and L1 exploration problems"
```

---

## Task 15: L2 문제 10개 — 조작과 리다이렉션

**Files:**
- Create: `src/game/problems/l2.ts`
- Modify: `src/game/problems/index.ts`
- Test: `tests/problems.test.ts` (수정 없음 — 자동으로 20문제를 돈다)

**Interfaces:**
- Consumes: `Problem` (Task 13), `safeRead`, `safeReaddir`, `trimEq` (Task 14)
- Produces: `allProblems`가 20개가 된다.

- [ ] **Step 1: L2 문제 작성**

```ts
// src/game/problems/l2.ts
import type { Problem } from '../types'
import { safeRead, trimEq } from '../check-helpers'

const HOME = '/home/player'

export const l2: Problem[] = [
  {
    id: 'l2-01',
    level: 2,
    title: '사본 만들기',
    prompt: 'config.ini 를 config.ini.bak 이라는 이름으로 복사하세요. 원본은 그대로 두어야 합니다.',
    setup: (fs) => { fs.writeFile(`${HOME}/config.ini`, 'port=8080\n') },
    hints: ['복사는 cp, 이동은 mv 입니다.'],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/config.ini`) === 'port=8080\n' &&
      safeRead(ctx.fs, `${HOME}/config.ini.bak`) === 'port=8080\n',
    solution: 'cp config.ini config.ini.bak',
    wrongAnswer: 'mv config.ini config.ini.bak',
    explanation: 'mv 를 썼다면 원본이 사라집니다. 백업의 목적은 원본을 남기는 것이므로 cp 여야 합니다. 이름이 비슷해서 자주 틀립니다.',
  },
  {
    id: 'l2-02',
    level: 2,
    title: '정리',
    prompt: 'archive 디렉터리를 만들고, old.log 를 그 안으로 옮기세요.',
    setup: (fs) => { fs.writeFile(`${HOME}/old.log`, 'stale\n') },
    hints: ['디렉터리를 만드는 명령은 mkdir 입니다.', '두 명령을 세미콜론으로 이어 한 줄에 쓸 수 있습니다.'],
    check: (ctx) =>
      ctx.fs.isDir(`${HOME}/archive`) &&
      safeRead(ctx.fs, `${HOME}/archive/old.log`) === 'stale\n' &&
      !ctx.fs.exists(`${HOME}/old.log`),
    solution: 'mkdir archive ; mv old.log archive',
    wrongAnswer: 'mkdir archive ; cp old.log archive',
    explanation: 'mv 의 대상이 이미 존재하는 디렉터리이면, 셸은 "그 디렉터리 안으로 넣으라"는 뜻으로 해석합니다. 대상이 없으면 이름을 바꾸는 것이 되고요. 같은 명령이 상황에 따라 다르게 행동합니다.',
  },
  {
    id: 'l2-03',
    level: 2,
    title: '통째로 복사',
    prompt: 'src 디렉터리를 하위 내용까지 전부 backup 이라는 이름으로 복사하세요.',
    setup: (fs) => {
      fs.mkdir(`${HOME}/src/lib`, { recursive: true })
      fs.writeFile(`${HOME}/src/main.js`, 'main\n')
      fs.writeFile(`${HOME}/src/lib/util.js`, 'util\n')
    },
    hints: ['cp 는 기본적으로 디렉터리를 거부합니다.', '재귀(recursive)를 뜻하는 짧은 플래그가 있습니다.'],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/backup/main.js`) === 'main\n' &&
      safeRead(ctx.fs, `${HOME}/backup/lib/util.js`) === 'util\n' &&
      ctx.fs.exists(`${HOME}/src/main.js`),
    solution: 'cp -r src backup',
    wrongAnswer: 'cp src backup',
    explanation: 'cp 는 기본적으로 파일 하나만 다룹니다. 디렉터리를 주면 "omitting directory" 라며 거부합니다. -r 은 recursive 이고, 대문자 -R 도 같은 뜻입니다.',
  },
  {
    id: 'l2-04',
    level: 2,
    title: '흔적 지우기',
    prompt: 'tmp 디렉터리와 그 안의 모든 것을 지우세요.',
    setup: (fs) => {
      fs.mkdir(`${HOME}/tmp/cache`, { recursive: true })
      fs.writeFile(`${HOME}/tmp/session`, 'x\n')
      fs.writeFile(`${HOME}/tmp/cache/blob`, 'y\n')
      fs.writeFile(`${HOME}/keep.txt`, 'keep\n')
    },
    hints: ['rm 은 기본적으로 디렉터리를 거부합니다.', 'cp 와 같은 플래그를 씁니다.'],
    check: (ctx) => !ctx.fs.exists(`${HOME}/tmp`) && ctx.fs.exists(`${HOME}/keep.txt`),
    solution: 'rm -r tmp',
    wrongAnswer: 'rm -r tmp keep.txt',
    explanation: 'rm -r 은 되돌릴 수 없습니다. 휴지통도 없습니다. 이 명령 앞에서 잠시 멈추는 습관이 경력을 구합니다. 특히 rm -rf 에 변수를 섞을 때는 그 변수가 빈 문자열일 가능성을 항상 의심하세요.',
  },
  {
    id: 'l2-05',
    level: 2,
    title: '기록하기',
    prompt: 'log.txt 파일을 만들고 그 안에 정확히 "boot ok" 한 줄만 넣으세요.',
    setup: () => {},
    hints: ['echo 의 출력을 파일로 돌리려면 > 를 씁니다.'],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/log.txt`), 'boot ok'),
    solution: 'echo "boot ok" > log.txt',
    wrongAnswer: 'touch log.txt',
    explanation: '> 는 파일을 열면서 즉시 비웁니다(truncate). 파일이 없으면 만들고, 있으면 내용을 날립니다. 그래서 실수로 중요한 파일에 > 를 쓰면 순식간에 사라집니다.',
  },
  {
    id: 'l2-06',
    level: 2,
    title: '덧붙이기',
    prompt: 'log.txt 에 이미 한 줄이 있습니다. 기존 내용을 지우지 말고 "shutdown" 을 다음 줄에 추가하세요.',
    setup: (fs) => { fs.writeFile(`${HOME}/log.txt`, 'boot ok\n') },
    hints: ['> 는 파일을 비우고 씁니다.', '비우지 않고 이어붙이는 연산자는 꺾쇠 두 개입니다.'],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/log.txt`) === 'boot ok\nshutdown\n',
    solution: 'echo shutdown >> log.txt',
    wrongAnswer: 'echo shutdown > log.txt',
    explanation: '> 와 >> 의 차이는 하나뿐입니다. > 는 truncate 하고 >> 는 append 합니다. 로그 파일을 다룰 때 이 하나를 틀리면 하루치 로그가 사라집니다.',
  },
  {
    id: 'l2-07',
    level: 2,
    title: '오류만 걸러내기',
    prompt: 'ghost.txt 는 존재하지 않습니다. cat 으로 읽되, 오류 메시지가 화면에 뜨지 않고 errors.log 에 저장되게 하세요.',
    setup: () => {},
    hints: [
      '표준출력과 표준오류는 다른 통로입니다.',
      '표준출력은 1번, 표준오류는 2번입니다.',
      '2> 로 표준오류만 파일로 보낼 수 있습니다.',
    ],
    check: (ctx) => {
      const log = safeRead(ctx.fs, `${HOME}/errors.log`)
      return log !== null && log.includes('No such file or directory') && ctx.lastResult.stderr === ''
    },
    solution: 'cat ghost.txt 2> errors.log',
    wrongAnswer: 'cat ghost.txt > errors.log',
    explanation: '> 는 사실 1> 의 줄임말입니다. 1번 파일 서술자, 즉 표준출력을 돌립니다. 오류 메시지는 2번으로 나가므로 > 로는 잡히지 않고 화면에 그대로 뜹니다. 2> 를 써야 합니다.',
  },
  {
    id: 'l2-08',
    level: 2,
    title: '실행 권한',
    prompt: 'deploy.sh 에 소유자 실행 권한을 부여하세요. 최종 권한은 755 여야 합니다.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/deploy.sh`, '#!/bin/bash\necho deploying\n')
      fs.chmod(`${HOME}/deploy.sh`, 0o644)
    },
    hints: ['권한을 바꾸는 명령은 chmod 입니다.', '8진수 세 자리로 rwx 를 표현합니다. r=4, w=2, x=1.'],
    check: (ctx) => ctx.fs.lstat(`${HOME}/deploy.sh`)?.mode === 0o755,
    solution: 'chmod 755 deploy.sh',
    wrongAnswer: 'chmod 644 deploy.sh',
    explanation: '755 는 소유자에게 rwx(4+2+1), 그룹과 나머지에게 r-x(4+1) 를 줍니다. chmod +x 도 실행 비트를 켜지만, 644 에서 시작하면 755 가 됩니다 — 이 문제에서는 둘 다 정답입니다.',
  },
  {
    id: 'l2-09',
    level: 2,
    title: '지름길',
    prompt: 'data/2026/reports 디렉터리를 한 번에 만드세요. 중간 디렉터리는 아직 없습니다.',
    setup: () => {},
    hints: ['mkdir 은 기본적으로 부모가 없으면 실패합니다.', 'parents 를 뜻하는 플래그가 있습니다.'],
    check: (ctx) => ctx.fs.isDir(`${HOME}/data/2026/reports`),
    solution: 'mkdir -p data/2026/reports',
    wrongAnswer: 'mkdir data/2026/reports',
    explanation: '-p 는 parents 입니다. 없는 중간 디렉터리를 전부 만들어 주고, 이미 있어도 오류를 내지 않습니다. 스크립트에서 "있으면 말고, 없으면 만들어" 를 표현하는 가장 짧은 방법입니다.',
  },
  {
    id: 'l2-10',
    level: 2,
    title: '수확',
    prompt: 'logs 디렉터리 안의 .log 파일들을 전부 합쳐 all.log 하나로 만드세요. 파일들이 사전순으로 이어져야 합니다.',
    setup: (fs) => {
      fs.mkdir(`${HOME}/logs`)
      fs.writeFile(`${HOME}/logs/a.log`, 'first\n')
      fs.writeFile(`${HOME}/logs/b.log`, 'second\n')
      fs.writeFile(`${HOME}/logs/c.log`, 'third\n')
      fs.writeFile(`${HOME}/logs/notes.md`, 'ignore me\n')
    },
    hints: [
      'cat 은 여러 파일을 인자로 받아 순서대로 이어붙입니다.',
      '글롭 logs/*.log 는 셸이 사전순으로 펼쳐줍니다.',
      '그 결과를 > 로 파일에 담으세요.',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/all.log`) === 'first\nsecond\nthird\n',
    solution: 'cat logs/*.log > all.log',
    wrongAnswer: 'cat logs/* > all.log',
    explanation: 'cat 의 이름이 concatenate 인 이유가 여기서 드러납니다. 그리고 셸은 글롭을 항상 사전순으로 정렬해 펼치므로 순서가 보장됩니다. notes.md 를 제외하려면 패턴을 *.log 로 좁혀야 합니다 — logs/* 는 그것까지 삼킵니다.',
  },
]
```

- [ ] **Step 2: 등록표 갱신**

```ts
// src/game/problems/index.ts
import type { Problem } from '../types'
import { l1 } from './l1'
import { l2 } from './l2'

export const allProblems: Problem[] = [...l1, ...l2]
```

- [ ] **Step 3: 테스트 실행**

Run: `npx vitest run --project shell tests/problems.test.ts`
Expected: PASS — 4 + 20 × 4 = 84 tests.

`l2-04`의 `wrongAnswer`(`rm -r tmp keep.txt`)가 `check`를 통과해 버리면 안 된다. 통과한다면 `check`가 `keep.txt`의 생존을 확인하지 않는다는 뜻이다. 이것이 정확히 음성 테스트가 잡아내려는 종류의 버그다.

- [ ] **Step 4: 전체 테스트 실행**

Run: `npm test`
Expected: PASS — 셸, 게임, 골든, UI 전부.

- [ ] **Step 5: 커밋**

```bash
git add src/game
git commit -m "feat(game): L2 problems on file manipulation and redirection"
```

---

## Task 16: 게임 상태와 UI 배선

**Files:**
- Create: `src/ui/store.ts`, `src/ui/HudCard.tsx`, `src/ui/RevealSheet.tsx`, `src/ui/LevelSelect.tsx`, `src/ui/Play.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/theme.css`
- Test: `src/ui/store.test.ts` (node 환경 — 스토어는 React를 모른다), `src/ui/Play.test.tsx`

**Interfaces:**
- Consumes: `Shell`, `commandNames` (Task 9), `createShellForProblem` (Task 13), `allProblems` (Task 15), `Progress` 함수들 (Task 13), `TermLine` (Task 2)
- Produces:

```ts
// src/ui/store.ts
export type Signal = 'idle' | 'wrong' | 'solved'

export interface GameStore {
  screen: 'levels' | 'play'
  progress: Progress
  problem: Problem | null
  shell: Shell | null
  lines: TermLine[]
  history: string[]
  status: 'playing' | 'solved'
  hintsShown: number
  signal: Signal

  openLevel(level: Level): void
  startProblem(id: string): void
  submit(line: string): Promise<void>
  revealHint(): void
  nextProblem(): void
  resetProblem(): void
  backToLevels(): void
  clearSignal(): void
  completions(partial: string): string[]
  prompt(): string
}
```

두 가지 규칙을 못박는다.

1. **`clear`와 `reset`은 셸 명령이 아니라 게임 명령이다.** `submit`이 셸에 넘기기 전에 가로챈다. 미구현 명령 목록에도 넣지 않는다 — 이것들은 실제로 동작하니까.
2. **오답 신호는 `exitCode !== 0`이다.** 자동 판정 게임에는 "제출"이 없으므로 "틀렸다"는 순간도 없다. 대신 명령이 실패하면 앰버로 물들고 짧게 글리치한다. 이 매핑은 정직하다 — 셸이 실패했다는 사실 그 자체를 보여줄 뿐이다.

- [ ] **Step 1: 실패하는 스토어 테스트 작성**

```ts
// src/ui/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useGame } from './store'
import { allProblems } from '../game/problems/index'

const get = () => useGame.getState()

beforeEach(() => {
  useGame.setState(useGame.getInitialState(), true)
})

describe('문제 진행', () => {
  it('문제를 시작하면 셸과 상태가 준비된다', () => {
    get().startProblem('l1-01')
    expect(get().problem?.id).toBe('l1-01')
    expect(get().shell).not.toBeNull()
    expect(get().status).toBe('playing')
    expect(get().screen).toBe('play')
  })

  it('정답 명령을 치면 solved 로 전이하고 진행도에 기록된다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    expect(get().status).toBe('solved')
    expect(get().signal).toBe('solved')
    expect(get().progress.solved).toContain('l1-01')
  })

  it('틀린 명령은 solved 로 가지 않는다', async () => {
    get().startProblem('l1-01')
    await get().submit('ls')
    expect(get().status).toBe('playing')
  })

  it('실패한 명령은 wrong 신호를 낸다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    expect(get().signal).toBe('wrong')
  })

  it('성공했지만 정답이 아닌 명령은 아무 신호도 내지 않는다', async () => {
    get().startProblem('l1-01')
    await get().submit('ls')
    expect(get().signal).toBe('idle')
  })

  it('solved 이후에는 다시 판정하지 않는다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    await get().submit('cat nope.txt')
    expect(get().status).toBe('solved')
  })

  it('stdout 은 green, stderr 는 amber 로 그려진다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat nope.txt')
    const tones = get().lines.map((l) => l.tone)
    expect(tones).toContain('amber')
  })
})

describe('게임 명령', () => {
  it('clear 는 화면만 지우고 셸은 유지한다', async () => {
    get().startProblem('l1-03')
    await get().submit('cd vault')
    await get().submit('clear')
    expect(get().lines).toEqual([])
    expect(get().shell!.cwd).toBe('/home/player/vault')
  })

  it('reset 은 문제를 초기 상태로 되돌린다', async () => {
    get().startProblem('l1-03')
    await get().submit('cd vault')
    get().resetProblem()
    expect(get().shell!.cwd).toBe('/home/player')
    expect(get().status).toBe('playing')
  })

  it('rm -rf 로 세계를 지운 뒤 reset 하면 복구된다', async () => {
    get().startProblem('l1-01')
    await get().submit('rm -rf readme.txt')
    get().resetProblem()
    expect(get().shell!.fs.exists('/home/player/readme.txt')).toBe(true)
  })
})

describe('힌트', () => {
  it('처음에는 아무 힌트도 안 보인다', () => {
    get().startProblem('l1-01')
    expect(get().hintsShown).toBe(0)
  })

  it('요청할 때마다 하나씩 늘어나고 힌트 수를 넘지 않는다', () => {
    get().startProblem('l1-01')
    const total = get().problem!.hints.length
    for (let i = 0; i < total + 3; i++) get().revealHint()
    expect(get().hintsShown).toBe(total)
  })

  it('힌트를 보면 진행도에 기록된다', () => {
    get().startProblem('l1-01')
    get().revealHint()
    expect(get().progress.hintsUsed).toContain('l1-01')
  })
})

describe('프롬프트와 자동완성', () => {
  it('홈에서는 ~ 로 표시한다', () => {
    get().startProblem('l1-01')
    expect(get().prompt()).toBe('player@flashshell:~$ ')
  })

  it('하위 디렉터리는 ~/ 로 표시한다', async () => {
    get().startProblem('l1-03')
    await get().submit('cd vault')
    expect(get().prompt()).toBe('player@flashshell:~/vault$ ')
  })

  it('첫 단어는 명령 이름을 완성한다', () => {
    get().startProblem('l1-01')
    expect(get().completions('ec')).toContain('echo')
  })

  it('두 번째 단어부터는 파일 이름을 완성한다', () => {
    get().startProblem('l1-01')
    expect(get().completions('read')).toContain('readme.txt')
  })
})

describe('다음 문제', () => {
  it('같은 레벨의 다음 문제로 넘어간다', async () => {
    get().startProblem('l1-01')
    await get().submit('cat readme.txt')
    get().nextProblem()
    expect(get().problem?.id).toBe('l1-02')
  })

  it('레벨의 마지막 문제에서는 레벨 선택으로 돌아간다', async () => {
    const last = allProblems.filter((p) => p.level === 1).at(-1)!
    get().startProblem(last.id)
    get().nextProblem()
    expect(get().screen).toBe('levels')
  })
})
```

- [ ] **Step 2: `vitest.config.ts` 의 shell 프로젝트에 `src/ui/store.test.ts` 를 넣는다**

스토어는 React를 import하지 않으므로 node에서 돈다. `zustand/vanilla`의 `createStore`가 아니라 `zustand`의 `create`를 쓰면 React를 끌고 오지만, `create`는 `useSyncExternalStore`만 쓰므로 node에서도 `getState`/`setState`는 문제없이 동작한다. include 패턴에 추가한다.

```ts
test: {
  name: 'shell',
  environment: 'node',
  include: ['src/shell/**/*.test.ts', 'src/game/**/*.test.ts', 'src/ui/store.test.ts', 'tests/**/*.test.ts'],
},
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/ui/store.test.ts`
Expected: FAIL — "Failed to resolve import ./store"

- [ ] **Step 4: `store.ts` 구현**

```ts
// src/ui/store.ts
import { create } from 'zustand'
import type { Shell } from '../shell/types'
import { commandNames } from '../shell/index'
import { allProblems } from '../game/problems/index'
import { createShellForProblem, PLAYER_HOME } from '../game/harness'
import {
  loadProgress, saveProgress, markSolved, markHintUsed, type Progress,
} from '../game/progress'
import type { Level, Problem } from '../game/types'
import type { TermLine } from './Terminal'

export type Signal = 'idle' | 'wrong' | 'solved'

export interface GameStore {
  screen: 'levels' | 'play'
  progress: Progress
  problem: Problem | null
  shell: Shell | null
  lines: TermLine[]
  history: string[]
  status: 'playing' | 'solved'
  hintsShown: number
  signal: Signal

  openLevel(level: Level): void
  startProblem(id: string): void
  submit(line: string): Promise<void>
  revealHint(): void
  nextProblem(): void
  resetProblem(): void
  backToLevels(): void
  clearSignal(): void
  completions(partial: string): string[]
  prompt(): string
}

function toLines(text: string, tone: TermLine['tone']): TermLine[] {
  if (text === '') return []
  return text.replace(/\n$/, '').split('\n').map((t) => ({ text: t, tone }))
}

export const useGame = create<GameStore>((set, get) => ({
  screen: 'levels',
  progress: loadProgress(),
  problem: null,
  shell: null,
  lines: [],
  history: [],
  status: 'playing',
  hintsShown: 0,
  signal: 'idle',

  openLevel: (level) => {
    const first = allProblems.find((p) => p.level === level)
    if (first) get().startProblem(first.id)
  },

  startProblem: (id) => {
    const problem = allProblems.find((p) => p.id === id)
    if (!problem) return
    set({
      screen: 'play',
      problem,
      shell: createShellForProblem(problem),
      lines: [],
      history: [],
      status: 'playing',
      hintsShown: 0,
      signal: 'idle',
    })
  },

  submit: async (line) => {
    const { shell, problem, status, prompt } = get()
    if (!shell || !problem) return

    const trimmed = line.trim()
    if (trimmed === 'clear') { set({ lines: [] }); return }
    if (trimmed === 'reset') { get().resetProblem(); return }

    const echoed: TermLine = { text: `${prompt()}${line}`, tone: 'dim' }
    if (trimmed === '') { set((s) => ({ lines: [...s.lines, echoed] })); return }

    const result = await shell.exec(trimmed)
    const history = [...get().history, trimmed]

    set((s) => ({
      lines: [...s.lines, echoed, ...toLines(result.stdout, 'green'), ...toLines(result.stderr, 'amber')],
      history,
    }))

    // 이미 풀었으면 다시 판정하지 않는다. 사용자가 계속 놀 수 있게 둔다.
    if (status === 'solved') return

    let solved = false
    try {
      solved = problem.check({ fs: shell.fs, lastResult: result, history, cwd: shell.cwd })
    } catch (error) {
      // 출제자의 버그가 플레이어의 크래시가 되어서는 안 된다.
      console.warn(`check() threw for ${problem.id}`, error)
    }

    if (solved) {
      const progress = markSolved(get().progress, problem.id)
      saveProgress(progress)
      set({ status: 'solved', signal: 'solved', progress })
      return
    }

    set({ signal: result.exitCode === 0 ? 'idle' : 'wrong' })
  },

  revealHint: () => {
    const { problem, hintsShown, progress } = get()
    if (!problem || hintsShown >= problem.hints.length) return
    const next = markHintUsed(progress, problem.id)
    saveProgress(next)
    set({ hintsShown: hintsShown + 1, progress: next })
  },

  nextProblem: () => {
    const { problem } = get()
    if (!problem) return
    const siblings = allProblems.filter((p) => p.level === problem.level)
    const index = siblings.findIndex((p) => p.id === problem.id)
    const next = siblings[index + 1]
    if (next) get().startProblem(next.id)
    else get().backToLevels()
  },

  resetProblem: () => {
    const { problem } = get()
    if (!problem) return
    set({
      shell: createShellForProblem(problem),
      lines: [],
      history: [],
      status: 'playing',
      signal: 'idle',
    })
  },

  backToLevels: () => set({ screen: 'levels', problem: null, shell: null, lines: [] }),

  clearSignal: () => set((s) => (s.signal === 'wrong' ? { signal: 'idle' } : s)),

  completions: (partial) => {
    const { shell } = get()
    if (!shell) return []
    // 첫 단어인지 아닌지는 Terminal 이 잘라서 준 partial 만으로는 알 수 없다.
    // 명령 이름과 파일 이름을 모두 후보로 내고, 사용자가 고르게 한다.
    const names = commandNames().filter((n) => n.startsWith(partial))
    let files: string[] = []
    try { files = shell.fs.readdir(shell.cwd).filter((n) => n.startsWith(partial)) } catch { files = [] }
    return [...new Set([...names, ...files])].sort()
  },

  prompt: () => {
    const { shell } = get()
    if (!shell) return '$ '
    const cwd = shell.cwd === PLAYER_HOME
      ? '~'
      : shell.cwd.startsWith(`${PLAYER_HOME}/`)
        ? `~${shell.cwd.slice(PLAYER_HOME.length)}`
        : shell.cwd
    return `player@flashshell:${cwd}$ `
  },
}))
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npx vitest run --project shell src/ui/store.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 6: `HudCard.tsx` 작성**

```tsx
// src/ui/HudCard.tsx
import { useState } from 'react'
import { useGame } from './store'

const DIFFICULTY = ['◆◇◇◇◇', '◆◆◇◇◇', '◆◆◆◇◇', '◆◆◆◆◇', '◆◆◆◆◆']

export function HudCard() {
  const problem = useGame((s) => s.problem)
  const hintsShown = useGame((s) => s.hintsShown)
  const revealHint = useGame((s) => s.revealHint)
  const backToLevels = useGame((s) => s.backToLevels)
  const solvedCount = useGame((s) => s.progress.solved.length)
  const [collapsed, setCollapsed] = useState(false)

  if (!problem) return null
  const hasMoreHints = hintsShown < problem.hints.length

  return (
    <div className={`hud${collapsed ? ' hud-collapsed' : ''}`}>
      <div className="hud-meta">
        <span className="hud-diff">{DIFFICULTY[problem.level - 1]} LEVEL {problem.level}</span>
        <span className="hud-count">{solvedCount}/20 SOLVED</span>
        <button
          className="hud-fold"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '문제 카드 펼치기' : '문제 카드 접기'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▼' : '▲'}
        </button>
        <button className="hud-exit" onClick={backToLevels}>← LEVELS</button>
      </div>

      {!collapsed && (
        <>
          <h2 className="hud-title">{problem.title}</h2>
          <p className="hud-prompt">{problem.prompt}</p>

          {problem.hints.slice(0, hintsShown).map((hint, i) => (
            <p key={i} className="hud-hint">▸ {hint}</p>
          ))}

          {hasMoreHints && (
            <button className="hud-hint-button" onClick={revealHint}>
              {hintsShown === 0 ? 'HINT' : `HINT ${hintsShown + 1}/${problem.hints.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 7: `RevealSheet.tsx` 작성**

```tsx
// src/ui/RevealSheet.tsx
import { useGame } from './store'

export function RevealSheet() {
  const problem = useGame((s) => s.problem)
  const status = useGame((s) => s.status)
  const nextProblem = useGame((s) => s.nextProblem)

  if (!problem || status !== 'solved') return null

  return (
    <div className="sheet" role="dialog" aria-label="해설">
      <div className="sheet-header">[ SOLVED ]</div>

      <div className="sheet-label">모범답안</div>
      <pre className="sheet-code">{problem.solution}</pre>

      <div className="sheet-label">해설</div>
      <p className="sheet-body">{problem.explanation}</p>

      <button className="sheet-next" onClick={nextProblem} autoFocus>NEXT ▸</button>
    </div>
  )
}
```

`autoFocus`가 중요하다. 정답을 맞히면 포커스가 터미널 입력에서 NEXT 버튼으로 옮겨가므로, 엔터를 한 번 더 치면 다음 문제로 넘어간다. 손이 키보드를 떠나지 않는다.

- [ ] **Step 8: `LevelSelect.tsx` 작성**

```tsx
// src/ui/LevelSelect.tsx
import { useGame } from './store'
import { allProblems } from '../game/problems/index'
import { isLevelUnlocked, solvedInLevel, UNLOCK_THRESHOLD } from '../game/progress'
import type { Level } from '../game/types'

const LEVELS: { level: Level; name: string; topic: string }[] = [
  { level: 1, name: '탐색', topic: 'ls · cd · cat · head · tail' },
  { level: 2, name: '조작', topic: 'cp · mv · mkdir · 리다이렉션' },
  { level: 3, name: '텍스트 처리', topic: 'grep · sed · awk · 파이프' },
  { level: 4, name: '시스템', topic: 'find · xargs · chmod' },
  { level: 5, name: '스크립팅', topic: 'if · for · while · 함수' },
]

export function LevelSelect() {
  const progress = useGame((s) => s.progress)
  const openLevel = useGame((s) => s.openLevel)

  return (
    <div className="levels">
      <h1 className="levels-title">FLASHSHELL</h1>
      <p className="levels-sub">명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.</p>

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
                <span className="level-name">{name}</span>
                <span className="level-topic">{topic}</span>
                <span className="level-status">
                  {total === 0
                    ? 'COMING SOON'
                    : unlocked
                      ? `${solved}/${total}`
                      : `LOCKED — 이전 레벨 ${UNLOCK_THRESHOLD}문제 필요`}
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

레벨 3·4·5는 M1에서 문제가 0개다. `total === 0`이면 `COMING SOON`으로 표시하고 비활성화한다. `isLevelUnlocked`만 믿으면 레벨 1을 8개 푼 사용자가 빈 레벨 2에 들어가 크래시한다 — 아니, L2는 있으니 레벨 3이다. 어느 쪽이든 빈 레벨 진입을 막아야 한다.

- [ ] **Step 9: `Play.tsx` 와 `App.tsx` 작성**

```tsx
// src/ui/Play.tsx
import { useGame } from './store'
import { Terminal } from './Terminal'
import { HudCard } from './HudCard'
import { RevealSheet } from './RevealSheet'

export function Play() {
  const lines = useGame((s) => s.lines)
  const submit = useGame((s) => s.submit)
  const completions = useGame((s) => s.completions)
  const prompt = useGame((s) => s.prompt())
  const status = useGame((s) => s.status)

  return (
    <>
      <Terminal
        lines={lines}
        prompt={prompt}
        onSubmit={(line) => { void submit(line) }}
        completions={completions}
        disabled={status === 'solved'}
      />
      <HudCard />
      <RevealSheet />
    </>
  )
}
```

```tsx
// src/ui/App.tsx
import { useGame } from './store'
import { Crt } from './Crt'
import { Play } from './Play'
import { LevelSelect } from './LevelSelect'

export function App() {
  const screen = useGame((s) => s.screen)
  return <Crt>{screen === 'levels' ? <LevelSelect /> : <Play />}</Crt>
}
```

- [ ] **Step 10: 레이아웃 CSS 추가**

터미널은 화면 전체이고, HUD와 시트는 그 위에 뜬다.

```css
/* src/ui/theme.css 에 이어붙인다 */

.hud {
  position: absolute;
  top: 1rem; left: 1rem; right: 1rem;
  z-index: 2;
  padding: 0.9rem 1.1rem;
  background: rgba(10, 16, 8, 0.86);
  border: 1px solid #2f4a24;
  backdrop-filter: blur(3px);
  color: var(--phos-green);
}
.hud-meta { display: flex; gap: 1rem; align-items: center; font-size: 0.65rem; letter-spacing: 0.24em; }
.hud-diff { color: var(--phos-amber); }
.hud-count { color: var(--phos-dim); margin-left: auto; }
.hud-fold,
.hud-exit { background: none; border: 1px solid #2f4a24; color: var(--phos-dim); font: inherit; padding: 0.15rem 0.5rem; cursor: pointer; }
.hud-collapsed { padding-bottom: 0.55rem; }
.hud-title { margin: 0.55rem 0 0.2rem; font-size: 1rem; text-shadow: var(--glow-green); }
.hud-prompt { margin: 0; line-height: 1.55; color: #b6e08a; }
.hud-hint { margin: 0.45rem 0 0; color: var(--phos-amber); text-shadow: var(--glow-amber); font-size: 0.9rem; }
.hud-hint-button { margin-top: 0.7rem; background: none; border: 1px solid var(--phos-amber); color: var(--phos-amber); font: inherit; font-size: 0.7rem; letter-spacing: 0.18em; padding: 0.25rem 0.75rem; cursor: pointer; }

.sheet {
  position: absolute;
  left: 1rem; right: 1rem; bottom: 0;
  z-index: 3;
  padding: 1rem 1.2rem 1.2rem;
  background: rgba(10, 16, 8, 0.96);
  border: 1px solid var(--phos-green);
  border-bottom: 0;
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.7);
  color: #9fd47a;
  animation: sheet-rise 260ms ease-out;
  max-height: 60vh;
  overflow-y: auto;
}
@keyframes sheet-rise { from { transform: translateY(100%); } to { transform: translateY(0); } }

.sheet-header { color: var(--phos-green); text-shadow: var(--glow-green); letter-spacing: 0.24em; font-size: 0.75rem; }
.sheet-label { color: var(--phos-dim); font-size: 0.65rem; letter-spacing: 0.2em; margin-top: 0.8rem; }
.sheet-code { margin: 0.3rem 0 0; padding: 0.55rem 0.7rem; background: var(--phos-bg); border: 1px solid #2f4a24; color: var(--phos-green); overflow-x: auto; }
.sheet-body { margin: 0.3rem 0 0; line-height: 1.65; }
.sheet-next { margin-top: 1rem; background: none; border: 1px solid var(--phos-green); color: var(--phos-green); font: inherit; letter-spacing: 0.18em; padding: 0.3rem 1rem; cursor: pointer; }

/* HUD가 터미널 상단을 가리므로 스크롤백에 여백을 준다 */
.terminal { padding-top: 11rem; }

.levels { position: relative; z-index: 2; max-width: 46rem; margin: 0 auto; padding: 4rem 1.5rem; color: var(--phos-green); }
.levels-title { letter-spacing: 0.35em; text-shadow: var(--glow-green); }
.levels-sub { color: var(--phos-dim); }
.levels-list { list-style: none; padding: 0; display: grid; gap: 0.6rem; margin-top: 2rem; }
.level { display: grid; grid-template-columns: 6rem 8rem 1fr auto; gap: 1rem; align-items: baseline; width: 100%; text-align: left; padding: 0.85rem 1rem; background: rgba(10, 16, 8, 0.8); border: 1px solid #2f4a24; color: var(--phos-green); font: inherit; cursor: pointer; }
.level:hover:not(:disabled) { border-color: var(--phos-green); box-shadow: 0 0 14px rgba(78, 224, 106, 0.18); }
.level-locked { color: var(--phos-dim); cursor: not-allowed; }
.level-num { font-size: 0.7rem; letter-spacing: 0.2em; color: var(--phos-amber); }
.level-locked .level-num { color: var(--phos-dim); }
.level-topic { color: var(--phos-dim); font-size: 0.8rem; }
.level-status { font-size: 0.7rem; letter-spacing: 0.12em; }

@media (prefers-reduced-motion: reduce) {
  .sheet { animation: none; }
}
```

- [ ] **Step 11: 통합 UI 테스트 작성**

```tsx
// src/ui/Play.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { App } from './App'
import { useGame } from './store'

beforeEach(() => {
  // jsdom 은 테스트 사이에 저장소를 비우지 않는다. 진행도가 누적되면
  // "잠긴 레벨" 테스트가 앞 테스트의 성공 때문에 깨진다.
  localStorage.clear()
  useGame.setState(useGame.getInitialState(), true)
})

describe('한 문제를 끝까지 푼다', () => {
  it('레벨 1을 열고, 문제를 풀고, 해설을 본다', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    expect(screen.getByText('첫 접속')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox'), 'cat readme.txt{Enter}')

    expect(await screen.findByRole('dialog', { name: '해설' })).toBeInTheDocument()
    expect(screen.getByText('[ SOLVED ]')).toBeInTheDocument()
    expect(screen.getByText('cat readme.txt')).toBeInTheDocument()
  })

  it('힌트는 요청해야 나온다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    expect(screen.queryByText(/ls 입니다/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'HINT' }))
    expect(screen.getByText(/ls 입니다/)).toBeInTheDocument()
  })

  it('잠긴 레벨은 누를 수 없다', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /LEVEL 3/ })).toBeDisabled()
  })

  it('HUD 를 접으면 지문이 사라지고 터미널이 드러난다', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await userEvent.click(screen.getByRole('button', { name: '문제 카드 접기' }))
    expect(screen.queryByText('첫 접속')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '문제 카드 펼치기' }))
    expect(screen.getByText('첫 접속')).toBeInTheDocument()
  })
})
```

- [ ] **Step 12: 테스트 실행해 통과 확인**

Run: `npx vitest run`
Expected: PASS — 전부.

- [ ] **Step 13: 눈으로 확인**

Run: `npm run dev`
Expected: 레벨 선택 화면이 뜬다. LEVEL 1을 누르면 HUD가 뜨고 터미널이 살아난다. `cat readme.txt`를 치면 바텀시트가 아래에서 올라온다.

- [ ] **Step 14: 커밋**

```bash
git add src/ui
git commit -m "feat(ui): game store, HUD card, reveal sheet, and level select"
```

---

## Task 17: Dual Phosphor 시그널과 오답 글리치

색은 이미 다 썼다. 녹색과 앰버 둘뿐이다. 이 태스크는 그 둘을 정보 전달에 쓰고, 오답 순간에만 120ms의 신호 왜곡을 얹는다.

**밝기만으로 정보를 전달하지 않는다.** 글리치를 끈 사용자(`prefers-reduced-motion`)도, 색을 구분 못 하는 사용자도 게임을 할 수 있어야 한다. 그래서 오답은 세 가지로 동시에 말한다: 앰버 색, 글리치, 그리고 stderr 텍스트 그 자체.

**Files:**
- Create: `src/ui/useSignal.ts`
- Modify: `src/ui/Crt.tsx`, `src/ui/theme.css`
- Test: `src/ui/signal.test.tsx`

**Interfaces:**
- Consumes: `useGame`, `Signal` (Task 16)
- Produces:
  - `Crt`가 `signal` 값에 따라 `signal-wrong` / `signal-solved` 클래스를 붙인다.
  - `useSignal(): Signal` — 120ms 뒤 `wrong`을 자동으로 `idle`로 되돌린다. `solved`는 되돌리지 않는다(시트가 떠 있는 동안 유지).

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// src/ui/signal.test.tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { App } from './App'
import { useGame } from './store'

beforeEach(() => {
  localStorage.clear()
  useGame.setState(useGame.getInitialState(), true)
})
afterEach(() => { vi.useRealTimers() })

describe('시그널', () => {
  it('실패한 명령은 crt 에 signal-wrong 을 붙인다', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await user.type(screen.getByRole('textbox'), 'cat nope.txt{Enter}')

    expect(document.querySelector('.crt')).toHaveClass('signal-wrong')
  })

  it('signal-wrong 은 120ms 뒤에 사라진다', async () => {
    // 가짜 타이머는 반드시 userEvent.setup() 보다 먼저 켜야 한다.
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App />)
    await user.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await user.type(screen.getByRole('textbox'), 'cat nope.txt{Enter}')

    act(() => { vi.advanceTimersByTime(200) })
    expect(document.querySelector('.crt')).not.toHaveClass('signal-wrong')
  })

  it('정답은 signal-solved 를 붙이고 유지한다', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await user.type(screen.getByRole('textbox'), 'cat readme.txt{Enter}')

    expect(document.querySelector('.crt')).toHaveClass('signal-solved')
  })

  it('성공했지만 정답이 아닌 명령은 아무 클래스도 안 붙인다', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await user.type(screen.getByRole('textbox'), 'ls{Enter}')

    const crt = document.querySelector('.crt')!
    expect(crt).not.toHaveClass('signal-wrong')
    expect(crt).not.toHaveClass('signal-solved')
  })

  it('stderr 는 색과 무관하게 텍스트로도 읽힌다', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /LEVEL 1/ }))
    await user.type(screen.getByRole('textbox'), 'cat nope.txt{Enter}')

    expect(screen.getByText(/No such file or directory/)).toBeInTheDocument()
  })
})
```

마지막 테스트가 접근성 제약을 코드로 못박는다. 색이 사라져도 정보는 남는다.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project ui src/ui/signal.test.tsx`
Expected: FAIL — `signal-wrong` 클래스 없음.

- [ ] **Step 3: `useSignal.ts` 작성**

```ts
// src/ui/useSignal.ts
import { useEffect } from 'react'
import { useGame } from './store'

export const GLITCH_MS = 120

/** wrong 신호는 짧게 스치고 사라진다. solved 는 시트가 떠 있는 동안 남는다. */
export function useSignal() {
  const signal = useGame((s) => s.signal)
  const clearSignal = useGame((s) => s.clearSignal)

  useEffect(() => {
    if (signal !== 'wrong') return
    const timer = setTimeout(clearSignal, GLITCH_MS)
    return () => clearTimeout(timer)
  }, [signal, clearSignal])

  return signal
}
```

- [ ] **Step 4: `Crt.tsx` 수정**

```tsx
// src/ui/Crt.tsx
import type { ReactNode } from 'react'
import './theme.css'
import { useSignal } from './useSignal'

export function Crt({ children }: { children: ReactNode }) {
  const signal = useSignal()
  const modifier = signal === 'idle' ? '' : ` signal-${signal}`
  return (
    <div className={`crt${modifier}`}>
      {children}
      <div className="crt-tear" aria-hidden="true" />
    </div>
  )
}
```

`.crt-tear`는 항상 DOM에 있고 평소엔 투명하다. 오답 순간에만 애니메이션이 붙는다. 노드를 붙였다 뗐다 하면 애니메이션 시작이 한 프레임 늦는다.

- [ ] **Step 5: 글리치 CSS 추가**

```css
/* src/ui/theme.css 에 이어붙인다 */

/* 평소엔 보이지 않는다. */
.crt-tear {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  z-index: 4;
  background: repeating-linear-gradient(
    180deg,
    transparent 0 3px,
    rgba(255, 59, 59, 0.10) 3px 4px,
    transparent 4px 7px,
    rgba(0, 229, 255, 0.08) 7px 8px
  );
}

/* 오답: 화면이 찢어지고 인광이 앰버로 흔들린다. */
.signal-wrong .crt-tear {
  animation: tear 120ms steps(3, end) 1;
}
.signal-wrong .terminal {
  animation: aberrate 120ms steps(3, end) 1;
}

@keyframes tear {
  0%   { opacity: 0; transform: translateY(0); }
  33%  { opacity: 1; transform: translateY(-3px); }
  66%  { opacity: 1; transform: translateY(2px); }
  100% { opacity: 0; transform: translateY(0); }
}

@keyframes aberrate {
  0%   { transform: translateX(0); filter: none; }
  33%  { transform: translateX(-2px); filter: drop-shadow(2px 0 0 rgba(255, 59, 59, 0.55)); }
  66%  { transform: translateX(2px);  filter: drop-shadow(-2px 0 0 rgba(0, 229, 255, 0.45)); }
  100% { transform: translateX(0); filter: none; }
}

/* 정답: 인광이 한 번 타오른다. */
.signal-solved .terminal { animation: bloom 420ms ease-out 1; }

@keyframes bloom {
  0%   { text-shadow: var(--glow-green); }
  25%  { text-shadow: 0 0 18px rgba(78, 224, 106, 0.95), 0 0 40px rgba(78, 224, 106, 0.45); }
  100% { text-shadow: var(--glow-green); }
}

/* 전정 감각에 민감한 사용자에게는 흔들림이 해롭다. 색과 텍스트만 남긴다. */
@media (prefers-reduced-motion: reduce) {
  .signal-wrong .crt-tear,
  .signal-wrong .terminal,
  .signal-solved .terminal { animation: none; }
}
```

- [ ] **Step 6: 테스트 실행해 통과 확인**

Run: `npx vitest run --project ui`
Expected: PASS — 12 tests.

- [ ] **Step 7: 눈으로 확인**

Run: `npm run dev`
Expected: `cat nope.txt`를 치면 화면이 아주 잠깐 찢어지고 앰버 오류 줄이 뜬다. `cat readme.txt`를 치면 인광이 한 번 타오르고 시트가 올라온다. 시스템 설정에서 "동작 줄이기"를 켜면 흔들림은 사라지고 색과 글자만 남는다.

- [ ] **Step 8: 커밋**

```bash
git add src/ui
git commit -m "feat(ui): dual phosphor signals with reduced-motion-safe glitch"
```

---

## Task 18: Playwright 스모크 (M1 완료)

단위 테스트가 84개 있어도, 진짜 브라우저에서 앱이 뜨는지는 아무도 모른다. 스모크 하나가 그것을 본다.

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: 빌드된 앱 (`npm run dev`)
- Produces: `npm run e2e`

- [ ] **Step 1: Playwright 설정**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

```bash
npx playwright install chromium
```

- [ ] **Step 2: 스모크 테스트 작성**

```ts
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test'

test('한 문제를 실제 브라우저에서 푼다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await expect(page.getByText('FLASHSHELL')).toBeVisible()

  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await expect(page.getByText('첫 접속')).toBeVisible()

  await page.getByRole('textbox').fill('cat readme.txt')
  await page.getByRole('textbox').press('Enter')

  const sheet = page.getByRole('dialog', { name: '해설' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('cat readme.txt')).toBeVisible()

  await sheet.getByRole('button', { name: 'NEXT ▸' }).click()
  await expect(page.getByText('숨겨진 것')).toBeVisible()
})

test('진행도가 새로고침을 넘어 살아남는다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await page.getByRole('textbox').fill('cat readme.txt')
  await page.getByRole('textbox').press('Enter')
  await expect(page.getByRole('dialog', { name: '해설' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('button', { name: /LEVEL 1/ })).toContainText('1/10')
})
```

- [ ] **Step 3: 실행**

Run: `npm run e2e`
Expected: PASS — 2 tests.

- [ ] **Step 4: 전체 검증**

Run: `npm run build && npm test && npm run e2e`
Expected: 타입 에러 0개. 단위 테스트 전부 통과. e2e 2개 통과.

- [ ] **Step 5: 커밋**

```bash
git add playwright.config.ts e2e package.json
git commit -m "test(e2e): playwright smoke covering a full solve and progress persistence"
```

**M1 완료.** 게임이 플레이 가능하다. 여기서 멈추고 사용자 테스트를 받는다.

---

## 완료 조건

- `npm run build` — 타입 에러 0개
- `npm test` — 셸 단위 테스트, 골든 테스트 9개, 문제 테스트 84개, UI 테스트 전부 통과
- `npm run e2e` — 스모크 2개 통과
- `npm run dev` — 레벨 1과 2를 실제로 끝까지 플레이할 수 있다

## M2로 넘길 것

M1이 검증된 뒤 별도 계획으로 작성한다.

- 2층 엔진: `if` / `for` / `while` / `case`, 함수, `test` 와 `[`, 위치인자, `source`, shebang 실행
- 코어유틸 추가: `sed`, `awk`, `cut`, `tr`, `uniq`, `find`, `xargs`, `diff`, `tee`, `basename`, `dirname`, `seq`, `du`
- L3(텍스트 처리), L4(시스템), L5(스크립팅) 문제 30개
- `registry.ts`의 `KNOWN_UNIMPLEMENTED`에서 새로 구현한 명령을 지운다

