# FlashShell M3 Part 4 — polish + here-doc (Layer-3 완결) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로 태스크별 실행. 스텝은 체크박스(`- [ ]`).

**Goal:** M3(3층)를 완결짓는다 — (1) 플레이어가 흔히 쓰는 관용구 `+=` append(스칼라·배열)·`read -a`, (2) 값싼 correctness 버그(loop 안 `return` stdout 누락·`echo x > /` EISDIR), (3) 소소한 polish(`ifsChars` 중복 제거·`${@:o:l}` positional 슬라이스·빈 `()`/`{}` exit 코드), (4) **here-doc**(`<<EOF`/`<<-`/`<<'EOF'`) — source/shebang 스크립트 내용 한정(게임 REPL은 단일라인 `<input>`이라 플레이어가 타이핑 불가하나, 스크립트 작성 퍼즐을 위해 Layer-3를 완결).

**Architecture:** polish는 기존 시임에 얹는 국소 변경. here-doc 은 렉서에 **whole-input pre-pass**(문자 스캐너 + `\n`→`;` fold가 라인 소비 불가하므로, `tokenize` 전에 `<<[-]DELIM` 본문을 잘라내 redir 에 첨부) + `<<`/`<<-` 연산자 + `Redir` here-doc 변형 + 인터프리터에서 본문을 stdin 으로(따옴표 delim 아니면 확장). here-doc 은 멀티라인이라 유닛테스트로 `sh.exec(멀티라인)` 직접 검증하고, 골든은 opt-in whole-file 서브하네스로 커버.

**Tech Stack:** Vite + React 19 + TS(strict), Vitest, Playwright. Ground truth = `debian:stable-slim` bash 5.

**Base:** 브랜치 `worktree-flashshell-m3-part4`, base `4799e9f`(= M2 + M3 Part 1/2/3 완료, main HEAD). 베이스라인 1611 단위 + 6 e2e + 36 골든 초록.

## Global Constraints

- **엔진 순수성**(`no-node-imports.test.ts`: `src/shell/**` 상대경로만, Node/DOM 전역 금지). **ground truth = bash 5**. **`localeCompare` 금지**(`errnoText`). Sizes = 실제 UTF-8 바이트.
- **`exec()`는 절대 reject 안 함**(`ExecutionLimitError`만 exit 130). 새 코드는 그 외 전부 catch → graceful nonzero.
- **`check(ctx)`는 fs/lastResult만.** 새 문제 없음(50 고정) — 회귀 없어야.
- **기존 동작 보존:** 1611 단위 + 36 골든 초록 유지. golden 바이트 동일(`npm run golden`, Docker).
- **패턴 매칭 RegExp 금지**(ReDoS). glob 은 `matchSegment`. 구조적 regex(식별자/`ASSIGN_RE`)는 허용.
- **모든 무한 경로는 per-unit `spend()` + 2000ms Worker 데드라인으로 bounded.**
- **계획 코드는 가설이다.** TDD + Docker 차등 + 실행 리뷰. 각 태스크 끝에 게임 플레이 가능 + 전체 초록.

## 엔진 맵 (M3 Part 4 리서치, base 4799e9f) — 핵심 시임

- **`+=` (B1):** `Assignment`(parser.ts:14), `ASSIGN_RE`(parser.ts:149, `+` 없음), `tryAssignment`(parser.ts:205), `lexer.ts:24` `ARRAY_ASSIGN_LHS_RE` + `:200` 배열 캡처(`+=` 인식 필요), `applyAssignment`(interpreter.ts:647) + 프리픽스(:741). 스칼라 `x+=y` 연결, 배열 `arr+=(x)` push, `arr[i]+=` 원소 더하기.
- **`read -a` (B6):** `read.ts:137-152` `parseArgs`(`-a`→에러 :148). `e.state.arrays.set(name, fields)`(CommandEnv.state = ShellState w/ arrays, types.ts:30). 파이프 격리 이미 childCtx.
- **`return` mid-loop stdout (B3):** `runWhile` catch(interpreter.ts:944-945) + `runFor`(:1025-1026)가 LoopSignal(break/continue)만 `stdout` 복구, ReturnSignal 재throw 시 누적 stdout 안 붙임. `runList`(:1158-1161)가 하는 것처럼 prepend. ~4줄.
- **`> /` EISDIR (B5):** `vfs.ts:160-175` `writeFile`; `basename('/')===''`(:120-123)라 dir 가드 미발동 → `''` 이름 노드 생성. 타겟이 dir 이면(또는 basename 빈) EISDIR.
- **`${@:o:l}` positional 슬라이스 (B4):** `expand.ts:147-152`(`@`/`*` join in resolveName) → `substringOp`(:527) 문자열 슬라이스. positional `@`/`*` 원소-슬라이스 분기 없음(배열 `subscript==='@'` :612의 `sliceElements` 대조). 그 경로 재사용.
- **`ifsChars` 중복 (B7):** `expand.ts:77`(ExpandCtx, 미export) vs `read.ts:56`(env). 공유 헬퍼로.
- **빈 `()`/`{}` exit (B9):** `parseSubshell`(parser.ts:510)/`parseBraceGroupList`(:487)가 빈 리스트 수용. 빈 검사 → syntax error(exit 2).
- **here-doc:** 렉서 `\n`→`;` fold(lexer.ts:71-82), 단일패스 스캐너(:53). `OPERATORS`(:20) `<<` 없음(`cmd <<EOF`→`<` `<` `WORD`→syntax err). 원자 캡처: `$()`(156)/`${}`(170)/`(())`(183)/`NAME=()`(200) — pre-pass 는 이 안의 `<<` 무시해야. `Redir`(parser.ts:4)`{fd,op,target}`, `parseOneRedir`(:663), `REDIR_OPS`(:145). 인터프리터 `<` 해결 `resolveRedirs`(:182, open :209, read :229) → 본문이 input. **도달성:** 멀티라인은 `runSource`(:504)/`execScriptFile`(:604)의 `parse(content)`로만(store `session.exec`/골든/문제 하네스 전부 `\n`-split; Terminal.tsx:115 단일 `<input>`). 유닛테스트는 `sh.exec(멀티라인)` 직접 가능(`exec`는 split 안 함 — 하네스만 split).

---

## Task 1: `+=` append (스칼라 `x+=y` · 배열 `arr+=(...)` · `arr[i]+=`)

**Files:** Modify `src/shell/lexer.ts`(ARRAY_ASSIGN_LHS 캡처 `+=`), `src/shell/parser.ts`(Assignment.append, ASSIGN_RE, tryAssignment), `src/shell/interpreter.ts`(applyAssignment append); Test.

**Interfaces:** Produces `x+=y`(스칼라 연결), `arr+=(d e)`(배열 끝에 push), `arr[i]+=z`(원소에 연결), `s=a; s+=b`→`ab`. `Assignment` 에 `append: boolean`.

**배경:** 현재 `x+=y`/`arr+=(...)`는 대입으로 안 잡혀 command-not-found(127). 흔한 관용구.

- [ ] **Step 1: 실패 테스트** — bash 확인: `s=hi; s+=there; echo $s`→`hithere`; `arr=(a b); arr+=(c d); echo "${arr[@]}"`→`a b c d`; `arr=(a b c); arr[1]+=X; echo "${arr[@]}"`→`a bX c`; unset+= `unset u; u+=x; echo $u`→`x`(빈+연결); 프리픽스 `s=a; s+=b cmd`(프리픽스 대입은 append도 — bash 확인). 원소 확장: `arr=(a); x="p q"; arr+=($x); echo ${#arr[@]}`→`3`(split). 회귀: 일반 `=` 대입, 배열 리터럴 초록.
- [ ] **Step 2~4:** 렉서 `ARRAY_ASSIGN_LHS_RE`(+배열 캡처)가 `NAME+=(` 인식; 파서 `ASSIGN_RE`를 `+=` 캡처하게 + `Assignment.append`; interpreter `applyAssignment`에서 append면 기존 값에 연결(스칼라)/push(배열 리터럴)/원소 연결(`arr[i]+=`). RegExp 구조적만. 통과 → Docker 대조. 회귀 초록.
- [ ] **Step 5: 커밋** — `feat(shell): += append for scalars, arrays, and array elements`

---

## Task 2: `read -a array`

**Files:** Modify `src/shell/builtins/read.ts`; Test.

**Interfaces:** Produces `read -a arr < f`(줄 전체를 IFS 분할해 arr 배열에), `e.state.arrays.set(name, fields)`. `-r`와 조합 가능.

**배경:** `-a`가 현재 에러(exit 2). 배열 퍼즐에 유용.

- [ ] **Step 1: 실패 테스트** — bash 확인: `echo 'a b c' > f; read -a arr < f; echo "${arr[@]}"`→`a b c`, `echo ${#arr[@]}`→`3`, `echo ${arr[1]}`→`b`; `printf 'x  y\tz\n' > f2; read -a arr < f2` IFS 다중공백 → 3원소; `IFS=: read -a arr < f3`(`a:b:c`)→3원소; `read -ra arr`(`-r`+`-a` 조합); 빈 줄 `read -a arr < empty`→빈 배열 exit 1. 파이프 격리(childCtx) 유지. 회귀: 일반 `read var` 초록.
- [ ] **Step 2~4:** `read.ts` `parseArgs`에서 `-a NAME` 수용; 라인을 IFS 분할(read 의 기존 분할 재사용 — 단 `-a`는 마지막-var-나머지 규칙 없이 전부 원소로)한 필드를 `e.state.arrays.set(name, fields)`; `-r` 조합. 통과 → Docker 대조.
- [ ] **Step 5: 커밋** — `feat(shell): read -a reads a line into an indexed array`

---

## Task 3: correctness 버그 — loop 안 `return` stdout · `> /` EISDIR

**Files:** Modify `src/shell/interpreter.ts`(runWhile/runFor catch), `src/shell/vfs.ts`(writeFile dir 가드); Test.

**Interfaces:** Produces (B3) loop 안에서 `return`이 이전 반복 stdout 보존; (B5) `echo x > /`(또는 임의 디렉터리)가 EISDIR exit 1(파일 미생성).

- [ ] **Step 1: 실패 테스트** — bash 확인: (B3) `f(){ for i in 1 2 3; do echo $i; [ $i = 2 ] && return; done; }; f`→`1\n2`(현재 `2`만); `while` 버전도. (B5) `echo x > /`→exit 1 `Is a directory`, 루트 안 오염; `mkdir d; echo x > d`→exit 1(이미 정상? — dir 타겟 일반화 확인); 정상 `echo x > f`→파일 생성(회귀). 회귀: 함수 top-level `return`, 정상 리다이렉션 초록.
- [ ] **Step 2~4:** (B3) runWhile/runFor catch 에서 non-LoopSignal `ControlSignal` 재throw 전에 누적 `stdout`/`stderr` prepend(`runList`처럼). (B5) `writeFile`에서 타겟이 디렉터리(또는 basename 빈/루트)면 EISDIR 에러 반환, `''` 노드 생성 금지. 통과 → Docker 대조.
- [ ] **Step 5: 커밋** — `fix(shell): return preserves loop stdout; writing to a directory errors (EISDIR)`

---

## Task 4: 소소한 polish — `ifsChars` 중복 · `${@:o:l}` positional 슬라이스 · 빈 `()`/`{}` exit

**Files:** Modify `src/shell/expand.ts`(ifsChars export + positional slice), `src/shell/builtins/read.ts`(공유 ifsChars 사용), `src/shell/parser.ts`(빈 컴파운드 검사); Test.

**Interfaces:** Produces (B7) `ifsChars` 하나 공유; (B4) `${@:o:l}`/`${*:o:l}`가 원소-슬라이스(bash 일치); (B9) 빈 `( )`/`{ }`/`( ; )`가 syntax error(exit 2).

- [ ] **Step 1: 실패 테스트** — bash 확인: (B4) 함수에서 `set -- p q r s`(또는 위치인자 함수호출)로 `"${@:2:2}"`→`q r`(현재 문자열슬라이스 ` r`류 틀림), `"${@:1}"`→전부, `${@:2}`; 배열 `${arr[@]:o:l}`는 이미 정상(회귀). (B9) `( )`→exit 2, `{ }`→exit 2, `( ; )`→exit 2, `if true; then :; fi`(빈 본문 아님)은 정상; 비어있지 않은 `( echo x )`/`{ echo x; }` 회귀. (B7) 혼합 IFS read 회귀(Part 3 fix 유지). 회귀: 스칼라 `${x:o:l}`, `read` 전부 초록.
- [ ] **Step 2~4:** (B7) `ifsChars` 를 한 곳(예: expand.ts)에서 export, read.ts 가 그걸 사용(env 시그니처 맞춤) — 로직 통일. (B4) positional `@`/`*` 슬라이스를 원소-리스트 슬라이스로(`sliceElements` 재사용, 배열 `[@]` 경로처럼). (B9) `parseSubshell`/`parseBraceGroupList`가 빈 리스트면 syntax error. 통과 → Docker 대조.
- [ ] **Step 5: 커밋** — `fix(shell): share ifsChars, element-wise ${@:o:l}, empty ()/{} syntax error`

---

## Task 5: here-doc (`<<EOF` · `<<-` tab-strip · `<<'EOF'`/`<<"EOF"` no-expand)

**Files:** Modify `src/shell/lexer.ts`(here-doc pre-pass + `<<`/`<<-`), `src/shell/subst.ts`(필요시 스캐너), `src/shell/parser.ts`(Redir here-doc 변형), `src/shell/interpreter.ts`(resolveRedirs 본문→stdin); Test.

**Interfaces:** Produces `cat <<EOF\n…\nEOF`(본문이 stdin, 확장됨), `<<-EOF`(각 줄 선행 TAB 제거), `<<'EOF'`/`<<"EOF"`(따옴표 delim → 본문 확장 안 함). 멀티라인이라 유닛테스트로 `sh.exec("cat <<EOF\\nhi\\nEOF")` 직접 검증. `Redir` union 에 `op:'<<'` + `{body, expand}` payload.

**배경(엔진 맵):** 렉서 단일패스 스캐너 + `\n`→`;` fold 는 라인 소비 불가. **whole-input pre-pass**가 `tokenize` 전에 `<<[-]DELIM` 본문(다음 물리적 줄들 ~ `DELIM` 줄)을 잘라내 redir 에 첨부. `$()`/`${}`/`(())`/`NAME=()` 원자 캡처 안의 `<<`는 무시.

- [ ] **Step 1: 실패 테스트**(멀티라인 `sh.exec` 직접) — bash 확인(멀티라인): `cat <<EOF\nhello\nworld\nEOF`→`hello\nworld`; 확장 `x=hi; cat <<EOF\nval=$x\nEOF`→`val=hi`; no-expand `cat <<'EOF'\nval=$x\nEOF`→`val=$x`(리터럴); `<<-EOF`(본문 줄 선행 TAB)→TAB 제거된 본문; 명령과 조합 `grep h <<EOF\nhi\nbye\nEOF`→`hi`; `read` 와 `cat <<EOF` 파이프; 빈 here-doc `cat <<EOF\nEOF`→빈. delim 뒤 텍스트 `cat <<EOF; echo after`(같은 줄) bash 동작 확인. source 파일 내용 경로도 1개(`echo 'cat <<EOF...' > s.sh; source s.sh`). **exec reject 없음:** 닫는 delim 없는 here-doc → graceful(bash: unexpected EOF). 회귀: 기존 `<`/`>` 리다이렉션, `<`가 든 명령 초록.
- [ ] **Step 2~4:** 렉서 pre-pass(원자 캡처 회피) + `<<`/`<<-` 연산자; 파서 `Redir` here-doc 변형(body + expand 플래그, 따옴표 delim → expand=false); interpreter `resolveRedirs`에서 `<<`면 본문을(expand 시 `expandDollar`/param 확장) input 으로. RegExp 금지(라인 스캔 문자 기반). 통과 → Docker 대조(멀티라인은 `bash -c "$(printf ...)"`). **회귀:** 전체 리다이렉션 스위트.
- [ ] **Step 5: 커밋** — `feat(shell): here-documents <<EOF, <<-EOF (tab-strip), <<'EOF' (no-expand)`

---

## Task 6: 골든 whole-file 서브하네스 + here-doc/polish 골든 케이스 + 최종 검증 + 마무리

**Files:** Modify `tests/shell/golden.test.ts`(opt-in whole-file 모드); Create `tests/shell/golden/cases/37..*.sh` + `expected/*.txt`; 검증.

- [ ] **Step 1: whole-file 골든 모드** — `runCase`에 opt-in whole-file 모드(예: 케이스 헤더 마커 `# GOLDEN: whole-file` 또는 별도 디렉터리)로 멀티라인 케이스를 한 번에 `exec`. 기존 36 단일라인 케이스는 per-line 그대로(안 깨짐).
- [ ] **Step 2: 골든 케이스** — `37-heredoc`(whole-file: `cat <<EOF\n...\nEOF`), `38-append`(단일라인: `s=a; s+=b; echo $s; arr=(x); arr+=(y z); echo "${arr[@]}"`), `39-read-array`(`echo 'a b c' > f; read -a arr < f; echo ${#arr[@]}`). `npm run golden`(Docker) → 바이트 동일, 기존 36 불변.
- [ ] **Step 3:** 전체 게이트 — `npm run build && npm test && npm run e2e` 초록. golden 재생성 바이트 동일.
- [ ] **Step 4:** `npm run dev` 실브라우저 — `+=`(`arr=(a); arr+=(b); echo ${arr[@]}`), `read -a`(`read -a x < f`) 동작 확인(here-doc 은 REPL 도달 불가라 스크립트/유닛으로만). 스크린샷 `.superpowers/sdd/m3-part4-play.png`.
- [ ] **Step 5:** `superpowers:finishing-a-development-branch` 로 마무리. **M3 완료** — Layer-3 완결(확장·구조·데이터·I/O·here-doc).
- [ ] **Step 6(있으면): 커밋** — `test(golden): heredoc (whole-file), += append, read -a cases`

## 완료 조건

- `npm run build` 0 에러. `npm test` — 셸 단위(`+=`·`read -a`·return-stdout·EISDIR·ifsChars·`${@:o:l}`·빈 `()`·here-doc 신규), 골든(39+), 문제(50×4), UI 초록. `npm run e2e` 초록. `npm run dev` — `+=`·`read -a` 실동작. 기존 50문제 회귀 없음. **M3 Layer-3 완결.**

## 스코프 밖 (의도적)

- **bare `arr[i]` in `$(( ))`**(B2) — `evalArith` 시그니처 리플 M-L; `$(( ${arr[i]} ))` 우회 작동. 이연.
- **`exit` 빌트인**(B10) — per-line 게임에서 종료할 셸 없음. 이연.
- **`unset`/`local` 스코프**(B11) — 아키텍처 변경(flat env). 이연.
- **`{echo x;}` exit 127**(B8), **case quoted metachar**(B12), **`#` in `$(...)`**(B13) — obscure. 이연.
