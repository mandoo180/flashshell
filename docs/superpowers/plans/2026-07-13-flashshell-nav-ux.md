# FlashShell 문제 네비게이션/진행 UX 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로 태스크별 실행. 스텝은 체크박스(`- [ ]`).

**Goal:** 스펙 `docs/superpowers/specs/2026-07-13-flashshell-navigation-design.md`(승인됨)의 세 요구를 구현 — ① RESET 버튼(문제 초기화), ② HUD ◂/▸로 해금 범위 내 이동, ③ 레벨 진입 시 프런티어(첫 미해결) 착지.

**Architecture:** 접근 A(스토어-파생 미니멀). game 층에 순수 프런티어 헬퍼 → 스토어의 `openLevel` 착지 변경 + 이동 액션 2개(기존 `startProblem` 재사용) → HUD에 네비 UI. 스토리지 스키마(`flashshell.progress.v1`) 무변경, 세션 직렬화 큐 불변식 유지.

**Tech Stack:** React 19 + Zustand 5 + TS(strict), Vitest(ui=jsdom), Playwright.

**Base:** 브랜치 `worktree-flashshell-nav-ux`, base `214f48e`(main, 스펙 커밋). 베이스라인 1724 단위 + 6 e2e + 39 골든 초록.

## Global Constraints

- **스토리지 스키마 무변경:** `flashshell.progress.v1` = `{ solved: string[], hintsUsed: string[] }` 그대로. 새 필드 금지.
- **세션 불변식:** 세션은 스토어 수명 동안 1개, 절대 재생성/null 금지(store.ts:90-103 주석). 모든 전환은 직렬화 큐를 탄 `startProblem`/`resetProblem` 호출로만.
- **기존 핀 테스트 무변경 통과:** smoke.spec(레벨 1 → "첫 접속"), hud.spec(375px HUD 비겹침), store.test(NEXT 끝 → levels), Play.test(`[ SOLVED ]` 시트 헤더). 기존 테스트 파일의 기대값을 바꾸면 안 됨 — 바꿔야 통과한다면 구현이 틀린 것.
- **Phosphor 테마:** 색은 `theme.css` `:root` 변수만, 밝기 단독 신호 금지(배지는 텍스트+기호), 신규 애니메이션 없음(`prefers-reduced-motion` 하 무동작), 새 버튼도 기존 `:focus-visible` 규칙 그룹에 포함.
- **접근성 이름 충돌 금지:** HUD 이동 버튼 aria-label `이전 문제`/`다음 문제`(해설 시트 `NEXT ▸`와 구분). HUD 배지 텍스트는 `✓ SOLVED` — RevealSheet의 `[ SOLVED ]`(RevealSheet.tsx:12, Play.test가 exact 매치로 핀)와 충돌하지 않는 문자열이어야 함.
- **`check(ctx)`는 fs/lastResult만**(불변) — 이 작업은 check에 영향 없음. 엔진(`src/shell/**`) 무변경.
- 각 태스크 끝: `npx tsc --noEmit` clean + 전체 `npm test` 초록(≥1724 유지).

## 시임 맵 (base 214f48e 실측)

- **store.ts:** `openLevel`(:81-84, `allProblems.find(first)` → startProblem), `startProblem`(:86-124, 큐 직렬화·terminal 클리어·`hintsShown:0`·`status:'playing'`), `nextProblem`(:176-184, siblings=`allProblems.filter(level)` index+1, 끝→`backToLevels`), `resetProblem`(:186-202, `session.reset()`·**hintsShown 안 건드림**·타이핑 `reset`이 :132에서 호출), `GameStore` 인터페이스(:31-59). 테스트 시딩: `useGame.setState({ progress: {...} })` 직접 주입 가능(모듈 재임포트 불필요 — store.test.ts:8-14 패턴 `setSessionFactory(() => new LocalShellSession())` + `useGame.setState(useGame.getInitialState(), true)`).
- **progress.ts:** `Progress`(:3-6), `solvedInLevel`(:58-61), `isLevelUnlocked`(:69-74). 헬퍼 추가 위치. 기존 테스트 `src/game/progress.test.ts`.
- **HudCard.tsx:** `hud-meta` 행(:49-61)에 `hud-diff`(LEVEL n)·`hud-count`(n/50 SOLVED)·`hud-fold`·`hud-exit`(← LEVELS). 네비 요소 추가 위치. ResizeObserver `--hud-height`(:25-42)가 높이 실측 — 행 추가 안전하나 375px e2e로 확인.
- **theme.css:** `.hud-fold,.hud-exit` 공유 버튼 스타일(:114-115), `:focus-visible` 그룹(:172-174). 새 버튼은 이 그룹에 합류.
- **problems/index.ts:** `allProblems = [...l1,...l5]`, 레벨당 10문제.
- **RevealSheet.tsx:12** `[ SOLVED ]` 헤더 — Play.test가 exact 매치.

---

## Task 1: game 층 프런티어 헬퍼

**Files:** Modify `src/game/progress.ts`; Test `src/game/progress.test.ts`.

**Interfaces:** Produces (Task 2가 소비):
```ts
/** 레벨의 문제들(배열 순서). allProblems.filter(p => p.level === level). */
export function levelProblems(level: Level, problems: Problem[]): Problem[]
/** 레벨 내 이동 가능 인덱스 상한 = 첫 미해결 문제의 인덱스. 전부 해결이면 마지막 인덱스. */
export function frontierIndex(level: Level, progress: Progress, problems: Problem[]): number
/** 착지 문제 = 첫 미해결. 전부 해결이면 레벨의 첫 문제(스펙: 처음부터 복습). */
export function frontierProblem(level: Level, progress: Progress, problems: Problem[]): Problem
```
순수 함수, `problems` 인자 주입(기존 `solvedInLevel`/`isLevelUnlocked` 시그니처 관례 동일). 스토리지 접근 없음.

**주의(스펙 §1 방어 규칙):** solved가 접두 구간이 아닌 비정상 데이터여도 "첫 미해결"로 일관 계산. `frontierProblem`과 `frontierIndex`는 전부-해결일 때 서로 다른 값(첫 문제 vs 마지막 인덱스)을 반환한다 — 착지는 처음부터 복습, 이동 범위는 레벨 전체라는 스펙 결정.

- [ ] **Step 1: 실패 테스트** — progress.test.ts에 추가: ① 빈 progress → frontier=첫 문제, frontierIndex=0; ② solved=[l1-01,l1-02] → frontierProblem=l1-03, frontierIndex=2; ③ 전부 해결 → frontierProblem=**첫 문제**, frontierIndex=**마지막(9)**; ④ 비접두 solved(예: [l1-01,l1-03]) → frontier=l1-02(첫 미해결), index=1; ⑤ 다른 레벨 solved는 무시(l1 solved가 l2 frontier에 영향 없음). 실행: `npx vitest run src/game/progress.test.ts` → 신규 케이스 FAIL(함수 미존재).
- [ ] **Step 2: 구현** — 세 함수 추가. `levelProblems`는 기존 store.ts:179의 siblings 계산과 동일 로직(Task 2에서 store가 이걸 쓰도록 교체).
- [ ] **Step 3: 통과 확인** — 같은 명령 PASS. `npx tsc --noEmit` clean.
- [ ] **Step 4: 전체 회귀** — `npx vitest run` ≥1724 + 신규, 0 실패.
- [ ] **Step 5: 커밋** — `feat(game): frontier helpers (levelProblems, frontierIndex, frontierProblem)`

---

## Task 2: 스토어 — 프런티어 착지 + 이동 액션

**Files:** Modify `src/ui/store.ts`; Test `src/ui/store.test.ts`.

**Interfaces:** Consumes Task 1 헬퍼. Produces (Task 3이 소비):
```ts
// GameStore에 추가:
prevProblem(): Promise<void>     // 레벨 내 index-1로 startProblem. index 0이면 no-op.
nextProblemNav(): Promise<void>  // 레벨 내 index+1로 startProblem. frontierIndex 캡(도달 시 no-op).
// 파생 셀렉터용 데이터는 기존 상태로 충분: problem(현재), progress.solved(배지),
// levelProblems/frontierIndex(버튼 disabled 계산은 Task 3 컴포넌트에서 직접 호출).
```

**변경:**
1. `openLevel`(:81-84): `allProblems.find(first)` → `frontierProblem(level, get().progress, allProblems)`. `progress`는 스토어 상태에서(해결 시 실시간 갱신 — :158-160).
2. `nextProblem`(:176-184)의 siblings 계산을 `levelProblems(problem.level, allProblems)`로 교체(동작 동일 — 기존 테스트로 회귀 확인). **의미 변경 금지**: 여전히 index+1, 끝→backToLevels.
3. 신규 `prevProblem`/`nextProblemNav`: 현재 인덱스 계산 → 경계(0 / frontierIndex) 안이면 `startProblem(target.id)`, 밖이면 no-op. `startProblem`이 이미 직렬화 큐를 타므로 추가 큐잉 불필요.

- [ ] **Step 1: 실패 테스트** — store.test.ts에 추가(기존 beforeEach 패턴 그대로): ① `useGame.setState({ progress: { solved: ['l1-01','l1-02'], hintsUsed: [] } })` 후 `openLevel(1)` → `problem?.id === 'l1-03'`; ② 전부 해결 시드 후 `openLevel(1)` → `l1-01`; ③ 빈 progress → `openLevel(1)` → `l1-01`(기존 동작 = 회귀 확인); ④ l1-03에서 `prevProblem()` → `l1-02`(터미널 클리어·status playing — startProblem 경유 확인); ⑤ l1-01에서 `prevProblem()` → no-op(여전히 l1-01); ⑥ solved=[l1-01] 시드·l1-01에서 `nextProblemNav()` → `l1-02`(프런티어), 다시 `nextProblemNav()` → no-op(캡); ⑦ `resetProblem()` 후 `hintsShown` 유지(리셋 전 revealHint 2회 → 리셋 → 여전히 2 — **의도로 확정된 동작**, 스펙 §2). 실행 → 신규 FAIL.
- [ ] **Step 2: 구현** — 위 3개 변경. 실행 → PASS.
- [ ] **Step 3: 기존 핀 확인** — store.test 전체(특히 "NEXT 끝 → levels") + `npx vitest run` ≥1724+신규, 0 실패. tsc clean.
- [ ] **Step 4: 커밋** — `feat(store): frontier landing on openLevel; prev/next navigation within unlocked range`

---

## Task 3: HUD 네비게이션 UI

**Files:** Modify `src/ui/HudCard.tsx`, `src/ui/theme.css`; Test `src/ui/HudCard.test.tsx`(또는 Play.test.tsx 패턴), e2e `e2e/hud.spec.ts` 회귀 확인.

**Interfaces:** Consumes Task 2 액션(`prevProblem`/`nextProblemNav`/`resetProblem`) + Task 1 헬퍼(disabled 계산).

**UI(스펙 §3):** `hud-meta` 행에 추가 —
```
◆◇◇◇◇ LEVEL 1 · 3/10   [✓ SOLVED]   n/50 SOLVED   ◂ ▸ RESET ▲ ← LEVELS
```
정확한 배치는 구현 재량이되: ① `n/10` 위치는 `hud-diff` 옆(`LEVEL {n} · {index+1}/{total}`) 또는 인접 span; ② 이동 버튼 기호 `◂`/`▸` + **aria-label `이전 문제`/`다음 문제`**; ③ `RESET` 버튼(텍스트 그대로) → `resetProblem()`; ④ `✓ SOLVED` 배지(`progress.solved.includes(problem.id)`일 때만, `<span>`, 색은 var(--phos-green) 계열 변수 + 텍스트 자체로 구분 — 밝기 단독 신호 금지); ⑤ disabled: `◂`는 index 0, `▸`는 index ≥ frontierIndex. 버튼 스타일은 `.hud-fold,.hud-exit` 그룹(theme.css:114-115)에 클래스 추가(예: `.hud-nav`), `:focus-visible` 그룹(:172-174)에도.

**주의:** 배지 텍스트는 정확히 `✓ SOLVED` — `[ SOLVED ]`(RevealSheet) exact 매치와 불충돌. `hud-count`의 `{n}/50 SOLVED`와도 문자열이 겹치지 않게 배지는 별도 요소로.

- [ ] **Step 1: 실패 테스트** — jsdom 컴포넌트 테스트(Play.test.tsx의 beforeEach 패턴): ① l1-03 진입(solved 2개 시드 + openLevel) 시 `이전 문제` 버튼 enabled·`다음 문제` disabled(프런티어); ② `이전 문제` 클릭 → l1-02 표시 + `✓ SOLVED` 배지 visible + `다음 문제` enabled; ③ l1-01에서 `이전 문제` disabled; ④ 파일 지운 뒤 RESET 클릭 → 터미널 클리어(lines 빈) + status playing; ⑤ 미해결 문제에선 배지 없음; ⑥ 위치 표시 `3/10` 렌더. 실행 → FAIL.
- [ ] **Step 2: 구현** — HudCard 수정 + theme.css 버튼/배지 스타일(변수만). 실행 → PASS.
- [ ] **Step 3: 375px 회귀** — `npx playwright test e2e/hud.spec.ts` — 행이 늘어난 HUD가 여전히 입력을 안 덮는지(ResizeObserver 실측이라 통과해야 정상; 깨지면 hud-meta 줄바꿈 처리 필요). 전체 `npm test` + tsc clean.
- [ ] **Step 4: 커밋** — `feat(ui): HUD navigation row — prev/next, position, RESET, solved badge`

---

## Task 4: e2e + 전체 게이트 + 마무리

**Files:** Create `e2e/navigation.spec.ts`; 검증만(엔진/스토어 무변경).

- [ ] **Step 1: e2e 신규 스펙**(smoke.spec 셀렉터 관례 — localStorage.clear 후 시작):
  ① **이어하기**: l1 진입 → 1·2번 해결(각 정답 후 시트의 `NEXT ▸`) → `← LEVELS` → 재진입 → **3번 문제 표시**(l1-03 타이틀).
  ② **뒤로/앞으로**: `이전 문제`(aria-label) 클릭 → 2번 + `✓ SOLVED` 배지 → `다음 문제` 클릭 → 3번 복귀 → 3번에서 `다음 문제` disabled.
  ③ **리셋**: 파일 조작(`rm readme.txt` 류, 해당 레벨 초기 파일) → `RESET` 클릭 → `ls`로 초기 파일 복원 확인 + 터미널 클리어.
  ④ **재플레이 멱등 + 시트 열린 상태 이동**: 2번(SOLVED)을 다시 풀면 해설 시트 다시 표시 → **시트가 열린 채로** HUD `다음 문제` 클릭이 가능해야 하고(시트가 HUD를 가리면 스펙 §4 위반 — z-index/레이아웃 조정 필요), 클릭 시 시트 자동 소멸 + 3번 이동(status가 playing으로 파생 전환).
- [ ] **Step 2: 전체 게이트** — `npm run build`(0 에러) + `npm test`(전체 초록) + `npm run e2e`(기존 6 + 신규 전부; 브라우저 없으면 `npx playwright install chromium`).
- [ ] **Step 3: 실브라우저 스모크** — dev 서버(127.0.0.1 바인딩) + Playwright로 프런티어 착지/이동/리셋 실동작 확인, 스크린샷 `.superpowers/sdd/nav-ux-play.png`.
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` 로 마무리(테스트 검증 → 옵션 제시).
- [ ] **Step 5: 커밋** — `test(e2e): navigation — resume at frontier, prev/next, reset button`

## 완료 조건

`npm run build` 0 에러 · `npm test` 전체 초록(1724+신규) · `npm run e2e` 전체 초록(기존 6 무변경 + 신규) · 실브라우저에서 세 요구 동작 · 스토리지 스키마 v1 그대로 · 기존 핀 테스트 무수정.

## 스코프 밖 (스펙 §YAGNI)

문제 목록 화면 · last-played 영속화 · 해설 바로 보기 · NEXT(시트)의 해결-건너뛰기.
