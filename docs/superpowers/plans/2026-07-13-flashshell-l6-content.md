# FlashShell L6 "자동화" 콘텐츠 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로 태스크별 실행. 스텝은 체크박스(`- [ ]`).

**Goal:** 스펙 `docs/superpowers/specs/2026-07-13-flashshell-l6-content-design.md`(승인됨) 구현 — 새 레벨 L6 "자동화" 10문제로 M3 기능(배열·read·while read·컴파운드 redir·+=·here-doc)을 가르친다.

**Architecture:** 시스템 확장은 기계적 소규모(Level 타입 6 추가, DIFFICULTY 6칸, LEVELS 항목, l6.ts 배선) — 해금·프런티어·카운트는 전부 레벨-일반적이라 자동. 본체는 출제: 문제 10개를 기존 관례(setup/check/solution/wrongAnswer, Docker bash 5 차등 검증)로 작성. **엔진 변경 전무.**

**Tech Stack:** TS(strict), Vitest, Playwright, Docker(bash 5 차등 검증).

**Base:** 브랜치 `worktree-flashshell-l6-content`, base `6fe11b1`(main, 스펙 커밋). 베이스라인 1743 단위 + 10 e2e + 39 골든 초록.

## Global Constraints

- **엔진 변경 전무:** `src/shell/**` 무변경(골든 39 자동 불변). here-doc 백슬래시 폴리시 없음 — 출제 제약으로 우회.
- **check(ctx)는 `ctx.fs`/`ctx.lastResult`만** — history/cwd 채점 금지(cwd는 경로 해석용으로만).
- **wrongAnswer 필수** — 그럴듯하지만 check가 false인 명령. `solution`은 정답(여러 줄 가능 — 하네스가 줄별 실행).
- **모든 solution·setup 스크립트를 Docker bash 5로 차등 검증**: `docker run --rm debian:stable-slim bash -c '...'` 로 실제 bash가 같은 최종 상태를 만드는지 확인 후 확정. 엔진 결과와 다르면 문제를 바꾸거나(출제 영역 이탈) 보고 — 엔진을 고치지 않는다(스코프 밖).
- **here-doc 본문 제약(l6-08):** 백슬래시 이스케이프·백틱 없는 본문만. `$var` 확장·`<<'EOF'` 리터럴은 가능.
- **가르치는 기능이 자연스러운 최단 경로**여야 함(상태 채점이라 완전 봉쇄 불가 — L5-02/04와 동일 기준). prompt가 해당 기능 사용을 명시적으로 유도.
- **기존 핀 무수정:** `/LEVEL 1/`, `1/10`, `첫 접속`, 기존 50문제. 스토리지 스키마 v1.
- 각 태스크 끝: `npx tsc --noEmit` clean + 전체 `npm test` 초록.

## 출제 관례 (l5.ts 실측 — l6.ts 전 문제 적용)

- 파일 구조: `src/game/problems/l6.ts` — `import type { Problem } from '../types'`, `const HOME = '/home/player'`(l5.ts 상단 관례 확인), `export const l6: Problem[] = [...]`.
- 필드: `id`('l6-01'…) · `level: 6` · `title`(짧은 명사구) · `prompt`(존댓말 지문, 요구 산출물 명시) · `setup(fs)`(초기 파일; 스크립트는 `fs.writeFile(path, content, 0o755)` — l5-07 관례) · `hints`(점진적 1~3개, 마지막은 거의 정답) · `check(ctx)`(fs/lastResult) · `solution` · `wrongAnswer` · `explanation`(왜 오답이 안 되는지 + 정답 원리, l5-07 톤).
- `problems.test.ts`가 자동 검증: 중복 id·필수 필드·setup 홈 보존·**solution 실행→check true**·**wrongAnswer 실행→check false** 등. l6 추가만으로 60문제 검증에 포함됨.
- 검증 방향이 lastResult인 문제: `check`가 `ctx.lastResult.stdout`/`exitCode`를 봄 — 단 solution의 **마지막 줄**의 결과임에 유의(하네스가 줄별 실행 후 마지막 lastResult 전달. tests/problems.test.ts:11-15 확인).

---

## Task 1: 시스템 확장 — Level 6 배선

**Files:** Modify `src/game/types.ts`(Level), `src/ui/HudCard.tsx`(DIFFICULTY 6칸), `src/ui/LevelSelect.tsx`(LEVELS 항목); Create `src/game/problems/l6.ts`(빈 배열) + Modify `src/game/problems/index.ts`; Test.

**Interfaces:** Produces `Level = 1|2|3|4|5|6`; `l6: Problem[]`(Task 2/3가 채움); LEVELS에 `{ level: 6, name: '자동화', topic: '배열 · read · 스크립트' }`. 빈 l6 상태에서 LEVEL 6 버튼은 `COMING SOON`(total===0 기존 로직).

- [ ] **Step 1: 실패 테스트** — LevelSelect 렌더에 `LEVEL 6` + `자동화` + `COMING SOON`(l6 비어있는 동안) 표시; DIFFICULTY가 6칸(`◆◇◇◇◇◇`…) — HudCard 렌더로 L1 문제에서 `◆◇◇◇◇◇` 확인(기존 5칸 표기 테스트가 있다면 그것도 갱신 대상인지 확인 — 핀은 없다고 스펙에서 확인됨). 실행 → FAIL(Level 타입/항목 없음).
- [ ] **Step 2: 구현** — 타입·배열·항목·배선. `DIFFICULTY`는 하드코딩 6개 문자열 또는 `'◆'.repeat(level)+'◇'.repeat(6-level)` 파생(구현 재량, 파생 권장).
- [ ] **Step 3:** `npx tsc --noEmit` clean + 전체 `npx vitest run` ≥1743+신규(0 실패 — 특히 기존 progress/LevelSelect/problems 테스트).
- [ ] **Step 4: 커밋** — `feat(game): level 6 wiring — type, LEVELS entry, 6-step difficulty, empty l6`

---

## Task 2: 문제 l6-01 ~ l6-05 (배열 기초 · 인덱스 · += · read · while read)

**Files:** Modify `src/game/problems/l6.ts`; Test = `tests/problems.test.ts` 자동 + Docker 차등.

**Interfaces:** Consumes Task 1. Produces 5문제. 각 문제의 기능·시나리오(스펙 §1 표):

| id | 기능(정답 경로 필수) | 시나리오 방향 | check |
|---|---|---|---|
| l6-01 | `arr=(a b c)` + `"${arr[@]}"`/`${#arr[@]}` | 서버 명단 배열 → 목록 파일 생성 (예: `echo "${arr[@]}" > servers.txt` + 개수 기록) | fs |
| l6-02 | `${arr[i]}`/`arr[i]=x` | setup이 준 목록에서 특정 위치 항목 교체 후 파일로 | fs |
| l6-03 | `+=` | 조각들을 이어 붙인 최종 값/목록을 파일로 | fs |
| l6-04 | `read a b < file` | setup의 설정 파일(`키 값` 형식)에서 필드 추출 → 산출물 | fs |
| l6-05 | `while read` | setup의 명단 파일 각 줄로 디렉터리/파일 일괄 생성 | fs |

**출제 절차(문제마다):** ① 시나리오·초기 상태 확정 → ② solution을 Docker bash 5에서 실행해 최종 상태 확인 → ③ 엔진(`sh.exec`)에서 동일 결과 확인 → ④ check/wrongAnswer/힌트/해설 작성 → ⑤ `npx vitest run tests/problems.test.ts` 통과.

- [ ] **Step 1:** l6-01~05 작성(위 절차). wrongAnswer는 "기능을 안 쓴 그럴듯한 시도"(예: l6-05에서 `mkdir` 하나만) 위주.
- [ ] **Step 2:** `npx vitest run tests/problems.test.ts` — 55문제 전 항목 통과(신규 5 포함). 전체 `npx vitest run` 초록. tsc clean.
- [ ] **Step 3: 커밋** — `feat(problems): l6-01..05 — arrays, indexing, +=, read, while read`

---

## Task 3: 문제 l6-06 ~ l6-10 (컴파운드 redir · read -a · 스크립트 읽기(here-doc) · 스크립트+인자 · 작성형)

**Files:** Modify `src/game/problems/l6.ts`; Test 동일.

**Interfaces:** Consumes Task 1/2 관례. Produces 5문제:

| id | 기능 | 시나리오 방향 | check |
|---|---|---|---|
| l6-06 | `for …; done > f` (컴파운드 redir) | 루프 출력 전체를 보고서 파일 하나로(`>>` 반복이 아닌 `>` 한 방 유도) | fs |
| l6-07 | `read -a arr` | setup의 한 줄 데이터 → 배열 → 개수/특정 항목 산출물 | fs |
| l6-08 | setup 제공 스크립트(본문에 here-doc) 읽기·실행 | 스크립트가 here-doc으로 설정 파일을 생성 — `cat`으로 읽고 이해해 실행, 산출물 활용. **본문에 백슬래시·백틱 금지, `$var`/`<<'EOF'` 가능** | fs |
| l6-09 | setup 제공 스크립트(배열/루프 포함) + 인자 | `./script.sh 인자` 로 올바른 인자 실행(l5-09 인자 관례) | fs |
| l6-10 | 작성형 피날레 | `echo '명령들' > job.sh` 한 줄 작성 + 실행 — 따옴표 한 겹, 중첩 이스케이프 없음 | fs |

- [ ] **Step 1:** l6-06~10 작성(Task 2와 동일 절차 — Docker 차등 필수, 특히 l6-08의 here-doc 스크립트는 bash와 엔진 양쪽에서 실행해 동일 산출 확인).
- [ ] **Step 2:** `npx vitest run tests/problems.test.ts` — 60문제 전 항목 통과. 전체 초록. tsc clean.
- [ ] **Step 3: 커밋** — `feat(problems): l6-06..10 — compound redir, read -a, heredoc script, args, finale`

---

## Task 4: e2e + 전체 게이트 + 마무리

**Files:** Modify/Create e2e(L6 해금 1케이스); 검증.

- [ ] **Step 1: e2e** — **L1~L5 각각 8문제 이상 solved 시드**(localStorage `flashshell.progress.v1` — `isLevelUnlocked` 재귀 때문에 L5만으론 부족) → 레벨 화면에서 `LEVEL 6` enabled(잠금 아님) + `자동화` 표시 → 진입 → l6-01 타이틀 표시. 기존 "잠긴 레벨" 핀(L3 disabled, 빈 progress)과 공존 확인.
- [ ] **Step 2: 전체 게이트** — `npm run build`(0 에러) + `npm test`(1743+신규, 60문제 검증 포함) + `npx playwright test`(기존 10 + 신규).
- [ ] **Step 3: 실브라우저 스모크** — dev 서버(127.0.0.1) + Playwright로 L6 해금 시드 → 진입 → l6-01 실제 해결(정답 입력→해설 시트) 확인, 스크린샷 `.superpowers/sdd/l6-play.png`.
- [ ] **Step 4:** `superpowers:finishing-a-development-branch`.
- [ ] **Step 5: 커밋** — `test(e2e): level 6 unlock and entry`

## 완료 조건

`npm run build` 0 에러 · `npm test` 초록(60문제 전 검증) · e2e 초록(신규 L6 해금 포함) · 실브라우저에서 L6 해금·진입·1문제 해결 · 골든 39 불변 · 엔진 무변경 · 기존 핀 무수정.

## 스코프 밖

배포(다음 서브프로젝트) · 엔진 변경 일체 · L1~L5 확충 · 스토리 아크.
