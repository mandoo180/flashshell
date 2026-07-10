# FlashShell M2 Part 2 — Layer-2 엔진 + L5 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로 태스크별 실행. 스텝은 체크박스(`- [ ]`).

**Goal:** bash 서브셋 인터프리터에 2층(제어 흐름 + 함수 + 위치인자 + source + shebang)을 얹고 L5 스크립팅 문제 10개를 추가해, 게임이 L1~L5 50문제 전부 플레이 가능해지게 한다.

**Architecture:** 기존 순수 TS 엔진(`src/shell/**`: lexer → parser → expand → interpreter → builtins/coreutils)을 확장한다. Part 1의 Web Worker 실행 격리(2000ms wall-clock 데드라인)가 모든 폭주의 백스톱이므로, 2층 반복문은 그 위에 **반복당 `spend()`** 예산까지 얹어 이중으로 막는다. AST의 `PipelineNode.commands`를 `CommandNode[]`에서 `Command` 유니온으로 넓히고 인터프리터가 `node.kind`로 분기한다. 함수는 공유 ctx(env 공유, 위치인자만 교체)에서, `source`/shebang은 파싱한 파일 본문을 공유 ctx에서 재실행한다.

**Tech Stack:** Vite + React 19 + TypeScript(strict) + Zustand 5, Vitest 4, Playwright. Ground truth = `debian:stable-slim`의 bash 5 / GNU coreutils.

**Base:** 브랜치 `worktree-flashshell-m2-part2`, base `92b1a0b`(= Part 1 HEAD; Part 1의 워커·코어유틸·L3/L4 전부 포함, 미머지). 베이스라인 885 단위 + 6 e2e + 18 골든 초록.

## Global Constraints (모든 태스크에 암묵 적용)

- **엔진 순수성:** `src/shell/**`는 상대경로 import만, 호스트 글로벌 금지(`window document localStorage process Buffer require __dirname global` 등). `src/shell/no-node-imports.test.ts`가 새 파일까지 기계적으로 강제. `TextEncoder`/`globalThis`는 허용.
- **Ground truth = bash 5 / GNU (`debian:stable-slim`).** macOS BSD 아님. 의심되면 `docker run --rm debian:stable-slim bash -c '...'`.
- **`localeCompare` 금지**(C 로케일 바이트 순서). errno→텍스트는 `src/shell/errors.ts`의 `errnoText` 하나만.
- **`exec()`는 절대 reject 하지 않는다.** 모든 런타임 실패는 `ExecResult`(exitCode 2 등)로. `ExecutionLimitError`만 예외로 전파돼 exit 130 + `^C  flashshell: 실행 한도 초과 — 무한 루프인가요?`로 보고된다. 새 2층 코드는 이 계약을 반드시 지킨다(`ExecutionLimitError` 외 전부 catch).
- **`check(ctx)`는 `ctx.fs`/`ctx.lastResult`만 읽는다**(절대 `ctx.history` 아님). L5 문제도 동일 — 스크립트가 만든 **파일시스템 상태**로 판정.
- **미구현 명령 메시지 분리:** 우리가 아직 없는 명령은 `flashshell: NAME: 이 환경에는 없는 명령입니다`(exit 127), 사용자 오타는 `bash: NAME: command not found`.
- **계획 코드는 가설이다.** M1/Part1에서 손으로 쓴 계획 코드에 60+ 실결함이 있었고 전부 실행(대개 Docker bash 대조)으로 잡혔다. 태스크마다 TDD + Docker 차등 대조 + 실행 기반 리뷰.
- **각 태스크 끝에 게임은 플레이 가능**하고 전체 스위트가 초록이어야 한다.
- **멀티라인 회피 전략(중요):** 골든 하네스(`tests/shell/golden.test.ts` `runCase`)와 문제 하네스(`tests/problems.test.ts` `runAnswer`)는 입력을 `\n`으로 쪼개 각 줄을 **따로** `exec` 한다. 이를 **바꾸지 않는다.** 대신 (a) 제어문 골든 케이스·L5 solution 은 전부 **한 줄 `;`-조인 형식**(`if true; then echo hi; fi`)으로 쓰고, (b) 멀티라인 파싱(개행=분리자)은 엔진 **단위 테스트**(`run("if true\nthen echo\nfi", ...)`)로 검증하며, (c) source/shebang 의 멀티라인 본문은 `setup`이 만든 **파일 내용**에 두고 solution 은 한 줄(`source f`/`./s.sh`)로 둔다.

---

## 파일 구조

**엔진(순수 TS, `src/shell/`):**
- `lexer.ts` — 개행 분리자 + `#` 주석 (Task 1)
- `parser.ts` — `Command` 유니온 + 복합명령/함수정의 프로덕션 (Task 4–7)
- `ast.ts` (신규 또는 parser.ts 내) — 신규 AST 노드 타입
- `expand.ts` — 위치인자 확장 (Task 3)
- `interpreter.ts` — `RunCtx` 확장(functions/positional), 복합명령 실행, 반복당 spend, 함수 호출, source/shebang 경로 (Task 3–9)
- `builtins/test.ts` (신규) — `test`/`[` (Task 2)
- `builtins/source.ts` 또는 인터프리터 내 — `source`/`.` (Task 8)
- `builtins/returnbreakcontinue.ts` (신규) — `return`/`break`/`continue` 시그널 (Task 4,7)
- `types.ts` — `RunCtx`/`ShellState`/`CommandEnv` 확장

**게임(순수 TS, `src/game/`):**
- `problems/l5.ts` (신규) — L5 문제 10개 (Task 10)
- `problems/index.ts` — l5 등록 (Task 10)

**테스트:**
- `tests/shell/golden/cases/NN-*.sh` + `expected/NN-*.txt` — 신규 골든 (Task 11)
- 각 엔진 파일의 `*.test.ts` — 태스크마다

---

## Task 1: 렉서 — 개행 분리자 + `#` 주석

**Files:**
- Modify: `src/shell/lexer.ts`
- Modify/Test: `src/shell/lexer.test.ts`, `src/shell/parser.test.ts`

**Interfaces:**
- Produces: `tokenize(input)` 가 개행을 `;`와 동등한 분리자 토큰으로, `#`(따옴표 밖·단어 경계) 이후를 주석으로 버린다. 파서가 `;`/개행을 리스트 분리자로 동일 취급.

**배경(엔진 맵):** 현재 `lexer.ts:47` `if (ch === ' ' || ch === '\t' || ch === '\n')` 가 개행을 공백으로 취급해 단어만 flush → 문장 경계가 사라진다. `;`는 이미 `OP` 토큰(`Operator` 유니온, lexer.ts:10). `#` 주석 처리는 없다.

**설계 결정:** 개행을 **`;` OP 토큰으로 접는다**(fold). 즉 `\n`을 만나면 현재 단어를 flush 하고 `{type:'OP', value:';'}`를 emit. 이유: bash 는 대부분 문맥에서 개행을 `;`처럼 다루고, 우리 파서의 리스트 분리는 이미 `;`를 안다. 연속 개행/`;`은 파서가 빈 항목으로 건너뛴다(현재 `parseList`가 후행 `;` 허용, parser.ts:66-90 — 빈 파이프라인을 만들지 않게 방어). `case`의 `;;`는 Task 6에서 별도 토큰으로 다룬다(지금은 `;` 두 개로 렉싱돼도 무방하나, Task 6에서 확정).

`#` 주석: 단어의 **시작**(공백/분리자 직후, 즉 새 토큰 자리)에서 따옴표 밖 `#`를 만나면 줄 끝(`\n`)까지 버린다. 단어 **중간**의 `#`(예: `a#b`, `'#x'`)는 리터럴(bash 규약).

- [ ] **Step 1: 실패 테스트**(`lexer.test.ts`) — 아래를 bash 로 확인 후 기대값 고정:
  - `tokenize("echo a\necho b")` → `WORD(echo) WORD(a) OP(;) WORD(echo) WORD(b) EOF` (개행이 `;`로).
  - `tokenize("echo hi # 주석")` → `WORD(echo) WORD(hi) EOF` (`#` 이후 버림).
  - `tokenize("echo a#b")` → `WORD(echo) WORD(a#b) EOF` (단어 중간 `#` 리터럴).
  - `tokenize("echo '# not'")` → `WORD(echo) WORD(# not)` (따옴표 안 `#` 리터럴).
  - `tokenize("if true\nthen echo hi\nfi")` → `if`/`true`/`;`/`then`/`echo`/`hi`/`;`/`fi` 흐름.
- [ ] **Step 2: 실패 확인** — `npx vitest run --project shell src/shell/lexer.test.ts`.
- [ ] **Step 3: 구현** — `lexer.ts`: (a) 개행 분기를 공백에서 떼어내 `flush(); pushOp(';')`; (b) 새 토큰 자리에서 따옴표 밖 `#`면 `while (input[i] !== '\n' && i < len) i++` 로 스킵. 기존 `$( )` 스왈로(lexer.ts:116-121)와 따옴표 상태를 깨지 않게 주의.
- [ ] **Step 4: 통과 + 회귀** — `npx vitest run --project shell` (렉서·파서·인터프리터·no-node-imports 전부 초록). **기존 골든 18개 재확인**: `npm test` 로 `golden.test.ts` 초록(개행 fold 가 한 줄 케이스엔 영향 없음). Docker 대조: `docker run --rm debian:stable-slim bash -c 'echo a#b; echo "# x"'` 로 `#` 규약 확인.
- [ ] **Step 5: 커밋** — `feat(shell): lexer treats newline as separator and strips # comments`

---

## Task 2: `test` / `[` 빌트인

**Files:**
- Create: `src/shell/builtins/test.ts`, `src/shell/builtins/test.test.ts`
- Modify: `src/shell/builtins/index.ts` (등록)

**Interfaces:**
- Produces: 빌트인 `test`, `[`. `[`는 마지막 인자가 `]`여야 하며 아니면 exit 2 + stderr. exit 0(참)/1(거짓)/2(오류).

**배경:** 엔진 맵 §5 — `test`/`[` 미구현. `CommandFn` 형태로 깔끔히 맞는다(`RunCtx` 불필요, `CommandEnv`만). `builtins/index.ts:9-15`에 등록. `if`/`while`(Task 4)이 `[ ... ]`를 흔히 쓰므로 먼저.

**서브셋(전부 bash 로 기대값 확인):** 파일: `-e -f -d -r -w -x -s`. 문자열: `-z S` `-n S` `S`(비어있지 않으면 참) `S1 = S2` `S1 != S2`. 정수: `N1 -eq/-ne/-lt/-le/-gt/-ge N2`. 부정: `! EXPR`. `[`는 `]` 필수. (`-a`/`-o` 결합자는 서브셋 밖 — deprecated. 만나면 flashshell 거부 exit 2.) 파일 술어는 `fs.lstat`(모드·존재)로 판정.

- [ ] **Step 1: 실패 테스트**(`test.test.ts`) — bash 확인 후: `[ -f a ]`(a 파일 존재→0), `[ -d a ]`(0/1), `[ -z "" ]`(0), `[ -n x ]`(0), `[ x = x ]`(0), `[ 3 -lt 5 ]`(0), `[ 5 -lt 3 ]`(1), `[ ! -f nope ]`(0), `[ -f a`(‘]’ 없음→exit 2 stderr), `-x` 는 mode & 0o111. VFS `setup`으로 파일/디렉터리/권한 시드.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `test.ts`: `args`를 파싱(단항 연산자 / 이항 / 부정 / 단일 피연산자). `[`는 `e.name === '['`일 때 마지막 `]` 검사 후 제거. 파일 술어는 `e.fs.lstat`, 정수는 `Number.parseInt`+검증(비정수 피연산자 → exit 2 `flashshell: [: integer expression expected` 대신 bash 문구 확인). 참=exit 0(stdout 없음), 거짓=exit 1.
- [ ] **Step 4: 통과 + Docker 대조** — `docker run --rm debian:stable-slim bash -c '[ 3 -lt 5 ]; echo $?; [ -z "" ]; echo $?'` 등으로 exit code 대조.
- [ ] **Step 5: 커밋** — `feat(shell): test / [ builtin`

---

## Task 3: 위치 매개변수 ($1..$9, $@, $*, $#)

**Files:**
- Modify: `src/shell/expand.ts` (`ExpandCtx` + `expandDollar`), `src/shell/interpreter.ts` (`RunCtx` + `expandCtxFor` + `run`), `src/shell/types.ts`
- Test: `src/shell/expand.test.ts`, `src/shell/interpreter.test.ts`

**Interfaces:**
- Produces: `run(line, fs, state, stepBudget, positional?)` 가 선택적 `positional: string[]`를 받는다. 확장기가 `$0`(스크립트/함수명 자리, 지금은 빈 문자열 허용) `$1..$9` `${N}` `$@` `$*` `$#`를 확장. Task 7(함수)·8(source)·9(shebang)가 이 필드를 세팅.

**배경(엔진 맵 §3,§7):** `expand.ts:75-78`의 이름 regex `^[A-Za-z_]...`가 숫자/기호로 시작하는 `$1`/`$@`/`$*`/`$#`를 못 잡아 리터럴로 흘린다(의도적, 주석 72-74). `ExpandCtx`(expand.ts:6-13)엔 `env`만 있고 positional 없음. `RunCtx`(interpreter.ts:21-25)에도 없음. `expandCtxFor`(interpreter.ts:42-62)가 `RunCtx`→`ExpandCtx` 변환.

**서브셋:** `$1`..`$9`, `${N}`(두 자리 이상 포함, `${10}`), `$#`(개수), `$*`(IFS 첫 글자로 join — 우리 IFS 는 `[' ','\t','\n']`이므로 스페이스), `$@`(비따옴표: 단어별로 분리 — 기존 `splitFields` 활용). `"$@"`의 per-arg 따옴표 보존(각 인자가 개별 필드)은 이 태스크에서 **기본형만**(비따옴표 `$@`=단어분리, `$*`=조인) 구현하고, `"$@"`의 정밀 per-arg 동작은 주석으로 Layer-3 이연 표시(단, `"$@"`가 단순 조인으로라도 동작은 하게). `$0`은 빈 문자열(또는 세팅되면 그 값).

- [ ] **Step 1: 실패 테스트**(`interpreter.test.ts`, `run`에 positional 주입) — bash 확인 후:
  - `run("echo $1 $2", fs, state, budget, ['a','b'])` → stdout `a b\n`.
  - `run("echo $#", ..., ['a','b','c'])` → `3\n`.
  - `run('echo "$*"', ..., ['a','b'])` → `a b\n`.
  - `run("echo $@", ..., ['x','y'])` → `x y\n`.
  - `run("echo ${1}0", ..., ['7'])` → `70\n`.
  - `run("echo $1", ..., [])` → 빈 줄(미설정 위치인자=빈 문자열).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — (a) `types.ts`/`interpreter.ts`: `RunCtx`에 `positional: string[]` 추가, `run`에 5번째 선택 인자 `positional: string[] = []`, `childCtx`가 positional 복사(함수/서브셸이 저장·교체할 수 있게 — Task 7). (b) `expandCtxFor`가 `positional`을 `ExpandCtx`로 전달. (c) `expand.ts`: `ExpandCtx`에 `positional: string[]`; `expandDollar`에서 이름 regex **앞에** `$#`/`$@`/`$*`/`$0-9` 분기 추가, `${...}` 경로(expand.ts:63)에도 `${N}` 지원. `$@`/`$*`는 `splitFields`/join 활용.
- [ ] **Step 4: 통과 + Docker 대조** — `docker run --rm debian:stable-slim bash -c 'set -- a b c; echo $1 $#; echo "$*"; echo $@'`.
- [ ] **Step 5: 커밋** — `feat(shell): positional parameters $1..$@ $* $# in expander`

---

## Task 4: 파서 스캐폴딩 + `if` + `while`/`until` + `break`/`continue`

**Files:**
- Modify: `src/shell/parser.ts` (AST 유니온 확대 + 프로덕션), `src/shell/interpreter.ts` (`runCommand` 분기 + `runIf`/`runWhile`), `src/shell/builtins/` (`break`/`continue` 시그널)
- Test: `src/shell/parser.test.ts`, `src/shell/interpreter.test.ts`

**Interfaces:**
- Produces: `PipelineNode.commands` 가 `Command` 유니온(`CommandNode | IfNode | WhileNode | ForNode | CaseNode | FunctionDefNode | GroupNode`)이 된다(뒤 태스크가 나머지 kind 추가). `runCommand(node: Command, ctx, stdin)`가 `node.kind`로 분기. `BreakSignal`/`ContinueSignal`(레벨 1) 예외로 루프 탈출.

**배경(엔진 맵 §2,§4):** 파서는 재귀하강(`class Parser`, parser.ts:53-140). `parsePipeline`(:93)이 항상 `parseCommand()`를 부른다 → 여기서 `parseCommandOrCompound()`로 교체. 예약어 인식은 파서 레벨(첫 WORD의 텍스트 검사; bash 예약어는 명령 위치에서만 예약). 인터프리터 `runCommand`(:66)에 `switch(node.kind)` 추가. `runList`(:272)가 본문 실행 프리미티브. `spend`(:27-29)는 명령당 1회 — 루프 각 반복 상단에 `spend(ctx)` 명시적으로 추가(no-op 본문도 예산에 걸리게).

**AST 타입(신규, parser.ts 또는 ast.ts):**
```ts
export interface IfNode {
  kind: 'if'
  cond: ListNode
  then: ListNode
  elifs: { cond: ListNode; then: ListNode }[]
  else?: ListNode
}
export interface WhileNode {
  kind: 'while'
  cond: ListNode
  body: ListNode
  until: boolean   // `until`이면 조건 반전
}
export type Command = CommandNode | IfNode | WhileNode  // Task 5,6,7에서 확대
```
`CommandNode`에 `kind: 'command'`가 이미 있으므로(parser.ts:6-11) 유니온 판별 가능.

**문법(서브셋):** `if LIST; then LIST; [elif LIST; then LIST;]* [else LIST;] fi`. `while LIST; do LIST; done`, `until LIST; do LIST; done`. 세미콜론/개행은 Task 1로 동등. 예약어(`then`/`fi`/`do`/`done`/`elif`/`else`)를 만나면 해당 LIST 종료.

- [ ] **Step 1: 실패 테스트** — bash 확인 후(전부 한 줄 `;` 및 멀티라인 둘 다):
  - `run("if true; then echo yes; fi")` → `yes\n` exit 0.
  - `run("if false; then echo yes; else echo no; fi")` → `no\n`.
  - `run("if false; then :; elif true; then echo e; fi")` → `e\n`.
  - `run("i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done")` — **주의: `$(( ))` 산술은 3층.** 대신 반복 카운터 없이 조건 기반으로: `run("while [ -f flag ]; do rm flag; done")`(파일 있으면 1회 돌고 삭제→종료) 또는 seq 없이 테스트. **산술 없이 종료하는 while 예제로 작성**(예: 파일 존재 조건). 무한루프 예산: `run("while true; do :; done")` → exit 130 + `실행 한도 초과`.
  - `break`/`continue`: `run("while true; do echo x; break; done")` → `x\n` exit 0.
  - 멀티라인 파싱 동등: `run("if true\nthen echo hi\nfi")` === `run("if true; then echo hi; fi")`.
  - parser.test: `parse("if true; then echo hi; fi")` AST 구조 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — (a) parser: `Command` 유니온, `PipelineNode.commands: Command[]`, `parseCommandOrCompound()`(첫 WORD 텍스트가 `if`/`while`/`until`이면 복합), `parseIf`/`parseWhile`(본문은 `parseList`까지 예약어 만나면 멈추게 — 리스트 파서에 “종료 예약어” 개념 도입). (b) interpreter `runCommand`에 `switch`; `runIf`(cond 실행→exitCode 0이면 then, 아니면 elif/else), `runWhile`(**루프 상단 `spend(ctx)`**, cond 실행, until이면 반전, body 실행, `BreakSignal`/`ContinueSignal` catch). (c) `break`/`continue` 빌트인: `throw new BreakSignal(n)` 같은 제어 예외(인터프리터 루프가 catch, 그 외 경계는 통과시켜 `exec`가 exit 2로 안 잡게 — `ExecutionLimitError`처럼 특별 취급). 루프 밖 break/continue 는 bash 처럼 경고 후 무시 또는 그대로 전파해 최상위에서 무해 처리.
- [ ] **Step 4: 통과 + 회귀 + Docker** — `npx vitest run --project shell`; 예산 테스트(`interpreter.test.ts` while true → exit 130) 초록; `docker run --rm debian:stable-slim bash -c 'if false; then echo y; elif true; then echo e; fi'`.
- [ ] **Step 5: 커밋** — `feat(shell): if / while / until + break / continue`

---

## Task 5: `for x in ...; do ...; done`

**Files:** Modify `src/shell/parser.ts`, `src/shell/interpreter.ts`; Test 동일.

**Interfaces:** Produces `ForNode { kind:'for'; var: string; words: Word[]; body: ListNode }`를 `Command` 유니온에 추가. `runFor`가 `words`를 `expandWord`로 확장(단어분리·글롭 자동)해 각 값을 `var`에 넣고 body 실행(반복당 `spend`).

**배경:** 확장기의 `splitFields`(expand.ts:83)와 `expandWord`(:126)가 이미 단어분리/글롭을 하므로 `for x in $list`·`for x in *.txt`가 공짜로 된다. body는 `ListNode` 재사용.

- [ ] **Step 1: 실패 테스트** — bash 확인 후: `run("for x in a b c; do echo $x; done")` → `a\nb\nc\n`. `for f in *.txt; do ...`(setup 파일). `for x in $var; do ...`(단어분리). `break`/`continue` 동작. 빈 목록 `for x in; do echo $x; done` → 출력 없음. 무한 안전: 목록 유한이므로 예산은 반복당 spend 로만.
- [ ] **Step 2–4:** 구현(`parseFor`: `for NAME in WORDS; do LIST; done`; `runFor`: words 확장→루프, 반복당 `spend(ctx)`, Break/Continue catch) → 통과 → Docker 대조 `for x in a b c; do echo $x; done`.
- [ ] **Step 5: 커밋** — `feat(shell): for-in loop`

---

## Task 6: `case ... in ... esac`

**Files:** Modify `src/shell/lexer.ts`(`;;` 토큰), `src/shell/parser.ts`, `src/shell/interpreter.ts`; Test 동일.

**Interfaces:** Produces `CaseNode { kind:'case'; word: Word; branches: { patterns: Word[]; body: ListNode }[] }`. `runCase`가 `word` 확장 후 각 branch 의 patterns(글롭 매칭)와 대조, 첫 매치 body 실행.

**배경:** `case`는 `;;`로 branch 종료. 렉서에 `;;`를 `OP`로 추가(현재 `;` 두 개로 렉싱됨 — Task 1 주석 참고). 패턴 매칭은 기존 글롭 매처(`matchSegment`류) 재사용. `*)`가 기본.

- [ ] **Step 1: 실패 테스트** — bash 확인: `run("case hi in h*) echo H;; *) echo other;; esac")` → `H\n`. `case foo in a) echo a;; b) echo b;; esac` → 출력 없음(매치 없음, exit 0). `|` 다중 패턴 `a|b)`.
- [ ] **Step 2–4:** 렉서 `;;`; `parseCase`; `runCase`(패턴 글롭 매칭) → 통과 → Docker `case hi in h*) echo H;; esac`.
- [ ] **Step 5: 커밋** — `feat(shell): case statement`

---

## Task 7: 함수 (`name() { }`, 브레이스 그룹, `return`, 위치인자 교체)

**Files:** Modify `src/shell/parser.ts`(함수정의 + 그룹), `src/shell/interpreter.ts`(functions 맵 + 호출 + return); Create `src/shell/builtins/returnbuiltin` (또는 Task 4 파일에); Test 동일.

**Interfaces:** Produces `FunctionDefNode { kind:'funcdef'; name: string; body: ListNode }`, `GroupNode { kind:'group'; body: ListNode }`(`{ ...; }`). `RunCtx`에 `functions: Map<string, ListNode>` 추가. 함수 호출은 **공유 ctx**(env 공유)에서 body 실행하되 `positional`만 인자로 교체(저장·복원). `return N`은 `ReturnSignal`로 함수 경계까지 언와인드.

**배경(엔진 맵 §4):** 함수는 bash 에서 새 env 를 안 뜬다(호출자 var 공유·변경 가능) → `childCtx` 아님, 현재 ctx 그대로 쓰되 positional 만 swap. `( )` 서브셸은 3층이므로 Part 2 범위 밖(단 `{ }` 그룹은 함수 본문에 필요). 함수 호출은 `CommandFn`(CommandEnv만 봄)이 아니라 **인터프리터 레벨**에서 처리(positional/functions 는 RunCtx 에 있음) — `runCommand`에서 명령 이름이 `ctx.functions`에 있으면 함수 호출로 분기.

**문법:** `NAME () { LIST; }` 또는 `function NAME { LIST; }`. `{ LIST; }`는 그룹(현재 ctx 에서 LIST 실행). 파서는 `parseCommandOrCompound`에서 첫 WORD 뒤에 `()` 형태(또는 `function` 예약어)면 함수정의로, `{`면 그룹으로.

- [ ] **Step 1: 실패 테스트** — bash 확인:
  - `run("greet() { echo hi $1; }; greet bob")` → `hi bob\n`.
  - `run("f() { return 3; }; f; echo $?")` → `3\n`.
  - 함수가 env 공유: `run("setx() { x=5; }; setx; echo $x")` → `5\n`.
  - 위치인자 복원: `run("f() { echo $1; }; f a; echo $1")` → `a\n\n`(함수 밖 $1 빈 문자열; 최상위 positional 없음).
  - 그룹: `run("{ echo a; echo b; }")` → `a\nb\n`.
- [ ] **Step 2–4:** 구현(파서 함수정의/그룹; `runCommand`에서 funcdef 는 `ctx.functions.set(name, body)` 후 exit 0; 명령 이름이 함수면 `const saved = ctx.positional; ctx.positional = args; try { runList(body) } catch ReturnSignal ... finally { ctx.positional = saved }`; `return` 빌트인은 `ReturnSignal(code)` throw, 인터프리터 함수 경계가 catch) → 통과 → Docker `f() { echo $1; }; f x`.
- [ ] **Step 5: 커밋** — `feat(shell): shell functions, brace groups, return`

---

## Task 8: `source` / `.`

**Files:** Modify `src/shell/interpreter.ts`(source 를 인터프리터 레벨에서; 또는 `CommandEnv`에 positional 노출 후 builtin) ; Create `src/shell/builtins/source.ts` (가능하면); Test.

**Interfaces:** Produces 빌트인 `source FILE [args]` 와 `. FILE [args]`. FILE 을 VFS 에서 읽어 파싱(멀티라인, Task 1)하고 **현재(공유) ctx**에서 실행. args 가 있으면 그 동안 positional 교체(source 후 복원). 파일 없으면 `bash: source: FILE: No such file or directory` exit 1.

**배경(엔진 맵 §5):** source 는 호출자 상태를 바꿔야 하므로 공유 ctx 재실행이 필요 — `CommandEnv.runLine`(interpreter.ts:189-195)이 공유 ctx 에서 도는 재진입 프리미티브. 하지만 `runLine(line)`은 한 줄이고 `parse(line)`가 개행을 처리(Task 1 이후 OK). positional 을 source 인자로 바꾸려면 `CommandEnv`에 positional 접근이 필요 → source 를 인터프리터 레벨 특수 처리로 두거나(권장), `CommandEnv.runLine`을 `runLine(script, positional?)`로 확장.

- [ ] **Step 1: 실패 테스트** — bash 확인: setup 이 `conf.sh`에 `x=5\ny=$1`(멀티라인) 저장 → `run("source conf.sh arg1; echo $x $y")` → `5 arg1\n`. `. conf.sh` 동일. 없는 파일 → exit 1 stderr. source 가 함수 정의도 로드: `lib.sh`에 `hello() { echo hi; }` → `source lib.sh; hello` → `hi\n`.
- [ ] **Step 2–4:** 구현 → 통과 → Docker(임시 파일로 `source`).
- [ ] **Step 5: 커밋** — `feat(shell): source / . builtin`

---

## Task 9: shebang 실행 (`./script.sh`)

**Files:** Modify `src/shell/interpreter.ts`(`runCommand`의 lookupCommand 실패 경로), `src/shell/vfs.ts`(필요 시 exec 비트 헬퍼); Test.

**Interfaces:** Produces `./script.sh [args]`(또는 경로에 `/` 포함) 실행: VFS 에서 resolve → 존재·exec 비트(`lstat.mode & 0o111`) 확인 → 파일 읽어 `#!` 첫 줄 확인 → 본문을 파싱해 실행(positional = args). exec 비트 없으면 `bash: ./script.sh: Permission denied` exit 126, 없는 파일 `No such file or directory` exit 127.

**배경(엔진 맵 §6):** 현재 파일 실행 경로 **전무** — `./s.sh` → command not found 127. `runCommand`에서 `lookupCommand(name)` 실패(interpreter.ts:170-176) 시 `name`에 `/`가 있으면 VFS 실행 시도. **서브셸 격리 결정:** shebang 스크립트는 bash 에서 **새 프로세스**(subshell)라 env 변경이 밖으로 안 샌다 → `childCtx`(env 복사)에서 실행하되 positional = args. (source 와 대비: source=공유, `./script`=격리.)

- [ ] **Step 1: 실패 테스트** — bash 확인: setup 이 `deploy.sh`에 `#!/bin/bash\necho deploying $1` 저장 + `chmod +x` → `run("./deploy.sh prod")` → `deploying prod\n`. exec 비트 없으면 exit 126. env 격리: 스크립트 안 `x=9` 가 밖 `$x`에 안 샘.
- [ ] **Step 2–4:** 구현(`runCommand`: name 에 `/` 포함 & lookup 실패 → `resolvePhysical`/`lstat`/`readFile`; `#!` 무시하고 본문 파싱; `childCtx`+positional 로 `runList`) → 통과 → Docker(임시 스크립트).
- [ ] **Step 5: 커밋** — `feat(shell): shebang script execution`

---

## Task 10: L5 스크립팅 문제 10개

**Files:** Create `src/game/problems/l5.ts`; Modify `src/game/problems/index.ts` (l5 등록 → `allProblems` 50개).

**배경:** `tests/problems.test.ts`가 자동 검증(solution 통과+stderr 빈, wrongAnswer 실패, 사전풀림 없음, rm-rf 후 check 안 던짐). **`runAnswer`가 `\n`으로 쪼개므로 solution/wrongAnswer 는 한 줄 `;`-조인**(멀티라인 스크립트는 setup 파일에 두고 solution 은 `./s.sh`/`source f`). check 는 `ctx.fs`/`ctx.lastResult`만. import `safeRead, safeReaddir, safeWalk, trimEq`.

**서브셋:** if/for/while/case, 함수, test/[, 위치인자, source, shebang, 그리고 L1~L4 명령. **제어문을 *가르치되* 상태로 판정 가능하게 설계**(M2-SEAMS §4).

- [ ] **Step 1: `l5.ts` 작성 (10개).** 각 문제 실제 셸로 solution 돌려 기대 상태 확정 후 check 작성. 확정 스펙(구현 시 bash·엔진으로 검증):
  ```
  l5-01 "일괄 이름변경": for 로 *.txt 를 *.bak 으로. setup a.txt b.txt.
    solution: for f in *.txt; do mv "$f" "${f}.bak"; done  (주의: ${f} 기본형만 필요)
    → 필요 시 단순화: for f in a b; do mv $f.txt $f.bak; done
    check: *.bak 존재 && *.txt 없음.  wrong: mv *.txt done/ 류(한 개만/실패).
  l5-02 "조건 분기 생성": if [ -f flag ] 로 파일 존재에 따라 다른 결과.
  l5-03 "카운트 루프": while [ 조건 ] 로 파일들 처리(산술 없이 파일 소비형).
  l5-04 "case 분류": case 로 확장자별 디렉터리 분류.
  l5-05 "함수로 반복 작업": f() { ... }; f a; f b 로 여러 파일 생성.
  l5-06 "설정 로드(source)": source config.sh 로 변수 얻어 그 값으로 디렉터리 생성.
  l5-07 "스크립트 실행(shebang)": ./setup.sh 를 실행해 트리 생성. chmod +x 는 setup.
  l5-08 "test 로 검증 후 생성": [ -d dir ] || mkdir dir 류.
  l5-09 "위치인자 스크립트": ./mk.sh name 이 name 디렉터리 생성.
  l5-10 "루프+조건 종합": for + if 조합으로 특정 파일만 이동.
  ```
  각 문제는 **상태 기반 check** 필수. solution 한 줄. 멀티라인 필요 문제(06/07/09)는 스크립트를 setup 파일에 넣고 solution 은 `source`/`./`.
- [ ] **Step 2–4:** index 등록 → `npx vitest run --project shell tests/problems.test.ts`(50문제 × 4) 초록. 빨간불이면 문제 수정. 실제 셸로 기대 확정.
- [ ] **Step 5: 커밋** — `feat(game): L5 scripting problems`

---

## Task 11: 골든 케이스 (제어흐름·함수·source·shebang)

**Files:** Create `tests/shell/golden/cases/19..NN-*.sh` + `expected/*.txt`; Modify `tests/shell/golden.test.ts`의 `seedVfs()`(필요 시 시드 파일 추가) + `golden/seed.sh`(문서용 동기화).

**배경:** 하네스는 안 바꾼다(한 줄씩 exec). 제어흐름 케이스는 **한 줄 `;`-조인**. source/shebang 케이스는 seedVfs 가 만든 파일 + 한 줄 solution. 새 명령/구문이 실제 bash 와 바이트 일치하는지 고정. `npm run golden`(Docker)로 재생성 → `git status` 바이트 동일.

- [ ] **Step 1:** 케이스 추가(예): `19-if-elif`(`if false; then echo a; elif true; then echo b; fi`), `20-for-glob`(`for f in *.txt; do echo $f; done`), `21-while-file`(파일 소비 while), `22-case`(`case hi in h*) echo H;; esac`), `23-function`(`f() { echo $1; }; f x`), `24-source`(seedVfs 에 `conf.sh` 추가 후 `source conf.sh; echo $x`), `25-shebang`(seedVfs 에 exec 스크립트 + `./s.sh`). seed.sh 에 해당 파일 생성 명령 문서화(bash 재생성과 동기화).
- [ ] **Step 2:** `npm run golden`(Docker 필요) 로 expected 재생성 → `git status tests/shell/golden` 비어야 함(우리 셸 == bash). 불일치면 엔진 수정(케이스가 서브셋 안이면).
- [ ] **Step 3: 커밋** — `test(golden): control-flow / function / source / shebang cases`

---

## Task 12: 최종 검증 + 플레이스루 + 마무리

**Files:** 없음(검증). 필요 시 e2e 확장.

- [ ] **Step 1:** 전체 게이트 — `npm run build && npm test && npm run e2e` 초록. `npm run golden` 재생성 후 `git status` 바이트 동일.
- [ ] **Step 2:** `npm run dev` 실제 브라우저 — L5 한 문제(예: for 루프, 함수)를 실제로 풀어 시트가 뜨는지. `while true; do :; done` 을 쳐서 탭이 안 얼고 130 후 복원되는지(Part 1 워커 데드라인 + 반복당 spend). 스크린샷 `.superpowers/sdd/m2-part2-play.png`.
- [ ] **Step 3:** `KNOWN_UNIMPLEMENTED`에 `test`/`[`/`source` 등 새 구현분이 없는지 확인(빌트인은 애초에 그 집합 밖이지만 확인).
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` 로 마무리. **M2 전체(Part 1 + Part 2) 완료** — 사용자 테스트 후 M3(3층 + 폴리시)로.

## 완료 조건

- `npm run build` 타입 에러 0.
- `npm test` — 셸 단위, 골든(25+ 케이스), 문제(50문제 × 4), UI 전부 초록.
- `npm run e2e` — smoke + worker + hud 초록.
- `npm run dev` — L1~L5 50문제 실제 플레이. `while true` 무한루프가 탭을 안 얼림(워커 데드라인 + 반복당 spend). if/for/while/case/함수/source/shebang 실동작.

## Part 3(M3)로 이연 — 별도 계획

3층: 배열, here-doc, subshell `( )`, 파라미터 확장 전체(`${x:-y}` `${x//a/b}` `${#x}`), `$(( ))` 산술, `IFS` env 연동, `read`, `"$@"` per-arg 정밀. + 최종 폴리시. `docs/superpowers/specs/2026-07-09-flashshell-design.md` §5 3층 참조.
