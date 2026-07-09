# FlashShell — 설계 문서

작성일: 2026-07-09
상태: 승인됨 (구현 대기)

## 1. 개요

FlashShell은 브라우저에서 동작하는 셸 학습 게임이다. 사용자는 인광 CRT 터미널 앞에 앉아, 실제 셸 명령과 셸 스크립트로만 풀 수 있는 문제를 한 장씩 넘겨가며 해결한다.

브라우저 안에서 도는 bash 서브셋 인터프리터와 가상 파일시스템이 게임의 심장이다. 문제는 명령어 문자열을 비교해 채점하지 않는다. 사용자가 만들어낸 **파일시스템의 최종 상태**를 검사한다. 따라서 정답에 이르는 길은 여러 개이며, 모두 유효하다.

### 대상 사용자

입문자, 중급자, 퍼즐 애호가, 그리고 이 프로젝트 자체를 기술 데모로 보는 사람 모두를 겨냥한다. 이 넷은 난이도 스팬을 넓게(입문 → 스크립팅) 가져가고 UI 완성도를 최우선에 두면 동시에 만족한다.

### 범위 밖

- 계정, 서버, 데이터베이스. 전부 클라이언트에서 돈다.
- 간격 반복(spaced repetition)과 자가평가. 문제는 풀거나 못 풀거나 둘 중 하나다.
- 적응형 난이도 조절.
- bash의 `trap`, 프로세스 치환 `<()`, job control.

## 2. 게임 루프

```
레벨 선택 → 문제 카드 등장 → (사용자가 원하면 힌트 요청)
  → 터미널에서 명령 입력 → 매 명령 실행 후 자동 판정
  → 조건 충족 시 SOLVED → 해설 바텀시트 상승 → 다음 문제
```

**채점 시점.** 사용자가 엔터를 칠 때마다 검증기가 돈다. CHECK 버튼은 없다. 조건을 만족하는 순간 즉시 SOLVED로 전이한다. "어느 순간 달성"의 감각이 이 게임의 리듬이다.

**힌트.** 문제마다 단계적 힌트 배열을 갖는다. 요청할 때만 하나씩 열린다. 힌트를 봤다는 사실은 기록하되 벌점은 없다.

**해설.** 정답 직후 바텀시트가 아래에서 올라온다. 터미널과 사용자가 방금 친 명령은 위에 그대로 남는다. 사용자는 자기 답과 모범답안을 나란히 볼 수 있다. 이 동시성이 학습이 일어나는 지점이므로, 카드를 뒤집어 터미널을 가리는 안은 기각했다.

**리셋.** 문제에 진입할 때마다 VFS를 새로 만들고 `setup(fs)`를 다시 돌린다. 사용자는 언제든 `reset`으로 초기 상태에 돌아갈 수 있다. `rm -rf /`로 세계를 지우는 것도 허용되는 실험이다.

## 3. 진행 구조

5개 레벨, 레벨당 10문제, 총 50문제.

| 레벨 | 주제 | 대표 명령 |
|---|---|---|
| L1 | 탐색 | `ls` `cd` `cat` `pwd` `head` `tail` |
| L2 | 조작 | `cp` `mv` `mkdir` `rm` `touch`, 리다이렉션 |
| L3 | 텍스트 처리 | `grep` `sed` `awk` `sort` `uniq` `cut`, 파이프 |
| L4 | 시스템 | `find` `xargs` `chmod` `stat` `du` `wc` `diff` |
| L5 | 스크립팅 | `if` `for` `while` `case`, 함수, `test` |

**해제 규칙.** 한 레벨의 문제를 8개 이상 클리어하면 다음 레벨이 열린다. 해제된 레벨 중에서는 자유롭게 오갈 수 있다. 전부 클리어를 요구하지 않는 이유는, 유난히 까다로운 한 문제가 사용자를 영구히 가두는 사태를 막기 위해서다. 중급자는 하위 레벨을 빠르게 통과해 원하는 난이도로 올라갈 수 있다.

**진행도 저장.** `localStorage`. 클리어한 문제 ID 집합, 열린 레벨, 힌트 사용 여부만 담는다.

## 4. 아키텍처

핵심 원칙: **셸 엔진은 React를 모르고, 브라우저도 모른다.** 순수 TypeScript 모듈이다. 그래야 파서와 코어유틸을 Node에서 대량의 단위 테스트로 검증할 수 있다.

```
src/
  shell/            순수 TS. 프레임워크·브라우저 무관
    vfs.ts            가상 파일시스템 (inode 트리, 권한, 링크)
    lexer.ts          토크나이저
    parser.ts         AST (bash 문법 서브셋)
    expand.ts         확장: 변수, 글롭, 명령치환, 틸드, 산술
    interpreter.ts    AST 실행, 파이프, 리다이렉션, exit code
    builtins/         cd, echo, export, test, read, source …
    coreutils/        ls, cat, grep, sed, awk, find, sort, wc …
    index.ts          createShell(fs) → Shell

  game/             순수 TS. 문제와 규칙
    types.ts          Problem, CheckContext
    problems/l1..l5/  문제 정의 50개
    progress.ts       localStorage 진행도

  ui/               React
    Crt.tsx           곡률·비네팅·주사선 래퍼
    Terminal.tsx      DOM 터미널 (히스토리, Tab 완성, Ctrl+C/L)
    HudCard.tsx       문제 카드
    RevealSheet.tsx   해설 바텀시트
    LevelSelect.tsx   레벨 선택
```

### 모듈 경계

시스템 전체가 단 두 개의 인터페이스 위에 선다.

```ts
interface Shell {
  exec(line: string): Promise<ExecResult>   // { stdout, stderr, exitCode }
  readonly fs: VFS
  readonly cwd: string
  readonly env: Record<string, string>
}

interface Problem {
  id: string
  level: 1 | 2 | 3 | 4 | 5
  prompt: string
  setup(fs: VFS): void                 // 초기 파일시스템을 짓는다
  hints: string[]                      // 단계적, 요청할 때만 하나씩
  check(ctx: CheckContext): boolean    // 결과 상태 검사
  solution: string                     // 모범답안
  wrongAnswer: string                  // 그럴듯하지만 틀린 답 (테스트용)
  explanation: string                  // 왜 그런지
}

interface CheckContext {
  fs: VFS
  lastResult: ExecResult
  history: string[]
  cwd: string
}
```

`Shell`이 이만큼 얇으므로, 훗날 엔진을 v86 에뮬레이터나 서버측 컨테이너로 교체하려면 `exec`와 `fs`만 다시 구현하면 된다. 게임 코드는 바뀌지 않는다.

### 데이터 흐름

사용자가 엔터를 친다 → `Terminal`이 `shell.exec(line)`을 호출한다 → 출력을 스크롤백에 붙인다 → 곧바로 `problem.check({ fs, lastResult, history, cwd })`를 실행한다 → `true`면 SOLVED로 전이하고 바텀시트가 올라온다.

검증기가 VFS 객체를 직접 읽으므로 직렬화도 파싱도 없다. 이것이 브라우저 내 인터프리터를 택한 가장 큰 이유다.

## 5. 셸 엔진의 범위

목표는 "거의 완전한 bash"다. 다만 계층적으로 짓는다. **각 층이 끝나는 시점에 게임은 반드시 플레이 가능해야 한다.**

**1층 — 플레이 가능**
파이프, 리다이렉션(`>` `>>` `2>` `<`), 글롭, 변수와 확장, 명령치환, `&&` / `||`, exit code, 코어유틸 약 30개.

**2층 — 스크립트 가능**
`if` / `for` / `while` / `case`, 함수, `test` 와 `[`, 위치인자, `source`, shebang 실행.

**3층 — 충실도**
배열, here-doc, subshell `( )`, 파라미터 확장 전체(`${x:-y}`, `${x//a/b}`, `${#x}`), `IFS` 정밀 동작.

**범위 밖**
`trap`, 프로세스 치환 `<()`, job control.

## 6. 시각 디자인

**레이아웃.** 터미널이 화면 전체를 채운다. 문제 카드는 그 위에 떠 있는 반투명 HUD이며 접을 수 있다. 정답 시 해설이 바텀시트로 아래에서 올라온다.

**톤: Phosphor CRT.** 인광 녹색 단색, 진공관 곡률, 비네팅, 주사선. 참조점은 1980년의 VT100이다.

**단색의 대가와 그 지불.** 색을 하나로 묶었으므로 정오답과 난이도를 색으로 구분할 수 없다. 해법은 **Dual Phosphor**다. 1980년대에 녹색 CRT와 앰버 CRT가 실제로 나란히 존재했으므로, 두 색만 쓰는 것은 고증을 깨지 않는다.

- **녹색** — 정상 출력, 정답, 진행
- **앰버** — 경고, 오답, 미완성

여기에 오답 순간에만 약 120ms의 짧은 신호 글리치(화면 찢김, 색수차)를 얹는다. 상시 효과가 아니라 순간적 사건이므로 피로하지 않고, 대비가 있어야 빛이 보인다.

**접근성.** 밝기만으로 정보를 전달하지 않는다(저시력·고조도 환경에서 게임이 불가능해진다). `prefers-reduced-motion`이 켜져 있으면 글리치와 곡률 애니메이션을 끈다. 녹색/앰버 조합은 흔한 색각 이상에서도 구분된다.

## 7. 기술 스택

- Vite + React + TypeScript
- Zustand (UI 상태)
- Vitest (단위 테스트), Playwright (스모크)
- 터미널: **직접 구현한 DOM 컴포넌트**. xterm.js가 아니다.

xterm.js를 쓰지 않는 이유는 두 가지다. 우리 셸은 ANSI 이스케이프를 거의 쓰지 않으므로 300KB짜리 에뮬레이터가 필요 없고, xterm.js는 canvas/WebGL로 그리기 때문에 이 프로젝트의 핵심인 인광 글로우·주사선·곡률·글리치를 입히기가 까다롭다. 직접 만든 DOM 터미널은 히스토리(`↑` `↓`), Tab 자동완성, `Ctrl+C` / `Ctrl+L`만 처리하면 되고, CSS로 무엇이든 할 수 있다.

## 8. 오류 처리

### 셸 오류와 엔진 한계를 구분한다

셸이 내는 오류는 게임의 버그가 아니다. `cat nope.txt`가 `No such file or directory`를 뱉는 것은 정상 동작이며, 그대로 stderr에 찍혀야 한다. 사용자는 실패에서 배운다.

그러나 **우리가 구현하지 않은 명령**은 전혀 다른 사건이다. `rsync`에 대해 `command not found`를 반환하면 사용자는 자기가 명령어를 틀리게 입력한 줄 알고 시간을 낭비한다. 두 메시지를 분리한다.

```
bash: rsyncc: command not found                 ← 사용자의 오타
flashshell: rsync: 이 환경에는 없는 명령입니다     ← 엔진의 한계. 정직하게 밝힌다.
```

### 무한 루프

`while true; do :; done`은 반드시 입력된다. 인터프리터는 실행 스텝 카운터를 유지하고 상한을 넘으면 중단한다.

```
^C  flashshell: 실행 한도 초과 — 무한 루프인가요?
```

### 검증기 예외

`check()` 호출은 항상 try/catch로 감싼다. 예외가 발생하면 콘솔 경고만 남기고 "아직 정답 아님"으로 처리한다. 출제자의 버그가 플레이어의 크래시가 되어서는 안 된다.

## 9. 테스트 전략

두 개의 장치가 이 프로젝트의 성패를 가른다.

### 진짜 bash에 대한 골든 테스트

픽스처마다 명령을 적어두고, 로컬의 실제 bash로 실행해 기대 출력을 뽑아 저장한다. 우리 셸이 동일한 결과를 내는지 대조한다. "bash 서브셋"이라는 주장을 검증 가능한 명제로 바꾸는 유일한 방법이다. 이것이 없으면 우리가 만든 것은 그저 bash처럼 생긴 무언가다.

### 모든 모범답안은 자기 검증기를 통과해야 한다

50개 문제 전부에 대해 자동으로 도는 테스트다.

```ts
for (const p of allProblems) {
  it(`${p.id}: solution passes check`, async () => {
    const shell = createShell(setupFor(p))
    const result = await shell.exec(p.solution)
    expect(p.check({
      fs: shell.fs, lastResult: result,
      history: [p.solution], cwd: shell.cwd,
    })).toBe(true)
  })

  it(`${p.id}: wrong answer fails check`, async () => {
    const shell = createShell(setupFor(p))
    const result = await shell.exec(p.wrongAnswer)
    expect(p.check({
      fs: shell.fs, lastResult: result,
      history: [p.wrongAnswer], cwd: shell.cwd,
    })).toBe(false)
  })
}
```

음성 테스트가 짝을 이루는 이유가 있다. 검증기는 두 방향으로 틀릴 수 있다. 정답을 거부하거나, 오답을 받아주거나. **후자가 더 나쁘고 더 흔하다.**

### UI

Playwright 스모크 하나. 한 문제를 실제로 풀고 바텀시트가 올라오는지 확인한다.

## 10. 마일스톤

각 단계가 끝나는 시점에 게임은 플레이 가능한 상태여야 한다.

| | 내용 | 산출물 |
|---|---|---|
| **M0** | 스캐폴드 + CRT 셸 껍데기. 셸은 에코만 한다. | 비주얼 확정 |
| **M1** | 1층 엔진 + 코어유틸 30개 + L1·L2 문제 20개 | **최초 플레이 가능** |
| **M2** | 2층 엔진 + L3·L4·L5 문제 30개 | **사용자 테스트 지점** |
| **M3** | 3층 엔진 + 폴리시 | 최종 |

M2 이후 사용자 테스트를 거쳐 M3로 진입한다.

## 11. 위험 요소

**범위 폭주.** bash를 "제대로" 만들기 시작하면 끝이 없다. 유일한 방어선은 계층 구조와, 각 층 끝에서 게임이 반드시 돌아가야 한다는 규칙이다. 3층까지 다 짓고 나서 UI를 시작하면 이 프로젝트는 완성되지 않는다.

**검증기의 거짓 양성.** 문제마다 붙는 음성 테스트가 이를 막는다.

**단색 UI의 접근성.** Dual Phosphor와 `prefers-reduced-motion` 대응이 이를 막는다.

**출제 난이도.** 좋은 문제를 만드는 일은 엔진을 만드는 일만큼 어렵다. 문제는 엔진이 지원하는 범위 안에서만 출제한다. 이것이 우리가 문제를 직접 출제한다는 사실의 이점이다.
