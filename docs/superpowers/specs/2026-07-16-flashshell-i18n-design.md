# FlashShell EN/KO 로컬라이제이션 설계

날짜: 2026-07-16. 대상: main @ d50e7fa (60문제, 게이트 1786 unit / 11 e2e / 39 golden, https://flashshell.anonpengling.org/ 배포 중). 접근: **A. 필드 병기 + 수제 t()** (승인됨).

## 확정된 결정

- **범위 = 전체**: 60문제 콘텐츠(제목·지문·힌트·해설) + UI 크롬 + README. (승인)
- **초기 언어 = 브라우저 감지**: `navigator.language`가 `ko*`면 `ko`, 아니면 `en`. localStorage 저장값이 있으면 그것이 우선. (승인)
- **아키텍처 = 필드 병기**: i18n 라이브러리 없음. `LocalizedText = { en: string; ko: string }`를 문제 정의에 colocate — TS strict가 번역 누락을 컴파일 에러로 강제. (승인)
- **KO 원문 무변경**: 기존 한국어 텍스트는 한 글자도 바꾸지 않는다(기존 사용자 경험 보존). EN은 사이버펑크 톤을 살려 신규 생성.

## 1. 데이터 모델 (`src/game/types.ts`)

```ts
export type Lang = 'en' | 'ko'
export interface LocalizedText { en: string; ko: string }
```

`Problem` 변경: `title`/`prompt`/`explanation`: `LocalizedText`, `hints`: `LocalizedText[]`.
무변경: `id`/`level`/`setup`/`check`/`solution`/`wrongAnswer`(명령어이므로 언어 무관).

## 2. 언어 상태 (`src/ui/store.ts` + `src/ui/i18n.ts`)

- 스토어에 `lang: Lang` + `setLang(lang)` 추가.
- 초기값 결정(모듈 `detectLang(stored, navLang)` 순수 함수로 분리해 단위 테스트):
  1. `localStorage['flashshell.lang.v1']`이 `'en' | 'ko'`면 그 값
  2. 아니면 `navigator.language`가 `ko`로 시작하면 `'ko'`, 그 외 `'en'`
- `setLang`: 스토어 갱신 + localStorage 저장 + `document.documentElement.lang` 갱신(초기 적용도 동일 경로).
- **토글 UI**: `[EN|KO]` — 레벨 선택 화면은 우상단 고정, 플레이 화면은 HUD 메타 행(화면 최상단 행)의 오른쪽 그룹에 배치해 양쪽에서 항상 노출한다. HUD 위에 떠 있는 별도 오버레이를 만들지 않는다(375px HUD 겹침 이력 회피). 전환은 텍스트 리렌더만; 터미널 히스토리·세션·진행 상태 무접촉(셸 세션에 아무 메시지도 보내지 않는다).

## 3. UI 크롬 사전 (`src/ui/i18n.ts`)

```ts
export const STRINGS = {
  levelsSub: { en: 'Problems only the command line can solve. Pick a level.', ko: '명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.' },
  // …
} satisfies Record<string, LocalizedText>
export function useT(): (key: keyof typeof STRINGS) => string // 스토어 lang 구독
```

**로컬라이즈 대상(전수)**:
- LevelSelect: 부제(`levels-sub`), `LEVELS` 배열의 `name`/`topic`(예: '탐색', '리다이렉션' — `LocalizedText`로 변경), LOCKED 문구 `LOCKED — 이전 레벨 ${UNLOCK_THRESHOLD}문제 필요`(문항 수 보간 함수).
- HudCard: aria-label `이전 문제`/`다음 문제`/`문제 카드 펼치기·접기`.
- RevealSheet: dialog aria-label `해설`, 라벨 `모범답안`/`해설`.

**양 언어 공통(영어 고정 — 테마의 일부)**: `FLASHSHELL`, `✓ SOLVED`, `n/m SOLVED`, `RESET`, `HINT n/m`, `← LEVELS`, `[ SOLVED ]`, `NEXT ▸`, `COMING SOON`, `LOCKED —` 접두.

## 4. 문제 콘텐츠 (`src/game/problems/l1.ts`~`l6.ts`)

- 60문제 × (`title` + `prompt` + `hints[]` + `explanation`) 필드 병기. KO는 기존 문자열 그대로 이동, EN은 신규 번역.
- 지문 속 파일명·명령·기대 출력(`readme.txt`, `ACCESS GRANTED`, `K-7741-ZX` 등)은 양 언어 동일 — check가 참조하는 값이므로 번역 금지.
- EN 톤: 간결한 사이버펑크 미션 브리핑체. 기술 용어(concatenate, change directory 등)는 원어 그대로.

## 5. 불변 영역 (번역 금지)

- 셸 엔진(`src/shell/**`) 전체 — 출력·에러 메시지는 bash-정확성 계약(골든 픽스처가 바이트 비교).
- `setup()`이 만드는 파일 내용, `solution`/`wrongAnswer`, 골든 픽스처(`tests/shell/golden/`).
- 이 서브프로젝트에서 `src/shell/**`과 골든에 diff가 생기면 그 자체가 리뷰 리젝트 사유.

## 6. 문서

- `README.md` → EN 전환, `README.ko.md` 신설(현행 KO 내용 이동), 양쪽 첫머리에 상호 링크(`한국어 | English`).
- `index.html`: `<html lang="ko">`는 초기값으로 두고 스토어 초기화가 감지 결과로 즉시 갱신.

## 7. 테스트

- **단위**: `detectLang` 우선순위(저장값 > 감지 > en 기본), `setLang` 저장·`<html lang>` 갱신, `useT` 전환.
- **무결성**: 60문제 전 `LocalizedText` 필드의 `en`/`ko` 모두 비어 있지 않음(공백만도 불가). 컴파일이 1차 방어, 이 테스트는 빈 문자열 방어.
- **컴포넌트**: 기존 테스트는 한국어 문자열을 쿼리하므로 테스트 셋업에서 lang을 `'ko'`로 명시 고정해 최소 수정으로 통과. 토글 렌더·전환 테스트 신규.
- **e2e (신규 1~2개)**: (1) 기본 EN(Playwright 기본 locale) → 토글로 KO 전환 → 지문·크롬 한국어 확인 → 새로고침 후 KO 유지. (2) `locale: 'ko-KR'` 컨텍스트에서 첫 방문이 KO인지.
- **게이트 불변**: `npm run golden` diff 없음, 엔진 단위 테스트 무변경 통과.

## 완료 조건

- 전 게이트 초록(build + unit + e2e + 골든 바이트 동일).
- EN 상태에서 60문제 스모크: 레벨 진입·지문/힌트/해설 영어 렌더·해결 플로우 정상.
- 토글·감지·저장 e2e 통과. KO 사용자 경험은 렌더 결과 기준 현행과 동일.

## 스코프 밖

세 번째 언어 · URL 쿼리 언어 파라미터 · 셸 출력 번역 · 폰트 변경 · 문제 텍스트 외부 파일 분리.
