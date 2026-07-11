# FlashShell M3 Part 2 — 파서/구조 완성 (토큰화 + subshell + 디스패치 갭) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로 태스크별 실행. 스텝은 체크박스(`- [ ]`).

**Goal:** 3층의 "구조" 부분 중 응집된 파서/구조 클러스터를 얹는다 — `(`/`)`/`{`/`}` 렉서 토큰화(문자열 수술 제거, 컴팩트 `f(){...}`·`{echo` 해금), subshell `( cmd )`, 함수-호출 디스패치 갭(리다이렉션·프리픽스·파이프 stdin), 그리고 `$(( ${#x} ))` 산술-안-확장. 새 데이터/IO 서브시스템 없이, 오늘의 per-line exec 모델에서 전부 도달·테스트 가능. **배열·here-doc·read 는 M3 Part 3(별도)로 이연** — 각각 새 서브시스템(mutable stdin·새 데이터 타입·렉서 pre-pass)이 필요해 함께 하면 범위 폭주(설계 스펙 §11 경고).

**Architecture:** `(`/`)`/`{`/`}`가 지금은 raw WORD 텍스트에 흡수돼 파서가 문자열 수술(`matchFuncDefName`, case paren-strip)로 보정한다. 이를 토큰화하면 수술이 사라지고 subshell 이 깔끔히 얹힌다. subshell 은 기존 `childCtx`(env/cwd 격리, fs+budget 공유) 재사용. 디스패치 갭은 `runSimpleCommand`에서 함수/source 를 리다이렉션·프리픽스·stdin 경로 뒤로 라우팅. 산술-안-확장은 `$((` 분기에서 evalArith 전에 `${...}`/`$(...)`/`$x`를 확장.

**Tech Stack:** Vite + React 19 + TS(strict), Vitest, Playwright. Ground truth = `debian:stable-slim` bash 5.

**Base:** 브랜치 `worktree-flashshell-m3-part2`, base `62d8049`(= M2 + M3 Part 1 완료, main HEAD). 베이스라인 1367 단위 + 6 e2e + 29 골든 초록.

## Global Constraints

- **엔진 순수성**(`no-node-imports.test.ts`), **ground truth = bash 5**, **`localeCompare` 금지**, **`errnoText` 하나**.
- **`exec()`는 절대 reject 안 함**(`ExecutionLimitError`만 exit 130). 새 코드는 그 외 전부 catch.
- **`check(ctx)`는 fs/lastResult만.** 새 문제 없음(50 고정).
- **기존 동작 보존:** 1367 단위 + 29 골든 초록 유지. 토큰화가 4개 funcdef 형식·case 패턴·기존 파싱을 회귀시키면 안 됨.
- **패턴 매칭 RegExp 금지**(ReDoS — Part 1 교훈). glob 은 `matchSegment`.
- **계획 코드는 가설이다.** TDD + Docker 차등 + 실행 리뷰. 각 태스크 끝에 게임 플레이 가능 + 전체 초록.

## 엔진 맵 (M3 Part 2 리서치, base 62d8049) — 핵심 시임

- 헤드라인: **한 줄당 exec**(store `session.exec` per Enter; 골든/문제 하네스도 `\n` split). 멀티라인 본문은 파일 내용(source/shebang, `parse(content)` 통째)으로만 도달. → here-doc/read 가 Part 3인 이유.
- 렉서 `lexer.ts`: `Operator`(10) = `| || && ; ;; > >> < 2> 2>>` — **`(`/`)`/`{`/`}` 없음**(fall-through `push('raw', ch)` :183). `WordPart`(3-8) literal/raw/dquote. 특수 캡처: `$(...)`(149), `${...}`(163, matchBraceEnd), **word-start `((...)`(176, matchDoubleParenEnd) — 주석이 "subshell 없으니 `((`는 명백히 산술"이라 명시 → subshell 이 이 가정을 깬다**. newline→`;` fold(64-75).
- 파서 `parser.ts`: `Redir`(3)=`{fd,op,target:Word}`, `Assignment`(4), `Command` union(93)=`CommandNode|If|While|For|Case|FunctionDef|Group|ArithCmd`. `parseCommandOrCompound`(343): arith→keyword→`matchFuncDefName`(379, `(`/`)` 문자열 수술 4형식)→parseCommand. case paren-strip `stripLeadingParen`(180)/`splitTrailingParen`(193). `{ }` 그룹 `parseBraceGroupList`(439, `{`/`}` RESERVED_WORDS). `tryAssignment`(160, ASSIGN_RE).
- interpreter `interpreter.ts`: `runCommand` switch(136) — **stdin은 runSimpleCommand에만 전달**(138), if/while/for/case/group/arith/funcdef는 stdin 없이(139-148) → 컴파운드가 파이프 stdin 안 받음. `childCtx`(83, env/cwd 복사·fs/budget 공유·isolateFunctions 옵션). `runSimpleCommand`(366) 디스패치 순서: 확장(374)→순수대입(384)→**함수(399)→source(408)**→프리픽스대입(414)→**리다이렉션(441-488)**→lookupCommand(496). **갭 뿌리: 함수/source가 리다이렉션·프리픽스 전에 return.** `callFunction`(200) stdin 없음. `runSubshell`(110)이 `$()`용 childCtx 재진입 — subshell 이 이걸 재사용. `runPipeline`(770) 스테이지간 stdin 스레딩.
- 산술: `$((` 분기(expand.ts:~474) 가 `matchSubstitutionEnd`로 `))` 찾아 `evalArith(slice, ctx)`. arith.ts 토크나이저는 `$` 뒤 `isIdStart`만 → `${...}` 미지원(Part 1 이연).

---

## Task 1: 산술 안 `${...}`/`$(...)` 확장 (워밍업, 격리)

**Files:** Modify `src/shell/expand.ts` (`$((` 분기), `src/shell/interpreter.ts` (`runArith`); Test.

**Interfaces:** Produces `$(( ${#NAME} + 1 ))`, `$(( ${x:-3} ))`, `$(( $(echo 2) * 3 ))` 가 동작. bash 는 산술 식 문자열을 평가 **전에** `$`-확장(파라미터·명령·산술)한다. → `evalArith` 부르기 전에 식 안의 `${...}`/`$(...)`/`$x`를 확장.

**배경(M3 Part 1 이연):** arith.ts 토크나이저가 `$` 뒤 식별자만 받아 `${...}`가 산술 안에서 구문오류. bash 는 arith 평가 전에 식 전체를 `$`-확장한다(단어분할·글롭 제외). evalArith 는 이미 bare `x`/`$x`를 env 에서 읽으므로, `${...}`/`$(...)`만 미리 값으로 치환하면 된다.

- [ ] **Step 1: 실패 테스트** — bash 확인: `NAME=world; echo $(( ${#NAME} + 1 ))`→`6`; `echo $(( ${x:-3} * 2 ))`(x unset)→`6`; `echo $(( $(echo 5) + 1 ))`→`6`; `x=2; echo $(( x ${y:-+} 3 ))` 류(연산자가 확장에서 나오는 것은 서브셋 밖 — 값만). 부작용 유지: `n=${#NAME}; echo $((n+1))` 이미 동작(회귀 확인). 역방향 `${x:-$((1+2))}`→`3` 회귀.
- [ ] **Step 2~4:** `$((` 분기(그리고 `runArith`의 `(( ))`)에서 `evalArith` 전에 식 문자열을 `expandDollar`(또는 동등)로 확장 — `${...}`/`$(...)`/`$x`를 값으로. 단어분할·글롭은 안 함(산술 문맥). 대입 부작용(`$(( x = ${y:-0}+1 ))`)은 확장 후 evalArith 가 `x=` 처리. 통과 → Docker 대조. **회귀:** 기존 산술 테스트 초록.
- [ ] **Step 5: 커밋** — `feat(shell): expand ${...}/$(...) inside arithmetic before evaluation`

---

## Task 2: `(` `)` `{` `}` 렉서 토큰화

**Files:** Modify `src/shell/lexer.ts`(토큰), `src/shell/parser.ts`(문자열 수술 제거 + 토큰 소비); Test `lexer.test.ts`, `parser.test.ts`.

**Interfaces:** Produces `(`/`)`/`{`/`}`가 별도 토큰(예: `OP` 확장 또는 새 punctuation 토큰). 컴팩트 `f(){...}`·`{echo;}`·`f()` 전부 파싱(공백 불필요). case 패턴 paren, funcdef paren 이 문자열 수술 없이 토큰으로.

**배경(M2 이연):** `(`/`)`/`{`/`}`가 raw 병합이라 `matchFuncDefName`(parser.ts:379)이 4형식 문자열 수술, case 가 `stripLeadingParen`/`splitTrailingParen`, 컴팩트 `f(){`·`{echo`는 파싱 실패. 토큰화하면 전부 정리되고 subshell(Task 3)의 전제.

**결정 사항(주의):**
- **`((` 산술 캡처 유지 vs `( (`:** word-start `((`는 현재 산술로 캡처(lexer.ts:176). subshell 도입 후 `((`는 산술 `(( expr ))` 또는 중첩 subshell `( (cmd) )`일 수 있다. bash 는 word-start `((`를 산술 우선. **결정: word-start `((` 산술 캡처를 유지**하고, 단일 `(`(뒤가 `(`아님)만 punctuation 토큰으로. `( (echo) )`(공백 있음)는 `(` `(echo)`... 로 정상. `((echo))`(공백 없음)는 산술 캡처→evalArith 실패(bash 동일). 이 disambiguation 을 명시 주석.
- `(`/`)`/`{`/`}`를 **무조건** 토큰화할지, **명령 위치에서만**일지: bash 는 문맥 민감(글롭 `[a-z]` 안 `(`는 리터럴; case 패턴 `(`). 안전책: 토큰화하되 파서가 관대하게(예: `{`/`}`는 이미 RESERVED_WORDS 방식과 통합). **글롭·case 안의 `(`/`)`/`[`가 깨지지 않게** — 기존 glob/case 테스트로 회귀 확인. 구현자가 bash 로 경계를 확인해 결정.

- [ ] **Step 1: 실패 테스트** — bash 확인: 컴팩트 `run("f(){ echo hi; }; f")`→`hi`(공백 없이 `f(){`), `run("{ echo a; echo b; }")`·`run("{echo x;}")` 그룹, funcdef `f ()`/`f()`/`function f`. 회귀: case 패턴 `case x in (a) echo a;; esac`, `case x in a|b) ...`, 글롭 `[a-z]`·`(`가 든 파일명, 기존 funcdef/그룹 테스트. lexer.test: `((...))` 산술은 여전히 한 단위, 단일 `(`는 토큰.
- [ ] **Step 2~4:** 렉서에 `(`/`)`/`{`/`}` 토큰 추가(word-start `((` 산술 캡처는 유지, 그 앞에서 검사). 파서: `matchFuncDefName`을 토큰 기반으로 단순화, `stripLeadingParen`/`splitTrailingParen`(case) 제거하고 토큰으로, `parseBraceGroupList`가 `{`/`}` 토큰 소비. 통과 → Docker 대조 + **전체 회귀**(글롭·case·funcdef·그룹). `npm run golden`(Docker) → 바이트 동일(기존 29 불변).
- [ ] **Step 5: 커밋** — `feat(shell): tokenize ( ) { } (compact funcdef, groups; removes parser string-surgery)`

---

## Task 3: subshell `( cmd )`

**Files:** Modify `src/shell/parser.ts`(SubshellNode), `src/shell/interpreter.ts`(runCommand case); Test.

**Interfaces:** Produces `( list )` 를 **격리된 childCtx**(env/cwd 변경 안 샘, fs+budget 공유)에서 실행. `SubshellNode{kind:'subshell'; body:ListNode}`. Task 2 토큰화 위에.

**배경:** `runSubshell`(interpreter.ts:110)이 `$()`용으로 이미 childCtx 재진입. subshell 명령은 그 격리를 재사용 — `childCtx(ctx)`(isolateFunctions 아님: subshell 은 함수 공유하되 env/cwd 격리, bash 동작 확인). `( cd /x; ... )` 후 밖 cwd 안 바뀜.

- [ ] **Step 1: 실패 테스트** — bash 확인: `run("(cd /; echo $PWD); echo $PWD")` — 안에서 `/`, 밖은 원래(cwd 격리). `run("(x=5); echo $x")`→빈 줄(env 격리). `run("(echo a; echo b)")`→`a\nb`. `run("(exit 3); echo $?")`— exit/종료 처리(exit 빌트인 없으면 note). fs 공유: `run("(mkdir sub); ls")`— sub 존재. 중첩 `( ( echo x ) )`. 파이프: `echo hi | (cat)` — subshell 이 stdin 받는지.
- [ ] **Step 2~4:** 파서 `parseSubshell`(`(` 토큰 → parseList(stopOps `)`) → `)` 토큰), `Command` union + `parseCommandOrCompound` 라우팅(단일 `(` at 명령위치). interpreter `case 'subshell'`: `runList(node.body, childCtx(ctx))` 반환. stdin 전달(파이프/리다이렉션 받게 — runCommand 가 subshell 에 stdin 넘기게). 통과 → Docker 대조.
- [ ] **Step 5: 커밋** — `feat(shell): subshell ( cmd ) with isolated childCtx`

---

## Task 4: 함수-호출 디스패치 갭 (리다이렉션 · 프리픽스 · 파이프 stdin)

**Files:** Modify `src/shell/interpreter.ts`(`runSimpleCommand` 디스패치 재배치, `callFunction`/`runSource` stdin); Test.

**Interfaces:** Produces `func args > file`(리다이렉션 적용), `VAR=x func`(프리픽스 대입), `data | func`(파이프 stdin) 동작. 함수/source 가 리다이렉션·프리픽스·stdin 경로를 통과.

**배경(M2 이연):** `runSimpleCommand`(interpreter.ts:399,408)에서 함수/source 가 프리픽스대입(414)·리다이렉션(441-488) **전에** return → 3갭. `callFunction`(200)이 stdin 안 받음. **핫패스라 주의** — 리다이렉션 순서 로직 회귀 위험, 견고한 테스트 필요.

- [ ] **Step 1: 실패 테스트** — bash 확인: setup 없이 `run('f() { echo body; }; f > out.txt')` 후 `safeRead(out.txt)`===`body\n`. `run('f() { echo v=$VAR; }; VAR=hey f')`→`v=hey`. `run('f() { cat; }; echo piped | f')`→`piped`. 회귀: 일반 명령 리다이렉션/프리픽스/파이프 초록, 기존 함수/source 테스트 초록.
- [ ] **Step 2~4:** `runSimpleCommand`에서 함수/source 감지는 유지하되 **리다이렉션·프리픽스대입·stdin 해결 후** 실행하도록 재배치(또는 함수/source 를 그 경로에 통합). `callFunction`(그리고 runSource)이 stdin 인자를 받아 body/`$(...)`의 첫 스테이지에 전달. 출력 리다이렉션(`> file`)이 함수 body 의 stdout 을 파일로. 통과 → Docker 대조 + **핫패스 회귀**(리다이렉션 케이스 전부).
- [ ] **Step 5: 커밋** — `fix(shell): function/source calls honor redirection, prefix-assignment, pipe stdin`

---

## Task 5: 골든 케이스 + 최종 검증 + 마무리

**Files:** Create `tests/shell/golden/cases/30..NN-*.sh` + `expected/*.txt`; 검증만.

- [ ] **Step 1: 골든 케이스**(한 줄 `;`-조인): `30-subshell`(`(echo a; echo b); (x=5); echo done`), `31-compact-func`(`f(){ echo $1; }; f hi`), `32-arith-param`(`n=5; echo $((${#PWD} > 0)); echo $(( n * 2 ))`). `npm run golden`(Docker) → 바이트 동일, 기존 29 불변.
- [ ] **Step 2:** 전체 게이트 — `npm run build && npm test && npm run e2e` 초록. golden 재생성 바이트 동일.
- [ ] **Step 3:** `npm run dev` 실브라우저 — subshell(`(cd /; ls); pwd`), 컴팩트 함수(`f(){...}`), 산술-안-확장 동작 확인. 스크린샷 `.superpowers/sdd/m3-part2-play.png`.
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` 로 마무리. **M3 Part 2 완료** — 다음은 M3 Part 3(배열 + here-doc + read).
- [ ] **Step 5(있으면): 커밋** — `test(golden): subshell, compact-func, arith-param cases`

## 완료 조건

- `npm run build` 0 에러. `npm test` — 셸 단위(토큰화·subshell·산술-안-확장·디스패치 신규), 골든(32+), 문제(50×4), UI 초록. `npm run e2e` 초록. `npm run dev` — subshell·컴팩트 함수·`$(( ${#x} ))` 실동작. 기존 50문제 회귀 없음.

## M3 Part 3로 이연 — 별도 계획 (데이터/IO 클러스터)

- **배열** — `arr=(a b c)`, `${arr[i]}`, `${arr[@]}`, `${#arr[@]}`. 새 데이터 타입: `ShellState`에 `arrays` 테이블 + childCtx 복사 + `tryAssignment` 배열 형식 + 확장기(`resolveName`/`NAME_RE`/`expandBraceParam`) 광범위. Task 2 토큰화(`(`/`)`) 전제.
- **here-doc** — `<<EOF`/`<<-`/`<<'EOF'`. 렉서 pre-pass(라인 수집) + 새 Redir op + body payload. **도달성 제약**(per-line exec → source/shebang 파일 내용으로만, 또는 골든 하네스 변경 결정).
- **read** — `read var`/`-r`/`a b c`. **mutable stdin 커서 + 컴파운드 stdin 스레딩**(interpreter.ts:139-148 갭)이 숨은 비용 — here-doc 과 인프라 공유. `while read`가 핵심 난제.
