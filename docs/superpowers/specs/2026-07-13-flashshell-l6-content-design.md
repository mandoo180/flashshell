# FlashShell L6 "자동화" — M3 기능 콘텐츠 확장 설계

날짜: 2026-07-13. 대상: main @ dab31e9 (M1+M2+M3+네비게이션 UX 완료). 접근: **A. 기능별 실무 미션** (승인됨).

## 목표

M3가 추가한 기능(배열 · `read` · `while read` · 컴파운드 리다이렉션 · `+=` · here-doc)을 **가르치는 문제가 현재 0개**다. 새 레벨 **L6 "자동화"** 10문제를 신설해 이를 메운다. 원 설계 스펙 §10의 마일스톤(M0~M3)은 완료됐고, 이 작업은 그 다음의 콘텐츠 확장이다. 배포/사용자 테스트는 별도 서브프로젝트.

## 확정된 제품 결정

- **L6 신설** (기존 레벨 확충 아님) — 기존 유저의 레벨 완료 상태를 되돌리지 않는 순수 추가. 저장 스키마(`flashshell.progress.v1`) 무변경.
- **커리큘럼 = 기능별 실무 미션** — 기존 L5 톤(실무 시나리오 단문) 유지, 기능당 한 문제, 문제 간 독립(fresh VFS). 스토리 아크 없음.
- **스크립트 문제 유형 = 혼합** — 대부분 setup 제공형(스크립트를 읽고·이해하고·실행), 마지막 1문제만 간단한 작성형(이스케이프 곡예 없는 한 줄 `echo` 작성 수준).
- **엔진 변경 전무.** here-doc 백슬래시 폴리시도 하지 않는다 — 출제를 엔진-정확 영역으로 한정해 우회(원 스펙 §11: "문제는 엔진이 지원하는 범위 안에서만 출제").
- 해금 규칙 기존 그대로: L6은 L5에서 `UNLOCK_THRESHOLD`(8)문제 해결 시 열림 — `isLevelUnlocked`의 재귀(기저 `level===1`)가 자동 처리, 코드 변경 불필요.

## 1. 커리큘럼 (10문제)

| id | 가르치는 기능 | 시나리오 | 검증(check) 방향 |
|---|---|---|---|
| l6-01 | `arr=(a b c)` · `"${arr[@]}"` · `${#arr[@]}` | 서버 명단을 배열로 만들어 목록 파일 생성 | fs: 결과 파일 내용 |
| l6-02 | `${arr[i]}` · `arr[i]=x` | 배포 대상 목록에서 특정 항목을 교체해 기록 | fs |
| l6-03 | `+=` (스칼라 연결 · 배열 append) | 여러 조각을 이어 붙여 최종 값/목록 생성 | fs 또는 lastResult |
| l6-04 | `read a b < file` (IFS 분할, 마지막 var 나머지) | 설정 파일에서 필드를 추출해 활용 | fs |
| l6-05 | `while read line; do …; done < file` | 명단 파일의 각 줄로 디렉터리/파일 일괄 생성 | fs |
| l6-06 | 컴파운드 리다이렉션 (`for …; done > f`) | 루프 출력 전체를 보고서 파일 하나로 | fs |
| l6-07 | `read -a arr` | 구분자 있는 한 줄 → 배열 → 개수/항목 활용 | fs 또는 lastResult |
| l6-08 | **setup 제공** 스크립트 읽기 — 본문에 here-doc | 배포 스크립트를 `cat`으로 읽고 이해해 실행, 산출물 활용 | fs |
| l6-09 | **setup 제공** 스크립트 + 인자 — 본문에 배열/루프 | 자동화 스크립트를 올바른 인자로 실행 | fs |
| l6-10 | **작성형 피날레** — 스크립트 직접 작성·실행 | `echo '…' > job.sh` 수준의 한 줄 작성 후 실행 | fs |

- LevelSelect `LEVELS` 배열 추가 항목: `{ level: 6, name: '자동화', topic: '배열 · read · 스크립트' }`.
- 시나리오 문구·정확한 초기 상태·힌트는 출제(구현) 단계 재량이되, 표의 "가르치는 기능"이 해당 문제의 **정답 경로에 반드시 필요**해야 한다(다른 기능만으로 풀리면 출제 실패 — 단, `check`는 상태 채점이므로 완전 봉쇄가 아니라 "자연스러운 최단 경로가 그 기능"이면 충족. 기존 L5-02/04의 수용된 트레이드오프와 동일 기준).

## 2. 시스템 확장 (기계적, 소규모)

- `src/game/types.ts`: `Level = 1 | 2 | 3 | 4 | 5 | 6`.
- `src/game/problems/l6.ts` 신설 + `problems/index.ts`에 `...l6` 추가 (`allProblems` 60개).
- `src/ui/HudCard.tsx` `DIFFICULTY`: 5칸 → **6칸 통일** (`◆◇◇◇◇◇` … `◆◆◆◆◆◆`) — L1~L5 표기도 한 칸 늘어나는 코스메틱 변경. 확인됨: difficulty 문자열을 핀하는 테스트 없음.
- `src/ui/LevelSelect.tsx` `LEVELS` 배열에 L6 항목 — 해금/카운트/COMING SOON 로직은 이미 일반화돼 있어 무변경.
- 자동 파생(코드 무변경): `n/60 SOLVED`(`allProblems.length`), 레벨 내 `n/10`, 프런티어/네비게이션(레벨-일반적), `isLevelUnlocked(6)`.

## 3. 출제 관례 (기존 그대로 — 전 문제 적용)

- `Problem` 타입 그대로: `id`('l6-01'…'l6-10') · `title` · `prompt` · `setup(fs)` · `hints`(1개 이상) · `check(ctx)` · `solution` · `wrongAnswer` · `explanation`.
- **`check(ctx)`는 `ctx.fs`/`ctx.lastResult`만 읽는다**(history 금지 — 기존 불변식).
- **`wrongAnswer` 필수** — 그럴듯하지만 틀린 명령. 음성 테스트(`problems.test.ts`)가 이를 실행해 check가 false여야 함을 검증.
- `solution`은 정답 명령(여러 줄 허용 — 하네스가 줄별 실행). **모든 solution·setup 스크립트는 Docker bash 5로 차등 검증**(엔진과 실제 bash가 같은 결과).
- setup 제공 스크립트(l6-08/09)는 `setup(fs)`의 `writeFile`로 깔고 실행 권한 관례는 기존 L5-07("설치 스크립트 실행") 방식을 따른다.
- **here-doc 본문 제약(l6-08)**: 백슬래시 이스케이프·백틱이 없는 본문만 사용(엔진의 문서화된 미지원 영역 회피). `$var` 확장·`<<'EOF'` 리터럴은 사용 가능(엔진 정확).
- l6-10(작성형)은 따옴표 한 겹으로 끝나는 난이도: 예) `echo 'mkdir -p out; echo done > out/log' > job.sh` 후 실행. 중첩 이스케이프를 요구하지 않는다.

## 4. 검증

- `tests/problems.test.ts` — 자동 확장(60문제): setup 무결성, solution 실행→check true, wrongAnswer 실행→check false, 재실행 안정성(기존 4단 검증 그대로).
- 골든 39 불변(엔진 무변경). 기존 e2e 핀(`/LEVEL 1/`, `1/10`, `첫 접속`) 영향 없음.
- **e2e 1개 추가**: **L1~L5 각각 8문제 이상** solved 시드(localStorage — `isLevelUnlocked`가 재귀이므로 L5만 시드하면 부족) → 레벨 화면에서 `LEVEL 6` enabled + 진입 → l6-01 표시. (시드는 smoke.spec의 localStorage 패턴.)
- 실브라우저 스모크: L6 진입 → 1문제 이상 실제 해결.

## 5. 스코프 밖 (별도 서브프로젝트/백로그)

- **배포**(GitHub + 정적 호스팅 + CI) — 다음 서브프로젝트, 별도 스펙.
- 사용자 테스트 실행 — 배포 후.
- 엔진 변경 일체(here-doc 백슬래시 등 ship-documented minors).
- 스토리 아크, L1~L5 확충, 난이도 재조정.

## 불변식 (기존, 유지)

- `check(ctx)`는 fs/lastResult만. 세션 직렬화 큐. 스토리지 스키마 v1. Phosphor 테마(신규 UI 없음 — LEVELS 항목뿐). 엔진 순수성(`src/shell/**` 무변경).
