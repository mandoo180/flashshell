# FlashShell M3 Part 3 — 데이터 & I/O (배열 + read + 컴파운드 리다이렉션 + while read) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로 태스크별 실행. 스텝은 체크박스(`- [ ]`).

**Goal:** 3층의 데이터/IO 부분을 얹는다 — 인덱스 배열(`arr=(a b c)`, `${arr[@]}`, `${#arr[@]}`, `arr[i]=x`), `read` 빌트인, 컴파운드 명령 리다이렉션(`while..done < f`, `for..done > f`, `( )>f`, `if..fi>f` — Part 2 최우선 minor 동시 해결), 그리고 `while read` 를 위한 mutable stdin 커서. **here-doc 은 이연** — 게임의 per-line exec 모델(store/골든/문제 하네스 전부 `\n` split, 플레이어는 Enter마다 한 줄)에서 멀티라인 here-doc 본문은 **관측 불가**(source/shebang 파일 내용으로만 도달). ROI가 낮아 M3 Part 4(polish) 또는 별도로 미룬다.

**Architecture:** 배열은 새 데이터 타입 — `ShellState.arrays: Map<string,string[]>`(childCtx/execScriptFile 격리 복사), 파서의 `arr=(...)`/`arr[i]=` 파싱, 확장기의 `${arr[i]}`/`${arr[@]}`(기존 `Field.breaks` per-arg 재사용). `read` 는 `e.stdin` 위의 작은 빌트인. 컴파운드 리다이렉션은 `WhileNode`/`ForNode`/`IfNode`/`CaseNode`/`GroupNode`/`SubshellNode` 에 `redirs` 필드를 달고 종결 키워드 뒤에서 파싱·적용. `while read` 는 루프가 stdin(리다이렉션 또는 파이프)을 커서로 열고 매 반복 `read` 가 한 줄씩 소비.

**Tech Stack:** Vite + React 19 + TS(strict), Vitest, Playwright. Ground truth = `debian:stable-slim` bash 5.

**Base:** 브랜치 `worktree-flashshell-m3-part3`, base `61c84f6`(= M2 + M3 Part 1 + Part 2 완료, main HEAD). 베이스라인 1442 단위 + 6 e2e + 32 골든 초록.

## Global Constraints

- **엔진 순수성**(`no-node-imports.test.ts`: `src/shell/**` 상대경로만, Node/DOM 전역 금지, `TextEncoder`만 허용). **ground truth = bash 5**. **`localeCompare` 금지**(`errnoText`). Sizes = 실제 UTF-8 바이트.
- **`exec()`는 절대 reject 안 함**(`ExecutionLimitError`만 exit 130). 새 코드는 그 외 전부 catch → graceful nonzero.
- **`check(ctx)`는 fs/lastResult만.** 새 문제 없음(50 고정) — 회귀 없어야.
- **기존 동작 보존:** 1442 단위 + 32 골든 초록 유지. golden 바이트 동일(`npm run golden`, Docker).
- **패턴 매칭 RegExp 금지**(ReDoS — Part 1 교훈). glob 은 `matchSegment`.
- **모든 무한 경로는 per-unit `spend()` + 2000ms Worker 데드라인으로 bounded.** `while read`(무한 입력 아님)도 루프 본문이 `spend()`를 소비.
- **계획 코드는 가설이다.** TDD + Docker 차등 + 실행 리뷰. 각 태스크 끝에 게임 플레이 가능 + 전체 초록.

## 엔진 맵 (M3 Part 3 리서치, base 61c84f6) — 핵심 시임

- **배열 저장:** `types.ts:16-23` `ShellState{cwd,oldPwd,env:Record<string,string>,lastExitCode,home,functions:Map}` — 배열 저장 없음. `childCtx`(interpreter.ts:94-112) `state:{...ctx.state, env:{...ctx.state.env}}`(97) — Map 은 `{...state}`로 **참조 공유**되므로 배열도 `arrays:new Map(ctx.state.arrays)` 명시 복사 필요(subshell 격리). `execScriptFile`(interpreter.ts:441) `child.state.env={...}` 도 동일.
- **배열 파싱:** `Assignment`(parser.ts:4)`{name,value:Word}`, `ASSIGN_RE`(:131)`/^([A-Za-z_]\w*)=(.*)$/s`, `tryAssignment`(:187-198, word[0] raw). **현재 토큰(실측):** `arr=(a b c)` → `WORD[arr=] OP(() WORD[a] WORD[b] WORD[c] OP())` → parse THROW(:316). `arr[0]=x` → `WORD[arr[0]=x]`(단일, `[`/`]` 비-메타) → ASSIGN_RE 실패 → command-not-found. 파싱 훅: `parseCommand`(:607-644) 또는 `parseCommandOrCompound`(:353) 에서 WORD 가 `=`로 끝나고 다음이 `OP('(')` 이면 `)`까지 원소 수집.
- **배열 확장:** `NAME_RE`(expand.ts:125)`/^(?:[@*#]|[0-9]+|[A-Za-z_]\w*)/` — `[` 불허 → `${arr[0]}`가 scalar 로 오인(default 분기 :475-478, 조용히 틀림). `resolveName`(:134-153), `expandBraceParam`(:387-479, 길이 `${#..}` :392-396). **재사용:** `Field.breaks`(:36)/`addBreak`(:60-62)/`"$@"` per-arg(:561-564)/`splitFields`(:610-655) — `${arr[@]}`가 이 per-arg 경로를 탄다. `substringOp`(:347-370) 슬라이스. `evalArith` 첨자. 원소 확장은 `expandWord`(:678-721, split+glob) — RHS `expandForCase`(:748, split 안 함)와 다름(bash 는 배열 원소를 split/glob).
- **read:** `CommandEnv`(types.ts:25-56)`{name,args,stdin:string,stdinFromFile,fs,state,runLine?,loopDepth?,funcDepth?}`. `CommandFn`(:59). 레지스트리 `builtins/index.ts:12-23`(read 없음, KNOWN_UNIMPLEMENTED 도 아님 → 현재 exit 127). stdin 소비 패턴 `readSources`(coreutils/shared.ts:27-46)/`cat`(cat.ts:31-38). `e.state.env[name]=...` 로 기록(export.ts:8 처럼 shared state 변이, interpreter.ts:609에서 반영).
- **컴파운드 리다이렉션(현재 없음):** `WhileNode`/`ForNode`/`IfNode`(parser.ts:26-42)에 `redirs` 없음 — `while..done < f`/`for..done > f` 전부 THROW(종결 뒤 redir 미소비 → EOF 체크 트립). `Redir`(parser.ts:3)`{fd:0|1|2, op:'>'|'>>'|'<', target:Word}`, redir 루프(parser.ts:611-638), `REDIR_OPS`(:129). 단순명령 stdin 해결: `input=stdin`(interpreter.ts:525) → `<` 읽기(:564-571) → `cmdEnv.stdin`(:609).
- **while read stdin 커서(현재 없음):** stdin 은 명령마다 **불변 문자열 복사**(interpreter.ts:525,609), 공유 커서 없음. `runWhile`(:721-763)/`runFor`(:778-825)가 `runList(node.body, ctx)`(:737,:800) — **stdin 인자 없음** → 본문 파이프라인 `initialStdin=''`(:906). 컴파운드 본문은 stdin 안 받음(Part 2 한계). `runList`의 `initialStdin`은 첫 아이템 첫 스테이지만(:899-905,916).

---

## Task 1: 배열 저장 + 격리

**Files:** Modify `src/shell/types.ts`(ShellState), `src/shell/index.ts`(createShell), `src/shell/interpreter.ts`(childCtx, execScriptFile); Test.

**Interfaces:** Produces `ShellState.arrays: Map<string, string[]>`. childCtx/execScriptFile 가 이 맵을 **복사**해 subshell/스크립트 격리(배열 변이가 밖으로 안 샘, Part 2 subshell 격리 불변식 유지). 이 태스크는 저장만 — 파싱/확장은 Task 2/3.

- [ ] **Step 1: 실패 테스트** — 새 상태 필드 존재 + childCtx 복사: 테스트 유틸로 `state.arrays` 를 세팅(예: `arrays.set('a',['x','y'])`)한 뒤 subshell 에서 배열을 바꿔도(직접 Map 조작 or Task 2 후) 밖이 안 바뀜을 확인하는 골격. 최소: `createShell()` 결과에 `arrays` 가 빈 Map 로 존재, childCtx 가 `new Map` 사본을 뜬다(참조 다름). bash 의미 근거는 Task 2/3에서.
- [ ] **Step 2~4:** `ShellState` 에 `arrays: Map<string,string[]>`; `createShell` 에서 `new Map()`; `childCtx` 스프레드에 `arrays: new Map(ctx.state.arrays)`; `execScriptFile` 격리에 동일. tsc/전체 초록(1442 유지 — 순수 추가라 회귀 0).
- [ ] **Step 5: 커밋** — `feat(shell): ShellState.arrays storage with subshell/script isolation`

---

## Task 2: 배열 대입 파싱 + 실행 (`arr=(a b c)`, `arr[i]=x`)

**Files:** Modify `src/shell/parser.ts`(Assignment, ASSIGN_RE, arr=() 파싱), `src/shell/interpreter.ts`(대입 실행); Test.

**Interfaces:** Consumes Task 1 `arrays`. Produces `arr=(a b c)` 가 `arrays.set('arr',['a','b','c'])`; `arr[2]=z` 가 인덱스 대입; 원소는 split+glob 확장(`expandWord`). `Assignment` 에 `elements?: Word[]`(배열 리터럴) + `index?: Word`(원소 대입) 추가.

**배경:** 현재 `arr=(...)` THROW, `arr[i]=x` command-not-found(엔진 맵 참고). `(`/`)` 이미 토큰이라 토큰 기반 파싱 가능.

- [ ] **Step 1: 실패 테스트** — bash 확인: `arr=(a b c); echo ${arr[1]}`→`b`(단, `${arr[1]}`는 Task 3 — 이 태스크는 저장까지만 검증 가능하면 내부 API로); 저장 확인은 `arr=(a b c)` 후 `state.arrays.get('arr')`===`['a','b','c']`. 원소 확장: `x=hi; arr=($x world)` → `['hi','world']`; `arr=(*.txt)` glob(파일 있으면 확장, 없으면 리터럴 — bash nullglob off 기본). 인덱스: `arr=(a b c); arr[1]=Z` → `['a','Z','c']`; `arr[5]=z`(sparse — bash 는 빈 칸, 우리는 최소 인덱스까지 채우거나 sparse — **bash 확인 후 결정**, `${arr[@]}`가 빈 칸 건너뜀). 빈 배열 `arr=()` → `[]`. 스칼라 대입 회귀: `x=5` 여전히 `env`.
- [ ] **Step 2~4:** 파서 — WORD 가 `NAME=` 로 끝나고 다음 토큰이 `OP('(')` 이면 `)`까지 WORD 를 원소로 수집(`Assignment.elements`); `ASSIGN_RE` 를 `/^([A-Za-z_]\w*)(\[[^\]]*\])?=(.*)$/s` 로 넓혀 `arr[i]=`(`Assignment.index`). interpreter — 대입 실행에서 `elements` 있으면 각 원소 `expandWord`(split+glob) 후 `arrays.set`; `index` 있으면 첨자 `evalArith` 후 해당 원소 교체(스칼라 대입 경로 interpreter.ts:471-476/:499-501 옆). 통과 → Docker 대조. **회귀:** 스칼라 대입/프리픽스 대입 초록.
- [ ] **Step 5: 커밋** — `feat(shell): array assignment arr=(...) and arr[i]=x (elements split+glob)`

---

## Task 3: 배열 확장 (읽기: `${arr[i]}` `${arr[@]}` `${#arr[@]}` `${!arr[@]}` 슬라이스 `$arr`)

**Files:** Modify `src/shell/expand.ts`(NAME_RE/resolveName/expandBraceParam, `$NAME` 분기); Test.

**Interfaces:** Consumes Task 1/2. Produces `${arr[0]}`(원소), `${arr[@]}`/`${arr[*]}`(전체, `[@]`는 per-arg breaks/`[*]`는 IFS[0] 조인), `${#arr[@]}`(개수)/`${#arr[0]}`(원소 길이), `${!arr[@]}`(인덱스들), `${arr[@]:1:2}`(슬라이스), bare `$arr`→`${arr[0]}`.

**배경:** `NAME_RE`가 `[` 불허 → `${arr[0]}` scalar 오인. `Field.breaks`(`"$@"` per-arg)를 `[@]`에 재사용.

- [ ] **Step 1: 실패 테스트** — bash 확인(전부): `arr=(a b c)`에서 `${arr[0]}`→`a`, `${arr[2]}`→`c`, `${arr[9]}`→``(빈), `${arr[@]}`→`a b c`, `"${arr[@]}"` per-arg(`printf '[%s]' "${arr[@]}"`→`[a][b][c]`), `"${arr[*]}"`→`a b c`(IFS[0] 조인; `IFS=,` 면 `a,b,c`), `${#arr[@]}`→`3`, `${#arr[1]}`→`1`, `${!arr[@]}`→`0 1 2`, `${arr[@]:1:2}`→`b c`, bare `$arr`/`${arr}`→`a`(원소0). 미정의 배열 `${u[@]}`→빈, `${#u[@]}`→`0`. **회귀:** 스칼라 `${x}`/`${#x}`/`${x:-y}`/`"$@"` 전부 초록(공유 경로).
- [ ] **Step 2~4:** `NAME_RE`(또는 전용 선-검사)를 `NAME[subscript]` 캡처하게; `expandBraceParam` 에서 첨자 분기 — 숫자/산술 첨자→원소(`evalArith`), `@`/`*`→ per-arg breaks(`[@]`)/IFS 조인(`[*]`), `${#name[@]}`→개수·`${#name[i]}`→원소길이, `${!name[@]}`→인덱스, `[@]:o:l`→`substringOp` 원소리스트에. `$NAME` bare 분기(expand.ts:584-587) 배열이면 원소0. RegExp 금지 유지. 통과 → Docker 대조.
- [ ] **Step 5: 커밋** — `feat(shell): array expansion ${arr[i]} ${arr[@]} ${#arr[@]} ${!arr[@]} slices`

---

## Task 4: `read` 빌트인 (단일 라인)

**Files:** Create `src/shell/builtins/read.ts`; Modify `src/shell/builtins/index.ts`; Test.

**Interfaces:** Produces `read var`(첫 줄을 var 로, IFS trim), `read -r`(백슬래시 리터럴), `read a b c`(IFS 분할, 마지막이 나머지), `read`(→`$REPLY`). `e.stdin` 의 첫 줄 소비, `e.state.env` 에 기록. EOF(빈 stdin)면 exit 1.

**배경:** `read` 없음(현재 exit 127). 단일 라인은 `e.stdin` 위 작은 빌트인 — 새 인프라 불필요. `read x < file`(단순명령 리다이렉션)·`echo x | read v`(파이프)는 기존 stdin 경로로 동작. `while read`(커서)는 Task 6.

- [ ] **Step 1: 실패 테스트** — bash 확인: `printf 'hello\n' | read v; echo "[$v]"`(주의: bash 파이프 read 는 subshell 이라 밖에서 빈 — 우리 파이프라인도 격리; `read v < file` 로 테스트하거나 `read` 결과를 파이프 안에서 소비). here-string 없으니 `printf 'a b c\n' > f; read x y < f; echo "x=$x y=$y"`→`x=a y=b`? (bash: `read x y` → x=a, y="b c"; **확인**). `read a b < f`(`a b c` 입력)→`a=a b="b c"`(마지막이 나머지). `read -r`(`a\tb` 백슬래시): `printf 'a\\tb\n' > f; read -r line < f`→`a\tb` 리터럴. `read` 인자 없이→`$REPLY`. IFS: `IFS=: read a b < f`(`x:y`)→`a=x b=y`. EOF: 빈 파일 `read v < empty; echo $?`→`1`. **주의: 파이프 read 격리** — bash 에서 `echo x | read v; echo $v` 는 `v` 빈(subshell). 우리 파이프라인 스테이지도 childCtx 라 동일해야(회귀 확인).
- [ ] **Step 2~4:** `read.ts` — `e.stdin` 첫 줄(개행까지) 파싱, `-r` 플래그, IFS(`e.state.env.IFS` 또는 기본 WS) 분할(마지막 var 나머지 흡수), var 없으면 `REPLY`, `e.state.env` 기록, 첫 줄 없으면 exit 1. `index.ts` 등록. RegExp 금지. 통과 → Docker 대조. `exec` reject 없음(malformed 없음).
- [ ] **Step 5: 커밋** — `feat(shell): read builtin (read var / -r / a b c / $REPLY, IFS split)`

---

## Task 5: 컴파운드 명령 리다이렉션 (`while..done < f`, `for..done > f`, `( )>f`, `if..fi>f`, `{ }>f`)

**Files:** Modify `src/shell/parser.ts`(컴파운드 노드 `redirs` + 파싱), `src/shell/interpreter.ts`(적용); Test.

**Interfaces:** Produces 컴파운드 명령의 종결 키워드(`done`/`fi`/`esac`/`}`/`)`) 뒤 리다이렉션. `WhileNode`/`ForNode`/`IfNode`/`CaseNode`/`GroupNode`/`SubshellNode` 에 `redirs: Redir[]`. **Part 2 최우선 carried minor 동시 해결.**

**배경:** 현재 컴파운드 뒤 redir THROW(엔진 맵). `Redir` 재사용, redir 루프를 컴파운드 파싱 뒤에도 호출.

- [ ] **Step 1: 실패 테스트** — bash 확인: `for i in a b c; do echo $i; done > out.txt` 후 `cat out.txt`→`a\nb\nc`; `while false; do :; done` + redir; `if true; then echo hi; fi > o.txt`→`o.txt`=`hi`; `( echo sub ) > o.txt`→`sub`; `{ echo a; echo b; } > o.txt`→`a\nb`; `for i in 1; do echo $i; done 2> e.txt`(stderr); 입력 `while read x; do echo $x; done < in.txt`(Task 6에서 read 동작하지만 **파싱**은 이 태스크 — 최소 파싱 THROW 안 함 확인). **회귀:** 단순명령 리다이렉션 + 기존 컴파운드(redir 없는) 전부 초록.
- [ ] **Step 2~4:** 파서 — 각 컴파운드 노드에 `redirs: Redir[]`; 종결 뒤 `parseRedirs()` 재사용해 수집. interpreter — 컴파운드 실행 시 출력 redir 을 본문 stdout 에 적용(단순명령 출력 redir 경로 재사용), `<` redir 은 본문 stdin 으로(Task 6 커서와 연결). 통과 → Docker 대조 + **회귀**(단순 redir/기존 컴파운드).
- [ ] **Step 5: 커밋** — `feat(shell): redirections on compound commands (while/for/if/case/group/subshell)`

---

## Task 6: `while read` — mutable stdin 커서 (컴파운드 본문 stdin 스레딩)

**Files:** Modify `src/shell/interpreter.ts`(runWhile/runFor stdin 커서, read 연결), `src/shell/builtins/read.ts`(커서 소비); Test.

**Interfaces:** Consumes Task 4/5. Produces `while read line; do …; done < file` 가 매 반복 한 줄 소비(파일 소진 시 루프 종료); `cat file | while read x; do …; done` 파이프 stdin 도. 루프가 stdin(리다이렉션 or 파이프)을 커서로 열고, 본문의 `read` 가 공유 커서에서 한 줄씩.

**배경(가장 큰 구조 변경):** stdin 이 명령마다 불변 복사라 커서 없음(엔진 맵). `runWhile`/`runFor` 가 커서를 만들어 본문에 스레딩, `read` 가 소비.

- [ ] **Step 1: 실패 테스트** — bash 확인: `printf 'a\nb\nc\n' > f; while read x; do echo "got:$x"; done < f`→`got:a\ngot:b\ngot:c`; `while read a b; do echo "$a|$b"; done < f2`(각 줄 `x y z`)→`x|y z`; 파이프 `printf '1\n2\n' | while read n; do echo "n=$n"; done`→`n=1\nn=2`; `for` 은 read 안 쓰지만 컴파운드 stdin 회귀; 중첩/빈 파일(루프 0회); 마지막 줄 개행 없음도 읽힘(bash: 마지막 불완전 줄도 read 하고 exit 1). **spend() 경계:** 큰 입력이라도 per-반복 spend 로 bounded(무한 아님이지만 예산 소비 확인). **회귀:** stdin 없는 while/for 초록.
- [ ] **Step 2~4:** `runWhile`/`runFor` 가 자신의 stdin(Task 5 `<` redir 또는 파이프 stdin)을 mutable 커서 `{rest:string}` 로 열어 `ctx`(또는 본문 전달 경로)에 실음; `read` 가 커서 있으면 거기서 한 줄 소비·`rest` 갱신, 없으면 기존 `e.stdin` 폴백. read EOF(커서 빈) → exit 1 → while 종료. 통과 → Docker 대조. **회귀 + 안전:** `exec` reject 없음, spend 경계 유지.
- [ ] **Step 5: 커밋** — `feat(shell): while/for read consumes stdin line-by-line via mutable cursor`

---

## Task 7: 골든 케이스 + 최종 검증 + 마무리

**Files:** Create `tests/shell/golden/cases/33..NN-*.sh` + `expected/*.txt`; 검증만.

- [ ] **Step 1: 골든 케이스**(한 줄 `;`-조인, 단일 라인 제약): `33-arrays`(`arr=(a b c); echo ${arr[1]}; echo ${#arr[@]}; echo "${arr[@]}"; arr[1]=Z; echo ${arr[*]}`), `34-read`(`printf 'x y z\n' > f; read a b < f; echo "$a|$b"`), `35-compound-redir`(`for i in 1 2 3; do echo $i; done > o.txt; cat o.txt`). (while-read 는 멀티라인 파일 필요 → 단일 라인 골든 어려우면 `printf` 로 파일 만들고 `while read < f` 한 줄로.) `npm run golden`(Docker) → 바이트 동일, 기존 32 불변.
- [ ] **Step 2:** 전체 게이트 — `npm run build && npm test && npm run e2e` 초록. golden 재생성 바이트 동일.
- [ ] **Step 3:** `npm run dev` 실브라우저 — 배열(`arr=(a b c); echo ${arr[@]}`), read(`read x < f`), 컴파운드 redir(`for..done > f`) 동작 확인. 스크린샷 `.superpowers/sdd/m3-part3-play.png`.
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` 로 마무리. **M3 Part 3 완료** — 다음은 M3 Part 4(polish: here-doc[source-scoped 판단], `#`-in-`$()`, case quoted metachar, lenient parses).
- [ ] **Step 5(있으면): 커밋** — `test(golden): arrays, read, compound-redir cases`

## 완료 조건

- `npm run build` 0 에러. `npm test` — 셸 단위(배열 저장/파싱/확장, read, 컴파운드 redir, while-read 커서 신규), 골든(35+), 문제(50×4), UI 초록. `npm run e2e` 초록. `npm run dev` — 배열·read·컴파운드 redir 실동작. 기존 50문제 회귀 없음.

## M3 Part 4(polish)로 이연

- **here-doc** `<<EOF`/`<<-`/`<<'EOF'` — per-line exec 에서 관측 불가, source/shebang 파일 내용으로만. 할지/scope(source-only + 골든 하네스 whole-file 모드) 판단 필요. `<<` 연산자 + 렉서 pre-pass + `Redir` body payload.
- Part 2/기타 carried minors: `{echo x;}`/빈 `( )`/`{ }` exit 코드, `unset VAR` mid-prefixed-call, `exit` 빌트인 부재, `#`-in-`$()`, case quoted metachar, lenient parses.
