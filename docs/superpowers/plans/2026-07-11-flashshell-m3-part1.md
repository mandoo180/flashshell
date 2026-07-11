# FlashShell M3 Part 1 — 확장 충실도 (산술 + 파라미터 확장) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로 태스크별 실행. 스텝은 체크박스(`- [ ]`).

**Goal:** 3층(Layer-3)의 "확장" 부분을 얹는다 — `$(( ))` 산술과 `(( ))` 산술 명령, `${...}` 파라미터 확장 연산자 전체(`${#x}` `${x:-d}` `${x#p}` `${x/p/r}` `${x:o:l}` 등), `"$@"` per-argument 필드 보존, env 기반 `IFS`. 게임은 계속 플레이 가능하고, 카운터 루프(`i=$((i+1))`)와 흔한 bash 관용구가 실제로 동작하게 된다.

**Architecture:** 모든 값-생성 확장은 `expand.ts`의 비공개 `expandDollar`(char-scanner)를 통과하고 `append(field, str, protectedResult)`로 파이프라인에 재진입한다. 그래서 산술·`${...}` 연산자는 **거기 한 곳**만 손대면 명령 인자·리다이렉트·case 전부 커버된다. 예외는 `"$@"` per-arg(단일-`Field`/`splitFields` 모델에 하드 필드 경계가 없어 구조 변경 필요)와 `(( ))` 명령(렉서·파서·인터프리터 경유). 산술 평가기는 신규 순수 TS 모듈.

**Tech Stack:** Vite + React 19 + TypeScript(strict) + Zustand 5, Vitest 4, Playwright. Ground truth = `debian:stable-slim`의 bash 5 / GNU coreutils.

**Base:** 브랜치 `worktree-flashshell-m3`, base `fe8d73c`(= M2 완료, main HEAD). 베이스라인 1163 단위 + 6 e2e + 25 골든 초록.

## Global Constraints (모든 태스크에 암묵 적용)

- **엔진 순수성:** `src/shell/**`는 상대경로 import만, 호스트 글로벌 금지. `no-node-imports.test.ts`가 새 파일까지 강제. 신규 `arith.ts`도 순수·자립.
- **Ground truth = bash 5 / GNU (`debian:stable-slim`).** 산술·파라미터 확장은 미묘하니 반드시 `docker run --rm debian:stable-slim bash -c '...'` 실측.
- **`localeCompare` 금지**(C 로케일 바이트 순서). errno→텍스트는 `errnoText` 하나만.
- **`exec()`는 절대 reject 하지 않는다.** 모든 런타임 실패는 `ExecResult`로. `ExecutionLimitError`만 exit 130으로 전파. 산술 오류(0으로 나누기, 잘못된 식)는 bash처럼 stderr + 비-0 exit(단, exec는 reject 안 함).
- **`check(ctx)`는 `ctx.fs`/`ctx.lastResult`만 읽는다.** 이 마일스톤은 새 문제를 추가하지 않는다(50문제 고정).
- **기존 확장 동작 보존:** 기존 `expand.test.ts`가 초록이어야 한다. **단** `$@`/`$*` 테스트(map: expand.test.ts:189-195)는 per-arg 의미론으로 **의도적 갱신**(약화 아님). 골든 25개는 계속 바이트 동일.
- **계획 코드는 가설이다.** TDD + Docker 차등 대조 + 실행 기반 리뷰. 각 태스크 끝에 게임 플레이 가능 + 전체 초록.

## 확장기 맵 (M3 리서치, base fe8d73c) — 핵심 시임

- `expand.ts`: `ExpandCtx{env,cwd,home,fs,lastExitCode,positional,runSubshell}`(6-15). `Field{text,quoted:boolean[],hadQuotes}`(23) — **문자별 quoted 플래그**가 분할/글롭 보호를 결정. `append`(27), `IFS=[' ','\t','\n']` 상수(32, splitFields:128 + `$*` join:101 두 곳). `positionalAt`(39). **`expandDollar`(45-117)** = 유일한 `$`-dispatch char-scanner: 순서 = `$(`(55, cmd-sub) → `$?`(68) → `${...}`(75-83, `indexOf('}')`+env) → 위치인자(88-109) → `$NAME`(112). `$@`/`$*` 한 분기 공유(94-104). `splitFields`(120-140) = 비-quoted IFS만 분할, **하드 경계 표현 없음**. 공개: `expandWord`(163)·`expandToSingle`(198)·`expandForCase`(223).
- `subst.ts`: `matchSubstitutionEnd(src,i)`(13-45) 괄호-깊이 카운터. **`$((`를 `$(`와 구분 안 함** → `$((1+2))`가 `(1+2)` 명령치환으로 오인돼 조용히 빈 문자열(실측). `subst.ts` 자체는 `$(())`에 변경 불필요(이미 통째로 삼킴). `(( ))` 명령용 `matchDoubleParenEnd` 헬퍼는 신규.
- `lexer.ts`: `${...}`는 별도 kind 아님 — `raw`/`dquote`에 텍스트로 담겨 확장기가 파싱(→ `${...}` 연산자는 렉서 변경 불필요). `$(...)` 통째 삼킴(149-154, `$((...))` 포함). `(`/`)`는 OP 아님(raw 병합). **`(( ))` 명령**만 렉서 변경 필요(안 그러면 `<`가 리다이렉트로 토큰화).
- interpreter: `expandCtxFor`(101-126)가 RunCtx→ExpandCtx, `runSubshell`은 **stdout만** 캡처. `runCommand` switch(136). `runSimpleCommand`(339): argv=expandWord(350), 대입=expandWord.join(385), 리다이렉트=expandToSingle(417).
- 참고: `set`/`let`/`declare`/`shift`/`printf`/`expr` 전부 없음(위치인자는 함수/source/shebang로만 설정). `parseIntStrict`(builtins/test.ts:43)는 산술과 무관(더 엄격).

---

## Task 1: 산술 평가기 (`arith.ts`) + `$(( ))` 확장

**Files:**
- Create: `src/shell/arith.ts`, `src/shell/arith.test.ts`
- Modify: `src/shell/expand.ts` (`expandDollar`에 산술 분기)
- Test: `src/shell/expand.test.ts`

**Interfaces:**
- Produces: `evalArith(expr: string, ctx: { env: Record<string,string> }): number` — 정수 산술 평가, `ctx.env` 읽기+쓰기(대입·증감). `expandDollar`가 `$((expr))`를 만나면 `String(evalArith(...))`로 확장.

**배경:** 산술 평가기 전무. `$((1+2))`는 현재 `(1+2)` 명령치환으로 오인돼 빈 문자열(카운터 루프 블로커, 실측 확인). 렉서는 `$((...))`를 이미 통째로 삼켜 확장기에 넘긴다 → 확장기에서만 처리하면 된다.

**서브셋(bash 산술, 전부 Docker 실측):** 정수만(부동소수 없음). 연산자: `+ - * / % **`(거듭제곱), 단항 `+ - !`, 비교 `< <= > >= == !=`, 논리 `&& || `, 삼항 `?:`, 비트 `& | ^ ~ << >>`(선택 — bash 지원), 괄호. 피연산자: 리터럴(10진, `0x`16진, `0`8진 — bash 규약 실측), 변수(bare `x` **와** `$x` 둘 다; 미설정/빈 값 = 0; 값이 다시 산술식일 수 있음 = 재귀 평가, 단 예산/깊이 제한), 대입 `x=expr` `x+=expr` 등, 증감 `x++ ++x x-- --x`. 0으로 나누기 → 오류. C 우선순위.

- [ ] **Step 1: 실패 테스트**(`arith.test.ts`) — bash 확인 후: `evalArith('1+2')`→3, `'2*3+1'`→7, `'2**10'`→1024, `'7%3'`→1, `'10/3'`→3(정수), `'(1+2)*3'`→9, `'5>3'`→1, `'5<3'`→0, `'1&&0'`→0, `'1?7:9'`→7, `'-5'`→-5, `'!0'`→1. env: `evalArith('x+1',{env:{x:'5'}})`→6, 미설정 `'y+1'`→1(y=0), `$x` 형태 `'$x*2'`(x=5)→10. 대입 부작용: `const e={x:'3'}; evalArith('x=x+2', e)` → 반환 5 **및 e.x==='5'`. 증감: `evalArith('x++',{x:'3'})`→3 반환·x='4'; `'++x'`→4·x='4'. 0 나누기: throw 또는 특별 반환(구현 선택, expandDollar가 bash처럼 stderr+비0 처리).
- [ ] **Step 2: 실패 확인** — `npx vitest run --project shell src/shell/arith.test.ts`.
- [ ] **Step 3: 구현** — `arith.ts`: 토크나이저(숫자·식별자·연산자) → 우선순위 등반(Pratt) 파서/평가기. `ctx.env`에서 변수 읽고(빈/미설정=0, 값이 식이면 재귀 — 무한 재귀 방지 깊이 상한), 대입/증감은 `ctx.env`에 문자열로 기록. 예산: 재귀/반복이 폭주하지 않게 노드/스텝 상한(초과 시 throw — expandDollar가 잡음). **`expand.ts`:** `expandDollar` 55행(`$(` 분기) **직전에** `if (source[i+1]==='(' && source[i+2]==='(')` 분기 추가: `matchSubstitutionEnd`로 `))` 끝 찾고 `slice(i+3, close-1)`가 식(끝 `)`은 이중닫힘 확인), `append(field, String(evalArith(expr, ctx)), protectedResult)`, `i=close+1`. **반드시 `$(` 앞**(안 그러면 오늘의 버그 재현).
- [ ] **Step 4: 통과 + 통합 + Docker** — arith 단위 + `expand.test.ts`에 `$(( ))` 섹션(`echo $((1+2))`→`3`, `x=5; echo $((x+1))` 통합은 interpreter.test에서). 카운터 루프 종단 확인: `run("i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done")` → `0\n1\n2\n`(이제 산술로 종단!). Docker: `docker run --rm debian:stable-slim bash -c 'echo $((2**10)); x=5; echo $((x+1)); echo $((10/3))'`.
- [ ] **Step 5: 커밋** — `feat(shell): arithmetic evaluator and $(( )) expansion`

---

## Task 2: `(( ))` 산술 명령

**Files:** Modify `src/shell/lexer.ts`(`(( ))` 삼킴), `src/shell/subst.ts`(`matchDoubleParenEnd`), `src/shell/parser.ts`(ArithNode), `src/shell/interpreter.ts`(runCommand case); Test.

**Interfaces:** Produces `(( expr ))` 명령 — `evalArith(expr, ctx)` 평가, **exit 0 iff 결과 ≠ 0**(bash 산술 명령 규약, 참=성공), env 부작용 반영. `for (( ))` C-스타일 루프는 Part 2 범위 밖(이 태스크는 스탠드얼론 `(( ))`만).

**배경:** `(( i < 5 ))`는 현재 렉서가 `((` `i` 후 `<`를 리다이렉트로 토큰화해 완전히 깨짐. `(`/`)`가 OP가 아니라 raw 병합이라, 명령 위치의 `((`를 통째로 삼켜야 한다.

- [ ] **Step 1: 실패 테스트** — bash 확인: `run("(( 1 + 2 )); echo $?")` → `0`(참). `run("(( 0 )); echo $?")` → `1`(거짓, 결과 0). `run("x=1; (( x++ )); echo $x")` → `2`(부작용). `run("(( 5 < 3 )); echo $?")` → `1`.
- [ ] **Step 2~4:** 렉서: 단어 시작 `ch==='(' && next==='('`면 매칭 `))`까지 한 단위로 삼킴(`matchDoubleParenEnd`, subst.ts). 파서: `ArithNode{kind:'arith'; expr:string}`를 `Command` 유니온에 추가(TS2366가 runCommand case 강제), `parseCommandOrCompound`에서 그 단위를 라우팅. interpreter: `case 'arith'` → `evalArith(node.expr, ctx.state)`(ctx.state.env 대상), 결과≠0 → exit 0 else 1, 오류 → stderr+exit. Docker 대조. 회귀(기존 리다이렉트/서브셋 파싱) 확인.
- [ ] **Step 5: 커밋** — `feat(shell): (( )) arithmetic command`

---

## Task 3: 파라미터 확장 — 길이 + 기본값/대체 (`${#x}` `${x:-d}` 계열) + `${...}` 서브파서

**Files:** Modify `src/shell/expand.ts` (`${...}` 파싱 교체); Test `src/shell/expand.test.ts`.

**Interfaces:** Produces `${...}` 진짜 파서 — 중괄호-매칭 종료(중첩·따옴표 존중), VARNAME + 연산자 + arg 분해. 이 태스크: `${#name}`(길이), `${#}`/`${#@}`(개수), `${name:-word}`(미설정/빈→word), `${name:=word}`(대입), `${name:+word}`(설정시 word), `${name:?word}`(미설정시 오류). arg는 재확장 대상(`${x:-$y}`).

**배경:** 현재 `${...}`는 `indexOf('}')` + env 조회뿐(75-83) — `${#x}`, `${x:-d}`, `${x/a/b}` 전부 이름 그대로 조회해 미스. 중괄호 매칭이 `indexOf`라 중첩/치환 replacement의 `}`에서 깨진다.

- [ ] **Step 1: 실패 테스트** — bash 확인: `${#NAME}`(NAME=world)→`5`, `${UNSET:-fb}`→`fb`, `${NAME:-fb}`→`world`, `${EMPTY:-fb}`→`fb`(빈=미설정 취급, `:-`), `${EMPTY-fb}`→``(빈≠미설정, `-`만), `${UNSET:=def}`→`def` 및 env에 def 설정, `${NAME:+alt}`→`alt`, `${UNSET:+alt}`→``, `${#@}`(위치인자 개수). arg 재확장: `${UNSET:-$NAME}`→`world`.
- [ ] **Step 2~4:** `${...}` 서브파서: `i+1==='{'`에서 시작, **중괄호 매칭**(depth 카운트, 따옴표/치환 내부 무시)로 종료 `}` 찾기 → 내부 문자열을 `VARNAME`(선택적 선행 `#` 길이) + 연산자(`:- := :+ :?` 및 비-`:` 변형) + arg로 분해. VARNAME은 `[A-Za-z_][A-Za-z0-9_]*` 또는 위치인자(`@ * # 0-9`). arg는 `expandDollar` 재귀로 확장. `:` 유무로 "빈 값도 미설정 취급"(`:-`) vs "미설정만"(`-`) 구분. `:?`는 stderr+비0(expandDollar가 처리 가능하게 신호). 통과 → Docker 대조 `NAME=world; echo ${#NAME} ${UNSET:-fb} ${EMPTY:-fb} ${EMPTY-fb}`. **회귀:** 기존 `${NAME}`/`${N}`(위치) 테스트 초록 유지.
- [ ] **Step 5: 커밋** — `feat(shell): parameter expansion length + default/alternate operators`

---

## Task 4: 파라미터 확장 — 패턴 제거 + 치환 + 부분문자열

**Files:** Modify `src/shell/expand.ts` (Task 3 서브파서 확장); Test.

**Interfaces:** Produces `${x#p}` `${x##p}`(접두 최소/최대 제거) `${x%p}` `${x%%p}`(접미), `${x/p/r}` `${x//p/r}`(치환 첫/전체) `${x/#p/r}` `${x/%p/r}`(접두/접미 고정), `${x:off}` `${x:off:len}`(부분문자열). 패턴은 글롭 문법(`matchSegment` from `glob.ts` 재사용).

**배경:** Task 3의 `${...}` 서브파서 위에 나머지 연산자를 얹는다. `#`/`%`/`/`는 글롭 패턴 매칭이 필요.

- [ ] **Step 1: 실패 테스트** — bash 확인: `f=a.txt; ${f%.txt}`→`a`, `${f%%.*}`... (bash 실측), `${f#*.}`→`txt`, `p=/a/b/c; ${p##*/}`→`c`, `${p%/*}`→`/a/b`, `s=hello; ${s/l/L}`→`heLlo`(첫), `${s//l/L}`→`heLLo`(전체), `${s:1:3}`→`ell`, `${s:2}`→`llo`, `${s: -2}`→`lo`(음수 오프셋, 공백 주의). 각 bash 정확 값 확정.
- [ ] **Step 2~4:** 서브파서에 `# ## % %%`(글롭 앵커 매칭 — `#`는 접두 최소/최대, `%`는 접미), `/ // /# /%`(치환 — 패턴을 글롭으로 매치해 대체), `:off:len`(부분문자열, 음수 오프셋). `matchSegment`로 패턴 매칭(가장 짧은/긴 매치 구현). 통과 → Docker 대조. 회귀 확인.
- [ ] **Step 5: 커밋** — `feat(shell): parameter expansion pattern-removal, substitution, substring`

---

## Task 5: 필드 분할 충실도 — `"$@"` per-arg + env `IFS`

**Files:** Modify `src/shell/expand.ts` (`Field`/`append`/`splitFields` 구조 + `@`/`*` 분기 + IFS); Test.

**Interfaces:** Produces `"$@"`가 각 위치인자를 **개별 필드**로(인접 텍스트가 있어도: `"pre$@post"` → `preA`,`B`,`Cpost`). `"$*"`는 IFS[0]로 조인한 단일 필드. 비따옴표 `$@`/`$*`는 기존대로 단어분할. `IFS`를 `ctx.env.IFS`에서 읽음(미설정→기본 `[' ','\t','\n']`, 빈 문자열→분할 안 함).

**배경(가장 구조적):** 현재 `Field`는 `{text, quoted[], hadQuotes}`뿐 — IFS가 아닌 **하드 필드 경계** 표현이 없다. `"$@"`는 IFS와 무관하게 각 인자 사이에 경계가 필요. `@`/`*`가 한 분기 공유(94-104). `IFS`는 하드코딩 상수 두 곳.

- [ ] **Step 1: 실패 테스트** — bash 확인(위치인자는 함수/`run(...,positional)`로 주입): `run('f() { for a in "$@"; do echo "[$a]"; done; }; f x "y z" w')` → `[x]\n[y z]\n[w]\n`(따옴표 안 공백 보존, 3필드). `run('f() { echo "$*"; }; f a b c')`(IFS 기본) → `a b c`. `"pre$@post"`: `run('f() { printf "%s\\n" "pre$@post"; }; f A B C')` → `preA\nB\nCpost`(단, printf 없음 — `for x in "pre$@post"; do echo "$x"; done`로 대체). IFS: `run('IFS=:; ...')` — 단, 대입 후 `IFS`가 env에 있어야. `run("f() { echo $*; }; f a b c")` with IFS=`,` → `a,b,c`.
- [ ] **Step 2~4:** `Field`에 하드 경계 표현 추가(예: `breaks: Set<number>` 또는 경계 인덱스) — `append` 및 `splitFields`가 IFS·quoted와 무관하게 그 지점에서 필드를 끊게. `@`/`*` 분기 분리: `"$@"`(protectedResult)면 각 인자를 하드-경계로 emit, `"$*"`면 IFS[0] 조인 단일 필드, 비따옴표는 기존. `splitFields`와 `$*` join이 `ctx.env.IFS`(파싱: 미설정→기본, ""→분할 안 함)를 쓰게. **`$@`/`$*` 기존 테스트(map:189-195) 갱신**(per-arg 의미론 — 약화 아님, 정확화). 통과 → Docker 대조. **회귀:** 나머지 확장 테스트 초록.
- [ ] **Step 5: 커밋** — `feat(shell): "$@" per-argument fields and IFS from env`

---

## Task 6: 골든 케이스 + 최종 검증 + 마무리

**Files:** Create `tests/shell/golden/cases/26..NN-*.sh` + `expected/*.txt`; 검증만.

- [ ] **Step 1: 골든 케이스** — 한 줄 `;`-조인으로 산술·파라미터 확장·`"$@"`가 실제 bash와 바이트 일치함을 고정: `26-arith`(`echo $((2**10)); x=5; echo $((x+1)); echo $((10/3))`), `27-param-default`(`NAME=world; echo ${#NAME} ${UNSET:-fb} ${EMPTY:-fb}`), `28-param-pattern`(`f=a.txt; echo ${f%.txt} ${f#*.}`), `29-param-subst`(`s=hello; echo ${s//l/L} ${s:1:3}`). `"$@"`는 함수라 골든(한 줄씩 exec)엔 안 맞으면 단위테스트로 충분 — 골든은 산술·파라미터만. `npm run golden`(Docker) → `git status` 바이트 동일. 기존 25개 불변.
- [ ] **Step 2:** 전체 게이트 — `npm run build && npm test && npm run e2e` 초록. golden 재생성 후 바이트 동일.
- [ ] **Step 3:** `npm run dev` 실브라우저 — 카운터 루프(`i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done`)가 이제 동작하는지, `${f%.txt}` 같은 파라미터 확장이 동작하는지 확인. 스크린샷 `.superpowers/sdd/m3-part1-play.png`.
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` 로 마무리. **M3 Part 1 완료** — 다음은 M3 Part 2(구조 & I/O: 배열·here-doc·read·subshell·함수 리다이렉션·`(){}` 토큰화).
- [ ] **Step 5(있으면): 커밋** — `test(golden): arithmetic and parameter-expansion cases`

## 완료 조건

- `npm run build` 타입 에러 0.
- `npm test` — 셸 단위(산술·파라미터 확장·`"$@"` 신규 포함), 골든(29+ 케이스), 문제(50문제 × 4), UI 전부 초록.
- `npm run e2e` — smoke + worker + hud 초록.
- `npm run dev` — 카운터 루프·파라미터 확장 실동작. 기존 50문제 회귀 없음.

## Part 2(M3 Part 2)로 이연 — 별도 계획

구조 & I/O: 배열, here-doc + `read`, subshell `( )`, 함수-호출 리다이렉션/프리픽스-대입/파이프-stdin 갭(M2 이연), `(){}`/`{ }`/case-paren 렉서 토큰화(M2 이연). 그리고 M3 Part 3 = 폴리시. (M2 때 산술/접미사제거 회피로 재구성한 L5-01/03/10 퍼즐을 자연스러운 관용구로 되돌리는 것은 선택적 폴리시 — 지금은 그대로 유효.)
