# FlashShell 문제 네비게이션/진행 UX 설계

날짜: 2026-07-13. 대상: main @ 1cbb209 (M1+M2+M3 완료). 접근: **A. 스토어-파생 미니멀** (승인됨).

## 목표

세 가지 사용자 요구를 기존 시임 위에 최소 표면으로 얹는다:

1. **문제 리셋** — 뭔가 꼬였을 때 현재 문제를 초기 상태로 되돌리는 발견 가능한 버튼.
2. **세션 내 앞뒤 이동** — 해금된 문제 사이를 PREV/NEXT로 이동.
3. **이어하기** — 레벨 진입 시 최신 해금 지점(첫 미해결 문제)에 착지.

## 확정된 제품 결정

- **해금 모델 = 해결 + 프런티어.** 레벨 내 이동 가능 범위는 배열 인덱스 `[0..frontierIndex]`. `frontier` = 레벨 배열 순서상 **첫 미해결** 문제. 이 범위는 정의상 "해결된 접두 구간 + 프런티어"와 일치한다(프런티어가 첫 미해결이므로 그 앞은 전부 해결됨).
- **복습 UX = 처음부터 재플레이.** 해결했던 문제로 이동하면 항상 초기 VFS로 새로 시작(현행 `startProblem` 메커니즘 그대로), HUD에 `SOLVED` 배지만 표시. 다시 풀면 해설 시트가 다시 뜬다(`markSolved`는 멱등, progress.ts:46-48).
- **전부 해결된 레벨** 진입 시 → 레벨 1번 문제에 착지(처음부터 복습). 이동 범위는 레벨 전체.
- **스토리지 스키마 무변경.** `flashshell.progress.v1` = `{ solved: string[], hintsUsed: string[] }` 그대로. 프런티어는 매번 `solved`에서 계산(last-played 저장 없음 — YAGNI).

## 아키텍처

### 1. game 층 — `src/game/progress.ts` 에 순수 헬퍼 추가

```ts
/** 레벨 배열 순서상 첫 미해결 문제. 전부 해결이면 레벨의 첫 문제. */
export function frontierProblem(level: number, solved: string[]): Problem
/** 레벨 내 이동 가능 인덱스 상한 = frontier 의 인덱스 (전부 해결이면 마지막 인덱스). */
export function frontierIndex(level: number, solved: string[]): number
```

- 레벨 문제 목록은 `allProblems.filter(p => p.level === level)` (store.ts:176-184 의 `nextProblem` 이 이미 쓰는 sibling 계산과 동일) — 헬퍼로 추출해 공유.
- **방어 규칙:** solved 가 접두 구간이 아닌 비정상 저장(손상/레거시)이어도 프런티어는 "첫 미해결"로 일관 계산한다. 프런티어 뒤의 solved 문제는 프런티어가 지나갈 때까지 이동 범위 밖 — 모델 단순성 우선, 데이터 유실 없음.

### 2. 스토어 — `src/ui/store.ts`

- **`openLevel(level)`** (store.ts:81-84): `allProblems.find(first)` → `frontierProblem(level, progress.solved)` 로 변경. `progress` 는 스토어 상태에서 읽는다(해결 시 실시간 갱신되므로 재진입 시 최신 — store.ts:157-161).
- **신규 액션 `prevProblem()` / `nextProblemNav()`**: 현재 문제의 레벨 내 인덱스 ±1 로 `startProblem(id)` 호출. 하한 0, 상한 `frontierIndex`. `startProblem` 은 이미 직렬화 큐(store.ts:24-29)를 타므로 실행 중 전환도 안전 — **세션 재생성 금지, 큐잉된 start/reset 호출 외의 경로 금지**(store.ts:90-101 불변식).
- **`resetProblem()`** (store.ts:186-202, 기존): HUD 버튼이 이 액션을 그대로 호출. **힌트 유지 동작을 의도로 확정** — 리셋은 "지금 시도의 판을 다시 깔기"이므로 `hintsShown` 을 건드리지 않는다(현행 그대로). 반면 PREV/NEXT 이동은 `startProblem` 경유라 완전 새 방문(`hintsShown: 0`, store.ts:118). 타이핑 `reset` 명령(store.ts:132)도 동일 경로로 유지.
- **파생값**: `SOLVED` 배지 = `progress.solved.includes(problemId)`. 별도 상태 저장 없이 렌더에서 파생.

### 3. HUD — `src/ui/HudCard.tsx`

기존 `← LEVELS`(HudCard.tsx:60) 옆 네비게이션 행:

```
← LEVELS   ◂   3/10   ▸   RESET        [SOLVED]
```

- 이동 버튼은 기호 `◂`/`▸` + **aria-label `이전 문제`/`다음 문제`** — 해설 시트의 기존 `NEXT ▸` 버튼(smoke.spec 핀)과 접근성 이름이 충돌하지 않아야 한다(해결 직후 시트와 HUD가 동시에 보임). 테스트 셀렉터는 aria-label 사용.
- `◂`: 레벨 첫 문제에서 `disabled`. `▸`: 프런티어(또는 전부 해결 시 마지막 문제)에서 `disabled`.
- `n/10` 위치 표시: 레벨 내 `index+1 / total`.
- `RESET`: `resetProblem()` 호출.
- `SOLVED` 배지: 저장된 해결 문제일 때만. **밝기만으로 표시 금지** — 텍스트(+기호)로 구분(테마 불변식). 색은 `theme.css` 변수만, 신규 애니메이션 없음(`prefers-reduced-motion` 하 무동작 유지).
- 모두 실제 `<button>`(a11y). 문제 전환 후 입력 포커스는 기존 `problemId` 키 리포커스(Terminal.tsx:38-44)가 처리.
- HUD 높이는 ResizeObserver → `--hud-height`(HudCard.tsx:25-42)가 실측하므로 행 추가는 안전 — 단 375px 회귀 e2e(hud.spec.ts)로 확인.

### 4. 동작 규칙 (전체)

| 상황 | 동작 |
|---|---|
| 레벨 진입 | 프런티어 착지. 신규 유저 = 1번(기존 동작·e2e 불변). 전부 해결 = 1번. |
| PREV/NEXT 이동 | `startProblem(id)` — 초기 VFS, 터미널 클리어, `hintsShown: 0`, `status: 'playing'`. 해설 시트 열린 상태에서도 동작(시트는 `status==='solved'` 파생이라 자동 소멸, RevealSheet.tsx:8). |
| RESET | 초기 VFS 재구성 + 터미널 클리어, **힌트 유지**, `status: 'playing'`(이번 세션에 해결한 문제도 다시 playing — 현행 그대로). |
| 해설 시트의 `NEXT ▸` | 기존 그대로 순차 `index+1`, 레벨 끝 → 레벨 선택(store.test 핀 유지). 해결 건너뛰기 없음. |
| 재해결 | `markSolved` 멱등. 해설 시트 다시 표시. |

### 5. 테스트

- **store 유닛** (기존 store.test.ts 패턴): ① `solved=[l1-01,l1-02]` 시드 → `openLevel(1)` 이 l1-03 착지, ② 전부 해결 → 1번 착지, ③ `prevProblem` 하한(1번에서 no-op/disabled 조건), ④ `nextProblemNav` 프런티어 캡, ⑤ RESET 후 `hintsShown` 유지, ⑥ SOLVED 배지 파생. (시드 주의: `progress` 는 모듈 로드 시 1회 읽음 — 기존 Play.test.tsx 의 모듈 재임포트 패턴 사용, store.ts:68.)
- **e2e 신규** (기존 셀렉터 관례 유지): 2문제 해결 → `← LEVELS` → 레벨 재진입 → 3번 문제 착지 확인 → `이전 문제`(◂) 로 2번(SOLVED 배지 표시·재플레이 가능) → `다음 문제`(▸) 로 3번 복귀 → 파일 삭제 후 `RESET` 버튼 → 초기 파일 복원 확인.
- **기존 핀 테스트 전부 무변경 통과**: smoke.spec(신규 localStorage → 프런티어=1번 → "첫 접속" 그대로), hud.spec(375px — 행 추가 후 재확인), store.test(NEXT 끝 → levels).

## 스코프 밖 (YAGNI, 백로그)

- 문제 목록/그리드 화면(접근 B) — 조망성 필요해지면 별도 설계.
- last-played 위치 영속화(스키마 v2) — 프런티어 계산으로 요구 충족.
- 해설 바로 보기 버튼(재해결 없이 해설 시트 열기).
- NEXT(해설 시트)의 해결-건너뛰기.

## 불변식 (기존, 유지)

- `check(ctx)` 는 `ctx.fs`/`ctx.lastResult` 만 읽는다 — 네비게이션은 check 에 영향 없음(세션별 fresh).
- 세션은 스토어 수명 동안 1개, 전환은 직렬화 큐를 탄 `start`/`reset` 메시지로만.
- Phosphor 테마: 밝기 단독 신호 금지, `prefers-reduced-motion` 하 애니메이션 전무, `theme.css` `:root` 밖 색 리터럴 금지.
- Worker 복구 리플레이(worker-session.ts:99-136)는 `start(problemId)`+히스토리 기반 — 네비게이션/리셋과 자연 호환.
