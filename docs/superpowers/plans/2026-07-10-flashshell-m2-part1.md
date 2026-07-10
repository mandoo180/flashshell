# FlashShell M2 — Part 1: 실행 격리 + 코어유틸 확장 + L3/L4 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Layer-1 엔진 위에서, 텍스트 처리(L3)·시스템(L4) 문제 20개를 실제로 풀 수 있게 코어유틸 8개를 추가하고, `exec`를 Web Worker로 격리해 grep ReDoS를 포함한 모든 무한 정지에서 브라우저 탭이 얼지 않게 만든다.

**Architecture:** 셸 엔진(`src/shell/**`)은 여전히 순수 TypeScript로 남고 Node에서 직접 단위 테스트한다. 새 코어유틸은 기존 `CommandFn` 시그니처와 `shared.ts` 헬퍼를 그대로 쓴다. UI 쪽에서는 `Shell`을 직접 들고 있던 스토어를, `ShellSession`이라는 비동기 인터페이스 뒤로 옮긴다. `LocalShellSession`(인프로세스, Node/jsdom 테스트용)과 `WorkerShellSession`(브라우저, wall-clock 데드라인 + terminate + 히스토리 리플레이 복원)이 그 인터페이스를 구현한다. 셸은 워커 안에서 살고, `check()`도 워커 안에서 돈다. 스토어는 매 응답에 실려 오는 스냅샷(cwd, cwd 목록, env, solved)을 미러링해 동기 API(`completions`/`prompt`)를 유지한다.

**Tech Stack:** 기존 그대로 — Vite + React + TypeScript + Zustand, Vitest(node/jsdom 2-project), Playwright, 골든 테스트는 `debian:stable-slim`의 bash 5 / GNU coreutils.

## 이 계획의 범위

**포함:** 코어유틸 8개(`sed` `awk` `cut` `tr` `uniq` `find` `xargs` `diff`), 그에 맞는 골든 케이스, Web Worker 실행 격리(+데드라인+복원), L3 문제 10개, L4 문제 10개, M1에서 이월된 UX Important 2건(375px HUD 겹침, NEXT 이후 포커스 유실).

**의도적으로 뺀 것 — `du`.** 설계 §3의 L4 대표 명령에 `du`가 있지만 구현하지 않는다. GNU `du`는 디스크 **블록** 회계(기본 1K 단위, 파일마다 4KB로 반올림, 디렉터리 자체도 블록 소비)라, 파일이 그냥 문자열인 우리 VFS에는 대응하는 블록 모델이 없다. 가짜 블록 모델을 넣으면 골든 테스트에서 GNU와 절대 바이트 일치하지 않는다. L4는 `find`/`xargs`/`chmod`/`stat`/`wc`/`diff`로 충분히 풍부하다. (M3에서 블록 모델을 도입하면 그때 추가한다.)

**제외 (→ M2 Part 2):** Layer-2 엔진 — `if`/`for`/`while`/`case`, 함수, `test`/`[`, 위치인자(`$1`..`$@`/`$#`), `source`, shebang 실행, 반복당 스텝 예산. L5 문제 10개. 렉서의 개행/키워드 처리 재작업. **이 계획의 어떤 코어유틸도, 어떤 L3/L4 문제도 제어문을 요구하지 않는다.**

**M1의 교훈 (모든 태스크에 적용):** 계획에 적힌 코드는 실행되지 않은 가설이다. M1에서 계획 코드에 실제 결함이 60개 넘게 나왔고 전부 **읽어서가 아니라 실행해서** 잡혔다. 그러므로 모든 태스크는 TDD로 진행하고, 출력 형식·에러 문구가 걸린 곳은 `docker run --rm debian:stable-slim bash -c '...'`로 실제 bash/GNU와 대조하며, 리뷰는 실행 기반이다. 추측 금지.

## Global Constraints

- 셸 엔진(`src/shell/**`)은 `react`, `zustand`, `window`, `document`, `localStorage`, Node/DOM 전역, 비상대 import를 참조하지 않는다. `src/shell/no-node-imports.test.ts`가 기계적으로 강제한다.
- TypeScript strict, `noUncheckedIndexedAccess`, `noUnusedLocals`.
- 커밋 메시지는 Conventional Commits.
- `localeCompare` 금지 — C 로케일 바이트 순(대문자 먼저)이 기준. 하나의 errno→문구 매핑(`errnoText` in `src/shell/errors.ts`)만.
- 코어유틸의 출력 형식·에러 문구·종료 코드의 기준은 `debian:stable-slim`의 GNU coreutils / bash 5. macOS BSD 가 아니다.
- 파일 크기와 바이트 수는 `byteLength()`로 진짜 UTF-8 바이트를 센다.
- 구현하지 않은 명령은 `flashshell: <cmd>: 이 환경에는 없는 명령입니다`(exit 127). 오타는 `bash: <cmd>: command not found`(exit 127).
- 구현하지 않은 **기능**(예: sed의 미지원 명령)은 `flashshell:` 접두사로 정직하게 밝힌다. GNU 문구를 흉내내 없는 기능을 있는 척하지 않는다.
- `check(ctx)`는 `ctx.fs`와 `ctx.lastResult`만 읽는다 — `ctx.history` 절대 금지.
- 정오답을 밝기만으로 표현하지 않는다. 모든 애니메이션은 `prefers-reduced-motion: reduce`에서 꺼진다. 색은 `theme.css`의 `:root` 밖에 리터럴로 새지 않는다.

## 코어유틸 서브셋 계약 (문서화된 의도적 축소)

이 게임의 `sed`/`awk`는 **명시적 서브셋**이다. 전체 언어가 아니다. 각 코어유틸 태스크는 지원 범위를 코드 주석과 리포트에 명기하고, 범위 밖 입력은 `flashshell:` 메시지로 정직하게 거부한다. L3/L4 문제는 이 서브셋 안에서만 출제한다. (M1의 "grep은 ERE-ish JS RegExp", "ls는 항상 한 줄에 하나", "`ls -l`은 날짜 없음"과 같은 종류의 수용된 divergence다.)

---

## File Structure

```
src/shell/coreutils/
  cut.ts   tr.ts   uniq.ts        (Task 1)
  sed.ts                          (Task 2)
  awk.ts                          (Task 3)
  find.ts  xargs.ts               (Task 4)
  diff.ts                         (Task 5)
  index.ts                        (Task 1~5에서 등록 추가)
  text.test.ts                    (Task 1~3 테스트)
  system.test.ts                  (Task 4~5 테스트)
src/shell/registry.ts             (Task 1~5에서 KNOWN_UNIMPLEMENTED 정리)

tests/shell/golden/
  seed.sh                         (Task 6에서 텍스트/시스템 픽스처 추가)
  cases/14-cut-tr-uniq.sh 15-sed.sh 16-awk.sh 17-find-xargs.sh 18-du-diff.sh
  expected/*.txt                  (Task 6에서 생성)

src/ui/
  session.ts        ShellSession 인터페이스 + LocalShellSession   (Task 7)
  shell.worker.ts   워커 엔트리 (exec + check, postMessage)        (Task 8)
  worker-session.ts WorkerShellSession (데드라인 + terminate + 리플레이) (Task 8)
  store.ts          세션 뒤로 재배선, 스냅샷 미러링                (Task 9)
  store.test.ts     LocalShellSession 기반으로 재작성              (Task 9)
  session.test.ts   LocalShellSession 단위 테스트                  (Task 7)
  HudCard.tsx theme.css                                            (Task 12: 375px 겹침)
  Terminal.tsx Play.tsx                                            (Task 13: NEXT 포커스)

src/game/problems/
  l3.ts  l4.ts                    (Task 10, 11)
  index.ts                        (Task 10, 11에서 등록)

e2e/
  worker.spec.ts                  (Task 9: 데드라인 복원, grep ReDoS 무정지)

docs/M2-SEAMS.md                  (Task 8에서 grep ReDoS 항목을 "해결됨"으로 갱신)
```

**태스크 순서와 그 이유.** 코어유틸(1~6)을 먼저 한다 — 순수 엔진이라 위험이 낮고, 게임은 그동안 L1/L2로 계속 플레이 가능하며, 엔진이 풍부해진다. 그 다음 워커(7~9)로 UI 경계를 재설계한다 — 이때 UI가 잠시 흔들리지만 각 태스크 끝에서 플레이 가능을 유지한다. 그 다음 L3/L4 문제(10~11)를 얹으면 비로소 새 레벨이 플레이된다. 마지막으로 UX(12~13)와 최종 검증(14).

---
## Task 1: 코어유틸 — `cut` `tr` `uniq`

**Files:**
- Create: `src/shell/coreutils/cut.ts`, `tr.ts`, `uniq.ts`, `src/shell/coreutils/text.test.ts`
- Modify: `src/shell/coreutils/index.ts` (등록), `src/shell/registry.ts` (`KNOWN_UNIMPLEMENTED`에서 `cut` `tr` `uniq` 제거)

**Interfaces:**
- Consumes: `shared.ts`의 `readSources`, `toLines`, `parseFlags`, `errnoText`; `types.ts`의 `CommandFn`, `ok`, `fail`.
- Produces: `coreutils` 표에 `cut` `tr` `uniq` 세 키(각 `CommandFn`).

**서브셋 계약 (주석에도 명기):**
- `cut`: `-f LIST [-d DELIM]`(필드, 기본 구분자 TAB), `-c LIST`(문자), `-s`(구분자 없는 줄 억제). LIST는 `N` `N,M` `N-M` `N-`(N부터 끝) `-M`(처음부터 M). `-f`/`-c` 둘 다 없으면 에러. `-b`(바이트)는 미지원.
- `tr`: `SET1 SET2`(치환), `-d SET1`(삭제), `-s SET1`(중복 압축). SET은 `a-z` 범위, `[:upper:]`/`[:lower:]`/`[:digit:]`/`[:space:]` 클래스, `\n \t \\` 이스케이프 지원. **stdin만** 읽는다(파일 인자 없음). SET1이 SET2보다 길면 SET2의 마지막 문자로 채운다.
- `uniq`: `[-c] [-d] [-u] [-i] [INPUT]`. **인접한** 중복 줄만 접는다(정렬 안 함). `-c`(개수 접두, `%7d ` 형식), `-d`(중복된 것만), `-u`(유일한 것만), `-i`(대소문자 무시). 파일 인자 하나 또는 stdin.

모든 기대값은 아래에 GNU(`debian:stable-slim`)에서 실측한 값이다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/shell/coreutils/text.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createShell, VFS } from '../index'
import type { Shell } from '../types'

let fs: VFS
let sh: Shell
beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/w', { recursive: true })
  fs.writeFile('/w/f.csv', 'a:b:c\nd:e:f\n')
  fs.writeFile('/w/nums.txt', '10\n9\n100\n')
  fs.writeFile('/w/dup.txt', 'a\na\nb\nc\nc\n')
  fs.writeFile('/w/nodelim.txt', 'nodelim\na:b\n')
  sh = createShell({ fs, cwd: '/w', home: '/w' })
})
const out = async (line: string) => (await sh.exec(line)).stdout
const run = (line: string) => sh.exec(line)

describe('cut', () => {
  it('-d -f 로 필드 하나', async () => { expect(await out('cut -d: -f2 f.csv')).toBe('b\ne\n') })
  it('-f 목록', async () => { expect(await out('cut -d: -f1,3 f.csv')).toBe('a:c\nd:f\n') })
  it('-f 열린 범위', async () => { expect(await out('cut -d: -f2- f.csv')).toBe('b:c\ne:f\n') })
  it('-c 문자 범위', async () => { expect(await out('echo abcdef | cut -c1-3')).toBe('abc\n') })
  it('구분자 없는 줄은 -s 없으면 통째로', async () => { expect(await out('cut -d: -f2 nodelim.txt')).toBe('nodelim\nb\n') })
  it('-s 는 구분자 없는 줄을 버린다', async () => { expect(await out('cut -d: -s -f2 nodelim.txt')).toBe('b\n') })
  it('-f/-c 둘 다 없으면 exit 1', async () => {
    const r = await run('cut f.csv'); expect(r.exitCode).toBe(1); expect(r.stderr).toContain('cut')
  })
})

describe('tr', () => {
  it('범위 치환', async () => { expect(await out('echo hello | tr a-z A-Z')).toBe('HELLO\n') })
  it('-d 삭제', async () => { expect(await out('echo a1b2c3 | tr -d 0-9')).toBe('abc\n') })
  it('-s 압축', async () => { expect(await out('echo aaabbbccc | tr -s abc')).toBe('abc\n') })
  it('문자 클래스', async () => { expect(await out('echo HeLLo | tr [:upper:] [:lower:]')).toBe('hello\n') })
  it('SET1 이 길면 SET2 마지막으로 채운다', async () => { expect(await out('echo abc | tr abc x')).toBe('xxx\n') })
})

describe('uniq', () => {
  it('인접 중복을 접는다', async () => { expect(await out('uniq dup.txt')).toBe('a\nb\nc\n') })
  it('정렬은 안 한다 (인접만)', async () => { expect(await out('printf "a\\nb\\na\\n" | uniq')).toBe('a\nb\na\n') })
  it('-c 개수 (7칸)', async () => { expect(await out('uniq -c dup.txt')).toBe('      2 a\n      1 b\n      2 c\n') })
  it('-d 중복된 것만', async () => { expect(await out('uniq -d dup.txt')).toBe('a\nc\n') })
  it('-u 유일한 것만', async () => { expect(await out('uniq -u dup.txt')).toBe('b\n') })
  it('-i 대소문자 무시', async () => { expect(await out('printf "A\\na\\n" | uniq -i')).toBe('A\n') })
  it('stdin 도 된다', async () => { expect(await out('cat dup.txt | uniq')).toBe('a\nb\nc\n') })
})
```

여기서 `printf`는 우리 셸에 없다. 위 두 곳(`uniq` "정렬 안 함", "-i")은 `printf` 대신 파일로 바꿔라 — `fs.writeFile('/w/aba.txt', 'a\nb\na\n')`, `fs.writeFile('/w/Aa.txt', 'A\na\n')`를 `beforeEach`에 추가하고 `uniq aba.txt`, `uniq -i Aa.txt`로 친다. (M1에서도 이 함정이 있었다 — `printf`를 셸에 넣지 않는다.)

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run --project shell src/shell/coreutils/text.test.ts`
Expected: FAIL — `cut: command not found` 등.

- [ ] **Step 3: `cut.ts` 구현**

```ts
// src/shell/coreutils/cut.ts
//
// 서브셋: -f LIST [-d DELIM] (필드, 기본 구분자 TAB), -c LIST (문자), -s.
// LIST 항목: N | N-M | N- | -M. -b(바이트)는 미지원.
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

/** "1,3-5,7-" 을 (1-based, inclusive) 범위 목록으로 파싱. 열린 끝은 Infinity. */
function parseList(spec: string): { start: number; end: number }[] | null {
  const ranges: { start: number; end: number }[] = []
  for (const part of spec.split(',')) {
    if (part === '') return null
    const m = /^(\d*)-(\d*)$/.exec(part)
    if (m) {
      const start = m[1] === '' ? 1 : Number(m[1])
      const end = m[2] === '' ? Infinity : Number(m[2])
      if (start < 1 || end < start) return null
      ranges.push({ start, end })
    } else if (/^\d+$/.test(part)) {
      const n = Number(part)
      if (n < 1) return null
      ranges.push({ start: n, end: n })
    } else {
      return null
    }
  }
  return ranges
}

function inRanges(n: number, ranges: { start: number; end: number }[]): boolean {
  return ranges.some((r) => n >= r.start && n <= r.end)
}

export const cut: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args, ['f', 'c', 'd'])
  const delim = flags.get('d') ?? '\t'
  const suppress = flags.has('s')

  const spec = flags.get('f') ?? flags.get('c')
  if (spec === undefined) {
    return { stdout: '', stderr: 'cut: you must specify a list of bytes, characters, or fields\n', exitCode: 1 }
  }
  const ranges = parseList(spec)
  if (ranges === null) {
    return { stdout: '', stderr: `cut: invalid field value '${spec}'\n`, exitCode: 1 }
  }
  const byField = flags.has('f')

  const { sources, stderr, failed } = readSources(e, rest)
  let stdout = ''
  for (const source of sources) {
    for (const line of toLines(source.text)) {
      if (byField) {
        if (!line.includes(delim)) {
          if (!suppress) stdout += `${line}\n`
          continue
        }
        const fields = line.split(delim)
        const picked = fields.filter((_, i) => inRanges(i + 1, ranges))
        stdout += `${picked.join(delim)}\n`
      } else {
        // -c: 문자 단위. (우리 VFS는 UTF-16 문자열이므로 코드유닛 기준 — 게임 파일은 ASCII다.)
        const chars = [...line].filter((_, i) => inRanges(i + 1, ranges))
        stdout += `${chars.join('')}\n`
      }
    }
  }
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
```

- [ ] **Step 4: `tr.ts` 구현**

```ts
// src/shell/coreutils/tr.ts
//
// 서브셋: SET1 SET2 (치환), -d SET1 (삭제), -s SET1 (중복 압축).
// SET: a-z 범위, [:upper:]/[:lower:]/[:digit:]/[:space:] 클래스, \n \t \\ 이스케이프.
// stdin 만 읽는다 (파일 인자 없음).
import type { CommandFn } from '../types'
import { parseFlags } from './shared'

const CLASSES: Record<string, string> = {
  '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
  '[:digit:]': '0123456789',
  '[:space:]': ' \t\n\r\f\v',
}

/** SET 스펙을 개별 문자 배열로 펼친다. */
function expandSet(spec: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < spec.length) {
    // 문자 클래스
    let matchedClass = false
    for (const [name, chars] of Object.entries(CLASSES)) {
      if (spec.startsWith(name, i)) { out.push(...chars); i += name.length; matchedClass = true; break }
    }
    if (matchedClass) continue

    // 이스케이프
    if (spec[i] === '\\') {
      const next = spec[i + 1]
      out.push(next === 'n' ? '\n' : next === 't' ? '\t' : next === '\\' ? '\\' : (next ?? '\\'))
      i += 2
      continue
    }

    // 범위 a-z
    if (spec[i + 1] === '-' && spec[i + 2] !== undefined && spec[i + 2] !== '') {
      const lo = spec.charCodeAt(i)
      const hi = spec.charCodeAt(i + 2)
      if (hi >= lo) { for (let c = lo; c <= hi; c++) out.push(String.fromCharCode(c)); i += 3; continue }
    }

    out.push(spec[i]!)
    i++
  }
  return out
}

export const tr: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const del = flags.has('d')
  const squeeze = flags.has('s')

  const set1 = rest[0] !== undefined ? expandSet(rest[0]) : []
  const set2 = rest[1] !== undefined ? expandSet(rest[1]) : []

  if (del) {
    const drop = new Set(set1)
    let result = [...e.stdin].filter((ch) => !drop.has(ch)).join('')
    if (squeeze && set2.length > 0) result = squeezeRun(result, new Set(set2))
    return { stdout: result, stderr: '', exitCode: 0 }
  }

  // 치환. SET1[i] → SET2[i], SET2 가 짧으면 마지막 문자로 채운다.
  const map = new Map<string, string>()
  if (set2.length > 0) {
    for (let i = 0; i < set1.length; i++) {
      map.set(set1[i]!, set2[Math.min(i, set2.length - 1)]!)
    }
  }
  let result = [...e.stdin].map((ch) => map.get(ch) ?? ch).join('')

  // -s: 압축 대상은 (치환이 있으면) SET2, 아니면 SET1.
  if (squeeze) result = squeezeRun(result, new Set(set2.length > 0 ? set2 : set1))

  return { stdout: result, stderr: '', exitCode: 0 }
}

/** set 에 든 문자가 연달아 나오면 하나로 접는다. */
function squeezeRun(text: string, set: Set<string>): string {
  let out = ''
  let prev = ''
  for (const ch of text) {
    if (ch === prev && set.has(ch)) continue
    out += ch
    prev = ch
  }
  return out
}
```

- [ ] **Step 5: `uniq.ts` 구현**

```ts
// src/shell/coreutils/uniq.ts
//
// 서브셋: [-c] [-d] [-u] [-i] [INPUT]. 인접 중복만 접는다 (정렬 안 함).
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

export const uniq: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const count = flags.has('c')
  const onlyDup = flags.has('d')
  const onlyUniq = flags.has('u')
  const ignoreCase = flags.has('i')

  const { sources, stderr, failed } = readSources(e, rest.slice(0, 1))
  const lines = sources.flatMap((s) => toLines(s.text))

  const key = (line: string) => (ignoreCase ? line.toLowerCase() : line)
  const groups: { line: string; n: number }[] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (last && key(last.line) === key(line)) last.n += 1
    else groups.push({ line, n: 1 })
  }

  let stdout = ''
  for (const g of groups) {
    if (onlyDup && g.n < 2) continue
    if (onlyUniq && g.n > 1) continue
    stdout += count ? `${String(g.n).padStart(7)} ${g.line}\n` : `${g.line}\n`
  }
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
```

- [ ] **Step 6: 등록 + `KNOWN_UNIMPLEMENTED` 정리**

`src/shell/coreutils/index.ts`에 세 개를 import하고 표에 추가:

```ts
import { cut } from './cut'
import { tr } from './tr'
import { uniq } from './uniq'
// ... 기존 표에 cut, tr, uniq 추가
export const coreutils: Record<string, CommandFn> = {
  ls, cat, head, tail, wc, stat, grep, sort,
  cp, mv, rm, mkdir, rmdir, touch, ln, chmod,
  cut, tr, uniq,
}
```

`src/shell/registry.ts`의 `KNOWN_UNIMPLEMENTED` Set에서 `'cut'`, `'tr'`, `'uniq'`를 **제거**한다. (남겨두면 `isKnownUnimplemented`가 이제 구현된 명령을 "없다"고 하는데, 실제로는 `lookupCommand`가 먼저 찾으므로 관측되진 않지만 — 목록을 정직하게 유지한다.)

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run --project shell src/shell/coreutils/text.test.ts`
Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add src/shell/coreutils/cut.ts src/shell/coreutils/tr.ts src/shell/coreutils/uniq.ts \
  src/shell/coreutils/text.test.ts src/shell/coreutils/index.ts src/shell/registry.ts
git commit -m "feat(shell): cut, tr, uniq coreutils (subset)"
```

---
## Task 2: 코어유틸 — `sed` (서브셋)

**Files:**
- Create: `src/shell/coreutils/sed.ts`
- Modify: `src/shell/coreutils/index.ts`, `src/shell/registry.ts` (`'sed'` 제거), `src/shell/coreutils/text.test.ts` (sed describe 블록 추가)

**Interfaces:**
- Consumes: `readSources`, `toLines`, `parseFlags`; `CommandFn`.
- Produces: `coreutils.sed`.

**서브셋 계약 (주석에 명기, 범위 밖은 `flashshell:`로 거부):**
- 스크립트는 **단일 명령** 하나. `-e`나 `;`로 여러 명령을 잇는 건 미지원.
- `s/re/repl/[g]` — 치환. 구분자는 `s` 다음 글자(보통 `/`). `repl`에서 `&`는 매치 전체, `\1`..`\9`는 캡처 그룹, `\&`는 리터럴 `&`. `g` 없으면 줄당 첫 매치만.
- `-n` + `p` — 매칭 인쇄 억제 모드. `Np`(N번째 줄), `/re/p`(정규식 매치 줄), 또는 `p`(모든 줄, `-n`과 함께면 각 줄 한 번 더).
- `Nd` / `/re/d` — 삭제. `re`는 grep과 같은 ERE-ish JS RegExp.
- 파일 인자 여럿 또는 stdin.

기대값은 GNU(`debian:stable-slim`) 실측:
- `sed 's/hello/hi/g'` on `hello world\nhello there\ngoodbye\n` → `hi world\nhi there\ngoodbye\n`
- `echo "a a a" | sed 's/a/b/'` → `b a a\n` (첫 매치만)
- `sed -n 2p` → 2번째 줄만
- `sed 2d` → 2번째 줄만 제거
- `sed /hello/d` → hello 든 줄 제거
- `sed -n /good/p` → good 든 줄만

- [ ] **Step 1: 실패하는 테스트 (text.test.ts 에 추가)**

```ts
describe('sed', () => {
  beforeEach(() => { fs.writeFile('/w/t.txt', 'hello world\nhello there\ngoodbye\n') })
  it('s///g 전역 치환', async () => {
    expect(await out("sed 's/hello/hi/g' t.txt")).toBe('hi world\nhi there\ngoodbye\n')
  })
  it('s/// 는 g 없으면 첫 매치만', async () => {
    expect(await out("echo 'a a a' | sed 's/a/b/'")).toBe('b a a\n')
  })
  it('& 는 매치 전체', async () => {
    expect(await out("echo abc | sed 's/b/[&]/'")).toBe('a[b]c\n')
  })
  it('-n Np 로 한 줄', async () => { expect(await out('sed -n 2p t.txt')).toBe('hello there\n') })
  it('Nd 로 한 줄 삭제', async () => { expect(await out('sed 2d t.txt')).toBe('hello world\ngoodbye\n') })
  it('/re/d 로 정규식 삭제', async () => { expect(await out('sed /hello/d t.txt')).toBe('goodbye\n') })
  it('-n /re/p 로 정규식 인쇄', async () => { expect(await out('sed -n /good/p t.txt')).toBe('goodbye\n') })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run --project shell src/shell/coreutils/text.test.ts` → FAIL.

- [ ] **Step 3: `sed.ts` 구현**

```ts
// src/shell/coreutils/sed.ts
//
// 서브셋: 단일 명령 스크립트. s/re/repl/[g], -n+p (Np, /re/p, p), Nd, /re/d.
// -e / ; 로 여러 명령 잇기, hold space, 그 밖의 sed 언어 전체는 미지원.
import type { CommandFn } from '../types'
import { parseFlags, readSources, toLines } from './shared'

type Op =
  | { kind: 'subst'; re: RegExp; repl: string; global: boolean }
  | { kind: 'print'; addr: Addr }
  | { kind: 'delete'; addr: Addr }
type Addr = { kind: 'line'; n: number } | { kind: 're'; re: RegExp } | { kind: 'all' }

/** sed repl 의 &, \N, \& 를 JS String.replace 의 $&, $N, & 로 옮긴다. */
function toJsReplacement(repl: string): string {
  let out = ''
  for (let i = 0; i < repl.length; i++) {
    const ch = repl[i]!
    if (ch === '\\') {
      const next = repl[i + 1]
      if (next === '&') { out += '&'; i++ }        // \& → 리터럴 &
      else if (next && /[1-9]/.test(next)) { out += `$${next}`; i++ } // \1 → $1
      else if (next === 'n') { out += '\n'; i++ }
      else if (next === '\\') { out += '\\'; i++ }
      else out += '\\'
    } else if (ch === '&') out += '$&'             // & → 매치 전체
    else if (ch === '$') out += '$$'               // 리터럴 $ 보호
    else out += ch
  }
  return out
}

function parseScript(script: string): Op | { error: string } {
  // s/re/repl/flags
  if (script.startsWith('s') && script.length > 1) {
    const delim = script[1]!
    const parts: string[] = ['']
    for (let i = 2; i < script.length; i++) {
      if (script[i] === '\\' && script[i + 1] === delim) { parts[parts.length - 1] += delim; i++; continue }
      if (script[i] === delim) { parts.push(''); continue }
      parts[parts.length - 1] += script[i]!
    }
    if (parts.length < 3) return { error: `unterminated \`s' command` }
    const [pattern, repl, flags] = [parts[0]!, parts[1]!, parts[2] ?? '']
    let re: RegExp
    try { re = new RegExp(pattern, flags.includes('g') ? 'g' : '') } catch { return { error: `invalid regex` } }
    return { kind: 'subst', re, repl: toJsReplacement(repl), global: flags.includes('g') }
  }
  // Np / Nd
  const numMatch = /^(\d+)([pd])$/.exec(script)
  if (numMatch) {
    const addr: Addr = { kind: 'line', n: Number(numMatch[1]) }
    return numMatch[2] === 'p' ? { kind: 'print', addr } : { kind: 'delete', addr }
  }
  // /re/p , /re/d
  const reMatch = /^\/(.*)\/([pd])$/.exec(script)
  if (reMatch) {
    let re: RegExp
    try { re = new RegExp(reMatch[1]!) } catch { return { error: `invalid regex` } }
    const addr: Addr = { kind: 're', re }
    return reMatch[2] === 'p' ? { kind: 'print', addr } : { kind: 'delete', addr }
  }
  // 벌거벗은 p / d
  if (script === 'p') return { kind: 'print', addr: { kind: 'all' } }
  if (script === 'd') return { kind: 'delete', addr: { kind: 'all' } }
  return { error: `flashshell: sed: 이 환경이 지원하지 않는 스크립트입니다: ${script}` }
}

function addrMatches(addr: Addr, line: string, lineNo: number): boolean {
  if (addr.kind === 'all') return true
  if (addr.kind === 'line') return lineNo === addr.n
  return addr.re.test(line)
}

export const sed: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)
  const quiet = flags.has('n')
  const script = rest[0]
  if (script === undefined) return { stdout: '', stderr: 'sed: no script\n', exitCode: 1 }

  const op = parseScript(script)
  if ('error' in op) {
    const msg = op.error.startsWith('flashshell:') ? op.error : `sed: -e expression #1, char 0: ${op.error}`
    return { stdout: '', stderr: `${msg}\n`, exitCode: op.error.startsWith('flashshell:') ? 127 : 1 }
  }

  const { sources, stderr, failed } = readSources(e, rest.slice(1))
  let stdout = ''
  let lineNo = 0
  for (const source of sources) {
    for (const line of toLines(source.text)) {
      lineNo++
      if (op.kind === 'subst') {
        const replaced = line.replace(op.re, op.repl)
        if (!quiet) stdout += `${replaced}\n`
      } else if (op.kind === 'delete') {
        if (!addrMatches(op.addr, line, lineNo)) stdout += `${line}\n`
      } else {
        // print
        if (!quiet) stdout += `${line}\n`
        if (addrMatches(op.addr, line, lineNo)) stdout += `${line}\n`
      }
    }
  }
  return { stdout, stderr, exitCode: failed ? 1 : 0 }
}
```

`p` 명령의 이중 출력 주의: `-n` 없이 `sed -n ... p` 가 아닌 `sed 'p'`는 각 줄을 두 번 낸다(자동 인쇄 + 명시 인쇄). `-n p`는 각 줄 한 번(자동 인쇄 억제 + 명시 인쇄). 위 코드가 그렇게 동작하는지 확인하고, 애매하면 Docker로 `sed 'p'`, `sed -n 'p'`, `sed -n '2p'`를 대조하라.

- [ ] **Step 4: 등록 + KNOWN_UNIMPLEMENTED 에서 `'sed'` 제거**
- [ ] **Step 5: 통과 확인** — `npx vitest run --project shell src/shell/coreutils/text.test.ts` → PASS.
- [ ] **Step 6: 커밋** — `git commit -m "feat(shell): sed coreutil (subset: s///, p, d with addresses)"`

---

## Task 3: 코어유틸 — `awk` (서브셋)

**Files:**
- Create: `src/shell/coreutils/awk.ts`
- Modify: `src/shell/coreutils/index.ts`, `src/shell/registry.ts` (`'awk'` 제거), `text.test.ts`

**서브셋 계약 (주석에 명기, 범위 밖은 `flashshell:`로 거부):**
- 프로그램은 `[BEGIN{...}] [/re/ | 조건] {action} [END{...}]` 형태의 규칙들. action은 세미콜론으로 나뉜 문장들.
- 지원 변수: `$0`(줄 전체), `$1`..`$NF`(필드), `NR`(줄 번호), `NF`(필드 수). `-F SEP`로 필드 구분자 지정(기본: 공백 분할).
- 지원 문장: `print` / `print EXPR, EXPR, ...`(콤마는 OFS=공백으로 join), `VAR += EXPR` / `VAR = EXPR`(숫자 누적 변수).
- 지원 조건: `/re/`(줄 매치), `EXPR OP EXPR`(비교: `> < >= <= == !=`), 없으면 모든 줄.
- 지원 EXPR: 필드(`$N`), 숫자 리터럴, 문자열 리터럴(`"..."`), 변수, `+`/`-`/`*` 이항, 필드/변수 비교.
- **미지원**: 사용자 함수, `for`/`while`/`if` 제어문, 배열, `printf`, `getline`, 정규식 함수. 이런 게 나오면 `flashshell:`로 거부.

기대값은 GNU 실측(위 Docker 참고): `awk '{print $1}'`, `awk '{print NR, NF}'`, `awk -F: '{print $2}'`, `awk '/bob/{print $2}'`, `awk '{s+=$2} END{print s}'`, `awk 'BEGIN{print "start"} {print $1}'`, `awk '$2>28{print $1}'`.

이 태스크는 이 계획에서 **가장 크고 위험하다.** 미니 인터프리터(토크나이저 → 규칙 파서 → 실행기)를 짜야 한다. 서브셋을 좁게 지키고, 각 기능마다 Docker로 대조하라. 파서가 지원 못 하는 구문을 만나면 조용히 틀린 답을 내지 말고 반드시 `flashshell:`로 거부해야 한다 — 조용한 오답이 최악이다.

- [ ] **Step 1: 실패하는 테스트 (text.test.ts 에 추가)**

```ts
describe('awk', () => {
  beforeEach(() => { fs.writeFile('/w/p.txt', 'alice 30\nbob 25\ncarol 35\n') })
  it('필드 인쇄', async () => { expect(await out("awk '{print $1}' p.txt")).toBe('alice\nbob\ncarol\n') })
  it('NR NF', async () => { expect(await out("awk '{print NR, NF}' p.txt")).toBe('1 2\n2 2\n3 2\n') })
  it('-F 구분자', async () => { expect(await out("echo a:b:c | awk -F: '{print $2}'")).toBe('b\n') })
  it('정규식 규칙', async () => { expect(await out("awk '/bob/{print $2}' p.txt")).toBe('25\n') })
  it('누적 + END', async () => { expect(await out("awk '{s+=$2} END{print s}' p.txt")).toBe('90\n') })
  it('BEGIN', async () => { expect(await out("awk 'BEGIN{print \"start\"} {print $1}' p.txt")).toBe('start\nalice\nbob\ncarol\n') })
  it('숫자 비교 조건', async () => { expect(await out("awk '$2>28{print $1}' p.txt")).toBe('alice\ncarol\n') })
  it('미지원 구문은 flashshell 로 거부', async () => {
    const r = await run("awk '{for(i=0;i<3;i++)print}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: `awk.ts` 구현.** 구조: (1) 프로그램 문자열을 `BEGIN{}`/`END{}`/`패턴{action}` 규칙 배열로 파싱. (2) 각 입력 줄을 `-F`(기본 공백 연속)로 필드 분할, `NR`/`NF` 갱신. (3) 각 규칙의 패턴을 평가(정규식 또는 비교식 또는 항상), 참이면 action 실행. (4) action 문장: `print`(콤마 리스트를 OFS로 join), `VAR (+=|=) EXPR`. (5) EXPR 평가기: 필드 `$N`, `NR`/`NF`, 숫자/문자열 리터럴, 변수, `+ - *`, 비교. **완전한 구현 코드는 실행 시 TDD로 도출한다** — 이 미니 인터프리터는 계획에 통째로 박기엔 너무 크고, M1의 교훈대로 "적힌 코드는 가설"이다. 다음을 지켜라:
  - 토크나이저부터 TDD로. 각 지원 기능(필드, NR/NF, -F, /re/, 비교, 누적, BEGIN/END, print 콤마)마다 위 테스트 하나씩을 초록으로.
  - 파서가 인식 못 하는 토큰/문장(`for`, `while`, `if`, `[`, `printf`, `function`, `getline`)을 만나면 `flashshell: awk: 이 환경이 지원하지 않는 구문입니다: <조각>` 를 exit 2로 던지고, 절대 부분 실행하지 않는다.
  - 숫자 문맥에서 문자열→숫자 변환은 bash awk 규칙(선행 숫자 파싱, 아니면 0). Docker로 `awk '{s+=$1} END{print s}'`를 숫자 아닌 필드에 대조.
  - `print` 인자 없으면 `$0`. `print a, b`는 OFS(기본 " ")로 join하고 ORS(기본 "\n") 붙임.

- [ ] **Step 4: 등록 + KNOWN_UNIMPLEMENTED 에서 `'awk'` 제거.**
- [ ] **Step 5: 통과 확인.** 8개 awk 테스트 전부 초록. 그리고 Docker로 최소 5개 케이스를 재확인(리포트에 명령·출력 첨부).
- [ ] **Step 6: 커밋** — `git commit -m "feat(shell): awk coreutil (subset: fields, NR/NF, patterns, BEGIN/END, accumulation)"`

**리뷰 주의:** 이 태스크의 리뷰어는 반드시 (a) 지원 범위 안 기능이 Docker와 일치하는지, (b) 범위 밖 구문이 조용한 오답 없이 `flashshell:`로 거부되는지 — 둘 다 실행으로 확인해야 한다. awk는 조용한 오답이 나기 가장 쉬운 곳이다.

---
## Task 4: 코어유틸 — `find` `xargs`

**Files:**
- Create: `src/shell/coreutils/find.ts`, `xargs.ts`, `src/shell/coreutils/system.test.ts`
- Modify: `src/shell/coreutils/index.ts`, `src/shell/registry.ts` (`'find'` `'xargs'` 제거)

**서브셋 계약:**
- `find [PATH...] [-name GLOB] [-type f|d] [-exec CMD {} ;]` — 기본 경로 `.`. `-name`은 basename 글롭 매치(기존 `matchSegment` 재사용). `-type f`(파일)/`d`(디렉터리). `-exec CMD {} ;`는 매치마다 `{}`를 경로로 치환해 명령 실행(세미콜론은 렉서에서 `;`로 토큰화되므로 셸에서 `\;`로 이스케이프해 전달됨 → argv에 `;` 하나로 들어온다).
- **출력 순서 divergence (문서화):** GNU find는 readdir 순서(임의)로 낸다. 우리 VFS `readdir`는 바이트 정렬이므로 우리 find는 **바이트 정렬된 깊이우선** 순서(결정적)로 낸다. 골든 케이스는 순서가 걸리면 `find ... | sort`로 감싼다. 문제의 check는 find의 stdout 순서에 절대 의존하지 않는다(fs를 읽는다). ls의 "항상 한 줄에 하나"와 같은 종류의 수용된 divergence.
- `xargs [-I REPL] [CMD [ARG...]]` — stdin의 각 토큰(공백/개행 분할)을 CMD의 인자로 이어붙여 실행. CMD 생략 시 기본 `echo`. `-I REPL`이면 각 입력 줄마다 CMD를 한 번씩 돌리고 `REPL`을 그 줄로 치환.

기대값은 GNU 실측(위 Docker 참고): `find . -name "*.txt"`, `find . -type f`, `find . -type d`, `find | xargs wc -l`, `xargs -I {} echo "got {}"`.

`-exec`와 `xargs`가 명령을 실행하려면 `CommandFn` 안에서 다른 명령을 부를 수 있어야 한다. `CommandEnv`에는 인터프리터가 없다. **해법:** 두 코어유틸은 `interpreter.ts`의 `run()`을 부르지 않는다 — 대신 `e.fs`/`e.state`를 그대로 넘겨 새 `createShell`을 만들지도 않는다. 가장 단순하고 격리를 지키는 길은 `find -exec`/`xargs`가 **인터프리터를 통해 재실행**하는 것이므로, `CommandEnv`에 선택적 `runLine?(line: string): Promise<ExecResult>` 콜백을 추가해 인터프리터가 주입한다. (M1의 `runSubshell` 주입 패턴과 같은 결.)

- [ ] **Step 1: `CommandEnv`에 `runLine` 주입 배선**

`src/shell/types.ts`의 `CommandEnv`에 추가:
```ts
  /**
   * 이 명령이 다른 명령줄을 실행해야 할 때(find -exec, xargs) 쓰는 콜백.
   * 인터프리터가 주입한다. 같은 fs/state/budget 위에서 돈다.
   * exec()가 절대 reject 안 하듯 이 콜백도 ExecResult 를 resolve 한다.
   */
  runLine?: (line: string) => Promise<ExecResult>
```

`src/shell/interpreter.ts`의 `runCommand`에서 `cmdEnv`를 만들 때 `runLine`을 채운다. 같은 `ctx`(fs/state/budget 공유)에서 파싱·실행하되 서브셸처럼 cwd/env 격리는 하지 않는다(find -exec는 부모 셸 상태에서 돈다 — 단, 각 exec 호출도 `spend(ctx)`를 태워 무한 방어에 포함되게):
```ts
    runLine: async (line: string): Promise<ExecResult> => {
      try { return await runList(parse(line), ctx) }
      catch (e) {
        if (e instanceof ExecutionLimitError) throw e
        return { stdout: '', stderr: `bash: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 2 }
      }
    },
```
기존 `runCommand`/`runList` 테스트(interpreter.test.ts)가 전부 초록인지 확인 — `runLine` 추가는 순수 확장이라 깨질 게 없어야 한다.

- [ ] **Step 2: 실패하는 테스트 (system.test.ts)**

```ts
// src/shell/coreutils/system.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createShell, VFS } from '../index'
import type { Shell } from '../types'

let fs: VFS
let sh: Shell
beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/w/sub', { recursive: true })
  fs.writeFile('/w/a.txt', 'a\n')
  fs.writeFile('/w/b.log', 'bb\n')
  fs.writeFile('/w/sub/c.txt', 'ccc\n')
  fs.writeFile('/w/sub/d.log', 'd\n')
  sh = createShell({ fs, cwd: '/w', home: '/w' })
})
const out = async (line: string) => (await sh.exec(line)).stdout

describe('find', () => {
  it('-name 글롭 (정렬해서 대조)', async () => {
    expect(await out('find . -name "*.txt" | sort')).toBe('./a.txt\n./sub/c.txt\n')
  })
  it('-type f', async () => {
    expect(await out('find . -type f | sort')).toBe('./a.txt\n./b.log\n./sub/c.txt\n./sub/d.log\n')
  })
  it('-type d', async () => { expect(await out('find . -type d | sort')).toBe('.\n./sub\n') })
  it('경로 인자', async () => { expect(await out('find sub | sort')).toBe('sub\nsub/c.txt\nsub/d.log\n') })
  it('-exec 로 매치마다 실행', async () => {
    await sh.exec('find . -name "*.log" -exec rm {} \;')
    expect(fs.exists('/w/b.log')).toBe(false)
    expect(fs.exists('/w/sub/d.log')).toBe(false)
    expect(fs.exists('/w/a.txt')).toBe(true)
  })
})

describe('xargs', () => {
  it('stdin 토큰을 명령 인자로', async () => {
    expect(await out('find . -name "*.txt" | sort | xargs wc -l')).toBe('1 ./a.txt\n1 ./sub/c.txt\n2 total\n')
  })
  it('-I 로 줄마다 치환 실행', async () => {
    expect(await out('find . -name "*.txt" | sort | xargs -I {} echo got {}')).toBe('got ./a.txt\ngot ./sub/c.txt\n')
  })
})
```

- [ ] **Step 3: `find.ts` 구현**

```ts
// src/shell/coreutils/find.ts
import type { CommandFn, ExecResult } from '../types'
import { matchSegment } from '../glob'

export const find: CommandFn = async (e) => {
  // 인자를 경로들과 술어(predicate)들로 가른다.
  const paths: string[] = []
  let nameGlob: string | undefined
  let typeFilter: 'f' | 'd' | undefined
  let execCmd: string[] | undefined
  const args = e.args
  let i = 0
  // 선행 경로 인자(대시로 시작 안 하는 것들)
  while (i < args.length && !args[i]!.startsWith('-')) { paths.push(args[i]!); i++ }
  for (; i < args.length; i++) {
    const a = args[i]!
    if (a === '-name') { nameGlob = args[++i]; }
    else if (a === '-type') { const t = args[++i]; if (t === 'f' || t === 'd') typeFilter = t }
    else if (a === '-exec') {
      execCmd = []
      i++
      while (i < args.length && args[i] !== ';') { execCmd.push(args[i]!); i++ }
    }
    else return { stdout: '', stderr: `flashshell: find: 지원하지 않는 술어입니다: ${a}\n`, exitCode: 2 }
  }
  if (paths.length === 0) paths.push('.')

  const results: string[] = []
  const walk = (displayPath: string, absPath: string) => {
    const node = e.fs.lstat(absPath)
    if (!node) return
    const isDir = node.kind === 'dir'
    const base = displayPath === '.' ? '.' : displayPath.split('/').filter(Boolean).pop() ?? displayPath
    const nameOk = nameGlob === undefined || matchSegment(nameGlob, base === '.' ? absPath.split('/').pop()! : base)
    const typeOk = typeFilter === undefined || (typeFilter === 'd' ? isDir : node.kind === 'file')
    if (nameOk && typeOk) results.push(displayPath)
    if (isDir) {
      for (const child of e.fs.readdir(absPath)) {
        const childDisplay = displayPath === '/' ? `/${child}` : `${displayPath}/${child}`
        walk(childDisplay, `${absPath === '/' ? '' : absPath}/${child}`)
      }
    }
  }
  for (const p of paths) walk(p, e.fs.resolve(p, e.state.cwd))

  if (!execCmd) return { stdout: results.map((r) => `${r}\n`).join(''), stderr: '', exitCode: 0 }

  // -exec: 매치마다 {} 치환 후 실행.
  if (!e.runLine) return { stdout: '', stderr: 'find: -exec unavailable\n', exitCode: 1 }
  let stdout = '', stderr = '', exitCode = 0
  for (const match of results) {
    const line = execCmd.map((tok) => (tok === '{}' ? match : tok)).join(' ')
    const r: ExecResult = await e.runLine(line)
    stdout += r.stdout; stderr += r.stderr
    if (r.exitCode !== 0) exitCode = 1
  }
  return { stdout, stderr, exitCode }
}
```

`-name`의 base 계산이 `.` 케이스에서 어색하다 — 실행 시 TDD로 다듬어라. GNU는 `-name`을 경로의 basename에 매친다. `.` 자신의 basename은 `.`이고, `*.txt`는 `.`에 매치 안 된다. Docker로 `find . -name "*"` 등 경계를 확인.

- [ ] **Step 4: `xargs.ts` 구현**

```ts
// src/shell/coreutils/xargs.ts
import type { CommandFn, ExecResult } from '../types'

export const xargs: CommandFn = async (e) => {
  if (!e.runLine) return { stdout: '', stderr: 'xargs: unavailable\n', exitCode: 1 }
  const args = [...e.args]
  let replace: string | undefined
  if (args[0] === '-I') { replace = args[1]; args.splice(0, 2) }
  const cmd = args.length > 0 ? args : ['echo']

  const tokens = e.stdin.split(/\s+/).filter((t) => t !== '')
  const lines = e.stdin.split('\n').map((l) => l.trim()).filter((l) => l !== '')

  let stdout = '', stderr = '', exitCode = 0
  if (replace !== undefined) {
    // -I: 입력 줄마다 한 번, REPL 치환
    for (const inputLine of lines) {
      const line = cmd.map((tok) => tok.split(replace).join(inputLine)).join(' ')
      const r: ExecResult = await e.runLine(line)
      stdout += r.stdout; stderr += r.stderr; if (r.exitCode !== 0) exitCode = r.exitCode
    }
  } else {
    // 모든 토큰을 명령 뒤에 이어붙여 한 번 실행 (GNU는 ARG_MAX로 나누지만 게임 규모에선 무의미)
    const line = [...cmd, ...tokens].join(' ')
    const r: ExecResult = await e.runLine(line)
    stdout = r.stdout; stderr = r.stderr; exitCode = r.exitCode
  }
  return { stdout, stderr, exitCode }
}
```

- [ ] **Step 5: 등록 + KNOWN_UNIMPLEMENTED 에서 `'find'` `'xargs'` 제거.**
- [ ] **Step 6: 통과 확인** — `npx vitest run --project shell src/shell/coreutils/system.test.ts` + `src/shell/interpreter.test.ts`(runLine 추가로 안 깨졌는지) 초록.
- [ ] **Step 7: 커밋** — `git commit -m "feat(shell): find and xargs with -exec via injected runLine"`

---

## Task 5: 코어유틸 — `diff`

**Files:**
- Create: `src/shell/coreutils/diff.ts`
- Modify: `src/shell/coreutils/index.ts`, `src/shell/registry.ts` (`'diff'` 제거), `system.test.ts`

**서브셋 계약:**
- `diff [-q] FILE1 FILE2`. 종료 코드: 같으면 0, 다르면 1, 파일 못 열면 2.
- `-q`(brief): 다르면 `Files FILE1 and FILE2 differ\n`, 같으면 아무 출력 없음. **정확·검증 가능 — L4 문제는 이걸 쓴다.**
- 옵션 없는 기본: **노멀 포맷** best-effort (LCS 기반 `NcM`/`NaM`/`NdM` 훅, `< `/`> `/`---`). 이건 GNU와 바이트 일치가 어려우므로, 정직한 노력 후 일치가 안 되면 노멀 포맷을 미구현으로 두고 `-q`만 남긴 뒤 리포트에 명기하라. 골든 케이스와 L4 문제는 `-q`와 종료 코드만 의존한다.

- [ ] **Step 1: 실패하는 테스트 (system.test.ts 에 추가)**

```ts
describe('diff', () => {
  beforeEach(() => {
    fs.writeFile('/w/x.txt', 'one\ntwo\nthree\n')
    fs.writeFile('/w/y.txt', 'one\n2\nthree\n')
    fs.writeFile('/w/z.txt', 'one\ntwo\nthree\n')
  })
  it('같으면 exit 0, 출력 없음', async () => {
    const r = await sh.exec('diff x.txt z.txt'); expect(r.exitCode).toBe(0); expect(r.stdout).toBe(''); expect(r.stderr).toBe('')
  })
  it('-q 다르면 differ 한 줄, exit 1', async () => {
    const r = await sh.exec('diff -q x.txt y.txt')
    expect(r.exitCode).toBe(1); expect(r.stdout).toBe('Files x.txt and y.txt differ\n')
  })
  it('-q 같으면 출력 없음 exit 0', async () => {
    const r = await sh.exec('diff -q x.txt z.txt'); expect(r.exitCode).toBe(0); expect(r.stdout).toBe('')
  })
  it('파일 없으면 exit 2', async () => {
    const r = await sh.exec('diff x.txt nope.txt'); expect(r.exitCode).toBe(2); expect(r.stderr).toContain('diff')
  })
})
```

- [ ] **Step 2~5:** `diff.ts` 구현(두 파일을 `readFile`, 문자열 비교로 `-q`/종료 코드; 노멀 포맷은 위 계약대로 best-effort), 등록, KNOWN_UNIMPLEMENTED 정리, 통과 확인.
- [ ] **Step 6: 커밋** — `git commit -m "feat(shell): diff coreutil (-q brief + normal-format best-effort)"`

---

## Task 6: 새 코어유틸 골든 케이스

**Files:**
- Modify: `tests/shell/golden/seed.sh`, `tests/shell/golden.test.ts`의 `seedVfs()` (텍스트/시스템 픽스처 추가 — 둘을 **바이트 동일**하게 유지)
- Create: `tests/shell/golden/cases/14-cut-tr-uniq.sh`, `15-sed.sh`, `16-awk.sh`, `17-find-xargs.sh`, `18-diff.sh`
- Modify(생성): `tests/shell/golden/expected/14..18-*.txt` (`npm run golden`으로 생성, 커밋됨)

M1의 골든 하네스를 그대로 쓴다: `seed.sh`(진짜 bash)와 `seedVfs()`(우리 셸)가 같은 초기 상태를 만들고, 케이스 파일의 각 줄을 순서대로 실행해 stdout/stderr/exit를 대조. 규칙: `ls`는 `-1`, `grep`은 리터럴/ERE만, **셸 레벨 에러(`command not found`, `syntax error`) 유발 금지**(bash가 스크립트명+줄번호를 접두사로 붙여 대조 불가). find는 순서가 걸리면 `| sort`로 감싼다.

- [ ] **Step 1:** `seed.sh`와 `seedVfs()`에 텍스트/시스템 픽스처를 **동일하게** 추가 — `pairs.txt`(`alice 30\nbob 25\ncarol 35\n`), `colon.txt`(`a:b:c\nd:e:f\n`), `adj.txt`(`a\na\nb\nc\nc\n`), `tree/`(하위 파일 몇 개). seed.sh는 `printf`로, seedVfs는 `fs.writeFile`로. `od -c`로 두 쪽 바이트 일치 확인.
- [ ] **Step 2:** 다섯 케이스 파일 작성 — 각 코어유틸의 서브셋 안 대표 사용을 담되, 위 규칙을 지킨다. 예: `16-awk.sh`는 `awk '{print $1}' pairs.txt`, `awk '{s+=$2} END{print s}' pairs.txt` 등.
- [ ] **Step 3:** `npm run golden`으로 `.expected` 생성. 각 파일을 눈으로 확인. `npm run golden` 두 번 → 바이트 동일(결정성).
- [ ] **Step 4:** `npx vitest run --project shell tests/shell/golden.test.ts` → 새 5개 포함 전부 초록. 빨간불이면 우리 코어유틸이 GNU와 다른 것이니 **코어유틸을 고친다**(케이스를 무르지 않는다).
- [ ] **Step 5: 커밋** — `git commit -m "test(shell): golden cases for cut/tr/uniq/sed/awk/find/xargs/diff"`

**M1의 골든 실패 원인 재확인:** 생성 스크립트가 `out=$(...)`로 stdout 후행 개행을 삼키지 않는지(파일 리다이렉트로 잡아야 함). M1 Task 12에서 이걸로 9개가 처음 빨간불이었다.

---
## Task 7: `ShellSession` 인터페이스 + `LocalShellSession`

**Files:**
- Create: `src/ui/session.ts`, `src/ui/session.test.ts`

**왜 이 경계가 필요한가.** 지금 스토어는 `shell.fs`/`shell.cwd`를 **동기로** 읽는다(`completions`, `prompt`, `check`). 셸을 워커로 옮기면 그 동기 읽기가 전부 깨진다. 그래서 셸-쪽 접근을 하나의 **비동기 인터페이스** 뒤로 옮긴다. 인프로세스 구현(`LocalShellSession`)은 Node/jsdom에서 직접 테스트하고, 워커 구현(Task 8)은 e2e로만 검증한다. 스토어(Task 9)는 인터페이스만 알고, 매 exec 응답에 실려 오는 스냅샷(cwd, cwd 목록, env, solved)을 미러링해 동기 `completions`/`prompt`를 유지한다.

**Interfaces (이 파일이 확정한다):**

```ts
// src/ui/session.ts
import type { Shell } from '../shell/types'
import { allProblems } from '../game/problems/index'
import { createShellForProblem, PLAYER_HOME } from '../game/harness'
import type { Problem } from '../game/types'

export interface StateSnapshot {
  cwd: string
  cwdEntries: string[]                 // readdir(cwd) 정렬. Tab 자동완성용.
  env: Record<string, string>
}
export interface ExecResponse {
  stdout: string
  stderr: string
  exitCode: number
  snapshot: StateSnapshot
  solved: boolean
}
/** 스토어가 셸과 대화하는 유일한 통로. 전부 비동기. */
export interface ShellSession {
  start(problemId: string): Promise<StateSnapshot>   // 문제의 셸을 짓고 초기 스냅샷 반환
  exec(line: string): Promise<ExecResponse>          // 실행 + check + 스냅샷
  reset(): Promise<StateSnapshot>                    // 현재 문제 셸 재생성
  dispose(): void
}

const EMPTY_SNAPSHOT: StateSnapshot = { cwd: PLAYER_HOME, cwdEntries: [], env: {} }

/** 인프로세스 구현. Node/jsdom 테스트와, 워커 안(Task 8)에서 공용. */
export class LocalShellSession implements ShellSession {
  private shell: Shell | null = null
  private problem: Problem | null = null
  private history: string[] = []

  async start(problemId: string): Promise<StateSnapshot> {
    this.problem = allProblems.find((p) => p.id === problemId) ?? null
    this.history = []
    this.shell = this.problem ? createShellForProblem(this.problem) : null
    return this.snapshot()
  }

  async exec(line: string): Promise<ExecResponse> {
    if (!this.shell || !this.problem) {
      return { stdout: '', stderr: '', exitCode: 0, snapshot: this.snapshot(), solved: false }
    }
    const result = await this.shell.exec(line)
    this.history.push(line)
    let solved = false
    try {
      solved = this.problem.check({ fs: this.shell.fs, lastResult: result, history: this.history, cwd: this.shell.cwd })
    } catch (error) {
      // 출제자의 버그가 플레이어의 크래시가 되어서는 안 된다.
      console.warn(`check() threw for ${this.problem.id}`, error)
    }
    return { ...result, snapshot: this.snapshot(), solved }
  }

  async reset(): Promise<StateSnapshot> {
    if (this.problem) { this.shell = createShellForProblem(this.problem); this.history = [] }
    return this.snapshot()
  }

  dispose(): void {}

  private snapshot(): StateSnapshot {
    if (!this.shell) return EMPTY_SNAPSHOT
    let cwdEntries: string[] = []
    try { cwdEntries = this.shell.fs.readdir(this.shell.cwd) } catch { cwdEntries = [] }
    return { cwd: this.shell.cwd, cwdEntries, env: { ...this.shell.env } }
  }
}
```

- [ ] **Step 1: 실패하는 테스트 (session.test.ts, node 프로젝트)**

`vitest.config.ts`의 `shell` 프로젝트 include 에 `src/ui/session.test.ts`를 추가한다(순수 로직, React 무관 — store.test.ts와 같은 취급).

```ts
// src/ui/session.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalShellSession } from './session'

let s: LocalShellSession
beforeEach(() => { s = new LocalShellSession() })

describe('LocalShellSession', () => {
  it('start 는 초기 스냅샷을 준다 (cwd=~, 엔트리 목록)', async () => {
    const snap = await s.start('l1-01')
    expect(snap.cwd).toBe('/home/player')
    expect(snap.cwdEntries).toContain('readme.txt')
  })
  it('정답 exec 는 solved=true 와 갱신된 스냅샷', async () => {
    await s.start('l1-01')
    const r = await s.exec('cat readme.txt')
    expect(r.solved).toBe(true)
    expect(r.stdout).toBe('ACCESS GRANTED\n')
  })
  it('오답 exec 는 solved=false', async () => {
    await s.start('l1-01')
    expect((await s.exec('ls')).solved).toBe(false)
  })
  it('cd 후 스냅샷의 cwd/entries 가 따라온다', async () => {
    await s.start('l1-03')            // vault 로 cd 하는 문제
    const r = await s.exec('cd vault')
    expect(r.snapshot.cwd).toBe('/home/player/vault')
  })
  it('reset 은 rm -rf 이후에도 복구', async () => {
    await s.start('l1-01')
    await s.exec('rm -rf readme.txt')
    const snap = await s.reset()
    expect(snap.cwdEntries).toContain('readme.txt')
  })
  it('check 가 던져도 exec 는 죽지 않는다 (solved=false)', async () => {
    // allProblems 중 하나로 start 후, rm -rf 로 fs 를 비워도 exec 가 resolve 하는지
    await s.start('l1-10')
    const r = await s.exec('rm -rf *')
    expect(r).toHaveProperty('solved')
  })
})
```

- [ ] **Step 2~5:** 실패 확인 → `session.ts` 구현(위) → 통과 확인 → 커밋 `feat(ui): ShellSession interface and in-process LocalShellSession`.

---

## Task 8: `shell.worker.ts` + `WorkerShellSession` (데드라인 + terminate + 리플레이)

**Files:**
- Create: `src/ui/shell.worker.ts`, `src/ui/worker-session.ts`
- Modify: `docs/M2-SEAMS.md` (grep ReDoS 항목을 "해결됨"으로)

**핵심.** 셸을 워커 스레드에서 돌린다. 폭주하는 동기 루프(grep ReDoS, 그리고 Part 2의 미래 반복문)를 JS에서 중간에 끊을 방법은 워커를 `terminate()`하는 것뿐이다. 메인 스레드는 exec마다 wall-clock 데드라인 타이머를 걸고, 데드라인 안에 응답이 없으면 워커를 죽이고, 새 워커를 띄워 **명령 히스토리를 리플레이**해 상태를 복원한 뒤, 폭주한 그 명령을 exit 130으로 보고한다.

- [ ] **Step 1: 워커 엔트리**

```ts
// src/ui/shell.worker.ts
// 이 파일은 워커 스레드에서 돈다. src/ui 의 다른 것은 절대 import 하지 않는다.
// src/shell 과 src/game 은 순수하므로 워커 번들에 안전하게 들어간다.
import { LocalShellSession } from './session'

type Req =
  | { type: 'start'; id: number; problemId: string }
  | { type: 'exec'; id: number; line: string }
  | { type: 'reset'; id: number }

const session = new LocalShellSession()

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data
  if (req.type === 'start') {
    const snapshot = await session.start(req.problemId)
    self.postMessage({ id: req.id, snapshot })
  } else if (req.type === 'exec') {
    const response = await session.exec(req.line)
    self.postMessage({ id: req.id, response })
  } else {
    const snapshot = await session.reset()
    self.postMessage({ id: req.id, snapshot })
  }
}
```

`session.ts`가 `console.warn`을 쓰는데 워커에도 `console`이 있으므로 안전하다. `LocalShellSession`이 `src/ui`의 브라우저 API를 안 쓰는지 확인(안 쓴다 — allProblems/harness/shell만).

- [ ] **Step 2: `WorkerShellSession`**

```ts
// src/ui/worker-session.ts
import type { ShellSession, StateSnapshot, ExecResponse } from './session'

/** exec 하나가 이 시간(ms)을 넘기면 워커를 죽이고 리플레이로 복원한다. 게임 명령은
 * 1ms 미만, grep ReDoS 는 수 초 — 넉넉히 가른다. */
export const EXEC_DEADLINE_MS = 2000

const TIMEOUT_RESPONSE = (snapshot: StateSnapshot): ExecResponse => ({
  stdout: '',
  stderr: '^C  flashshell: 실행 한도 초과 — 무한 루프인가요?\n',
  exitCode: 130,
  snapshot,
  solved: false,
})

export class WorkerShellSession implements ShellSession {
  private worker: Worker
  private seq = 0
  private problemId: string | null = null
  private history: string[] = []
  private lastSnapshot: StateSnapshot = { cwd: '/home/player', cwdEntries: [], env: {} }

  constructor() { this.worker = this.spawn() }

  private spawn(): Worker {
    return new Worker(new URL('./shell.worker.ts', import.meta.url), { type: 'module' })
  }

  /** 워커에 한 요청을 보내고, deadline 안에 응답이 없으면 reject('timeout'). */
  private request<T>(msg: object, deadlineMs: number): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')) }, deadlineMs)
      const onMessage = (ev: MessageEvent) => {
        if (ev.data?.id !== id) return
        cleanup(); resolve(ev.data as T)
      }
      const cleanup = () => { clearTimeout(timer); this.worker.removeEventListener('message', onMessage) }
      this.worker.addEventListener('message', onMessage)
      this.worker.postMessage({ ...msg, id })
    })
  }

  async start(problemId: string): Promise<StateSnapshot> {
    this.problemId = problemId
    this.history = []
    const { snapshot } = await this.request<{ snapshot: StateSnapshot }>({ type: 'start', problemId }, EXEC_DEADLINE_MS)
    this.lastSnapshot = snapshot
    return snapshot
  }

  async exec(line: string): Promise<ExecResponse> {
    try {
      const { response } = await this.request<{ response: ExecResponse }>({ type: 'exec', line }, EXEC_DEADLINE_MS)
      this.history.push(line)
      this.lastSnapshot = response.snapshot
      return response
    } catch {
      // 데드라인 초과: 워커가 동기 루프에 갇혔다. 죽이고 새로 띄워 히스토리를 리플레이.
      await this.recover()
      return TIMEOUT_RESPONSE(this.lastSnapshot)
    }
  }

  /** 갇힌 워커를 죽이고 새 워커에 문제 시작 + 히스토리 리플레이. 폭주한 그 줄은 다시
   *  넣지 않는다(또 갇힌다). 리플레이 중 한 줄이 또 데드라인을 넘기면 거기서 멈춘다. */
  private async recover(): Promise<void> {
    this.worker.terminate()
    this.worker = this.spawn()
    if (this.problemId === null) return
    const { snapshot } = await this.request<{ snapshot: StateSnapshot }>(
      { type: 'start', problemId: this.problemId }, EXEC_DEADLINE_MS,
    )
    this.lastSnapshot = snapshot
    for (const line of this.history) {
      try {
        const { response } = await this.request<{ response: ExecResponse }>({ type: 'exec', line }, EXEC_DEADLINE_MS)
        this.lastSnapshot = response.snapshot
      } catch { break } // 리플레이가 또 갇히면 복원을 포기(가능한 데까지만).
    }
  }

  async reset(): Promise<StateSnapshot> {
    try {
      const { snapshot } = await this.request<{ snapshot: StateSnapshot }>({ type: 'reset' }, EXEC_DEADLINE_MS)
      this.history = []
      this.lastSnapshot = snapshot
      return snapshot
    } catch {
      await this.recover()
      return this.lastSnapshot
    }
  }

  dispose(): void { this.worker.terminate() }
}
```

- [ ] **Step 3: `docs/M2-SEAMS.md` 갱신** — grep ReDoS 항목을 "M2 Part 1에서 해결됨"으로 바꾸고, 남은 §1의 다른 부분(반복당 예산 = Part 2)은 유지.

- [ ] **Step 4:** 빌드가 통과하는지(`npm run build` — Vite가 워커 URL을 인식하는지) 확인. 이 두 파일은 node/jsdom 단위 테스트가 없다(실제 Worker 필요). Task 9의 e2e가 검증한다. 그래도 `WorkerShellSession`이 `ShellSession`을 만족하는지 타입 레벨에서 확인.

- [ ] **Step 5: 커밋** — `git commit -m "feat(ui): worker-backed ShellSession with wall-clock deadline and history-replay recovery"`

---

## Task 9: 스토어를 세션 뒤로 재배선 + store.test 재작성 + e2e

**Files:**
- Modify: `src/ui/store.ts`, `src/ui/store.test.ts`
- Create: `e2e/worker.spec.ts`

**스토어 변경.** `shell: Shell | null` 필드를 없애고 `session: ShellSession | null`과 미러 필드 `cwd: string`, `cwdEntries: string[]`, `env: Record<string,string>`를 둔다. `startProblem`/`resetProblem`/`submit`/`nextProblem`이 비동기가 된다(세션 메서드를 await). `completions`는 `cwdEntries` 미러를, `prompt`는 `cwd` 미러를 읽는다. `check` 결과는 응답의 `solved`에서 온다. 세션은 스토어 수명 동안 하나 만들어 재사용하되, **팩토리로 주입 가능**하게 해서 테스트가 `LocalShellSession`을, 브라우저가 `WorkerShellSession`을 쓰게 한다.

```ts
// store.ts 상단
import { LocalShellSession, type ShellSession, type StateSnapshot } from './session'
import { WorkerShellSession } from './worker-session'

let sessionFactory: () => ShellSession = () => new WorkerShellSession()
/** 테스트가 인프로세스 세션을 주입한다. */
export function setSessionFactory(make: () => ShellSession): void { sessionFactory = make }
```

`startProblem`(비동기)은: 세션이 없으면 `sessionFactory()`로 하나 만들고, `await session.start(id)`로 스냅샷을 받아 미러(`cwd`, `cwdEntries`, `env`)를 세팅. `submit`은 `await session.exec(trimmed)`로 `ExecResponse`를 받아 lines/signal/progress를 갱신하고 미러를 응답의 `snapshot`으로 갱신. `clear`/`reset`/빈 줄 처리는 그대로. `completions`/`prompt`는 미러 기반으로 재작성:

```ts
  completions: (partial) => {
    const names = commandNames().filter((n) => n.startsWith(partial))
    const files = get().cwdEntries.filter((n) => n.startsWith(partial))
    return [...new Set([...names, ...files])].sort()
  },
  prompt: () => {
    const cwd = get().cwd
    const shown = cwd === PLAYER_HOME ? '~'
      : cwd.startsWith(`${PLAYER_HOME}/`) ? `~${cwd.slice(PLAYER_HOME.length)}` : cwd
    return `player@flashshell:${shown}$ `
  },
```

`signalTick` 규약은 M1 그대로 유지(신호 쓸 때마다 증가). `submit`의 solved/wrong/idle 전이 로직도 그대로 — 단 `solved`는 `response.solved`, exit 코드는 `response.exitCode`.

- [ ] **Step 1: `store.test.ts` 재작성.** 이건 기존 테스트의 **약화가 아니라 비동기 경계로의 적응**이다. 스토어의 계약이 "동기 fs 접근"에서 "비동기 세션"으로 진짜 바뀌었기 때문이다. 규칙:
  - `beforeEach`에서 `setSessionFactory(() => new LocalShellSession())` + `localStorage.clear()` + `useGame.setState(useGame.getInitialState(), true)`.
  - M1 `store.test.ts`의 **모든 행동 단언을 보존**하되 async/await로 바꾼다. 반드시 남겨야 할 것: (a) 정답 명령 → status 'solved' + progress 기록, (b) 오답 → 'playing' 유지, (c) 실패 명령 → signal 'wrong', (d) 성공-비정답 → signal 'idle', (e) solved 이후 재판정 안 함, (f) stdout green/stderr amber 톤, (g) clear 는 화면만, (h) reset 은 rm -rf 복구, (i) 힌트 단계적, (j) prompt `~`/`~/vault`/`/home/playerX`, (k) completions 명령+파일 병합/정렬, (l) nextProblem 진행, (m) 레벨 마지막 → 레벨 선택.
  - 각 테스트는 `await` 한다. `startProblem`이 이제 Promise를 반환하므로 `await get().startProblem(...)`.
  - **어떤 단언도 값을 무르지 않는다.** 값이 안 맞으면 스토어 코드를 고친다.

- [ ] **Step 2: 실패 확인 → store.ts 구현 → 통과.** `npx vitest run --project shell src/ui/store.test.ts src/ui/session.test.ts` + `npx vitest run --project ui`. **jsdom엔 Worker가 없으므로, 스토어를 구동하는 모든 jsdom 테스트(`Play.test.tsx`, `signal.test.tsx`, 그리고 스토어를 통해 submit/startProblem을 부르는 그 밖의 UI 테스트)는 `beforeEach`에서 반드시 `setSessionFactory(() => new LocalShellSession())`를 호출해야 한다.** 안 하면 기본 팩토리가 `WorkerShellSession`을 만들어 jsdom에서 `new Worker(...)`로 죽는다. 이 주입을 안 넣어 빨간불이 나면 테스트를 무르지 말고 주입을 추가한다.

- [ ] **Step 3: e2e (`e2e/worker.spec.ts`)** — 진짜 브라우저(진짜 Worker)에서 세 가지를 본다:
  1. **워커 경로 정상:** `l1-01`을 `cat readme.txt`로 풀어 해설 시트가 뜬다.
  2. **grep ReDoS 무정지 + 복원.** 제어문 없이 파일을 지수로 키운다: `echo aaaaaaaaaa > x`(또는 readme를 재활용) 뒤 `cat x x > y`류 대신, 결정적으로는 `cp x x2; cat x x2 > x`를 몇 번 반복해 `x`를 수만 자로 키운다(각 반복이 길이를 배로). 충분히 크면(≈50K자) `grep '(a*)*$' x`(전부 `a`인 줄 + 앵커 → 매치 실패로 파국적 백트래킹)를 친다. 단언: (a) 이 명령 후 **탭이 얼지 않고**(Playwright가 다음 액션을 수행할 수 있고) 터미널에 `실행 한도 초과`(exit 130) 줄이 뜬다 — 워커 데드라인(`EXEC_DEADLINE_MS`)이 폭주 워커를 죽였다는 뜻; (b) **그 직후** `ls`나 `pwd`를 치면 정상 출력이 나온다 — 새 워커가 히스토리를 리플레이해 상태를 복원했다는 뜻(단, 폭주한 grep 줄은 리플레이에서 제외되므로 다시 얼지 않는다). 폭주 입력을 만드는 정확한 명령 수열은 구현 시 `EXEC_DEADLINE_MS`를 확실히 넘기도록 브라우저에서 조정한다(파일이 작아 데드라인을 안 넘기면 배가 반복을 더 늘린다).
  3. **기존 스모크 유지:** `e2e/smoke.spec.ts`의 두 테스트가 워커 경로로도 여전히 초록.
  - 참고: 진짜 grep ReDoS를 못 만들면(예: 브라우저에서 파일 키우기가 번거로우면), 대안으로 e2e 전용 훅 없이 **데드라인 자체를 낮춘 빌드**로 검증하지 말 것 — 프로덕션 경로를 그대로 시험해야 한다. 파일 배가로 실제 폭주를 만드는 것이 정공법이다.

- [ ] **Step 4:** `npm run build && npm test && npm run e2e` 전부 초록.
- [ ] **Step 5: 커밋** — `git commit -m "feat(ui): route store through ShellSession; worker in browser, local in tests; deadline recovery e2e"`

**리뷰 주의:** 리뷰어는 (a) store.test.ts가 M1의 모든 행동 단언을 async로 보존했는지(무른 것 없는지), (b) jsdom 테스트가 실제로 Local 세션을 주입해 Worker를 안 부르는지, (c) e2e에서 폭주 명령이 진짜 탭을 안 얼리고 복원되는지 — 실행으로 확인한다.

---
## Task 10: L3 문제 10개 — 텍스트 처리

**Files:**
- Create: `src/game/problems/l3.ts`
- Modify: `src/game/problems/index.ts` (l3 등록 → `allProblems`가 30개)

기존 `tests/problems.test.ts`가 `allProblems`를 순회하며 모든 `solution`이 check를 통과+stderr 빈지, `wrongAnswer`가 실패하는지, 사전 풀림이 없는지, `rm -rf * ; rm -rf .*` 후 check가 안 던지는지 자동 검증한다. l3 등록만으로 커버된다. **check는 `ctx.fs`/`ctx.lastResult`만 읽는다.** import는 `safeRead, safeReaddir, trimEq`.

각 문제는 이 서브셋 안에서만 낸다: grep(-c/-v/-n/-i), sed(s///, p, d), awk(필드/NR/NF/-F/패턴/합계), sort, uniq(-c/-d/-u), cut(-f/-d/-c), tr, wc, 파이프, 리다이렉션. **제어문 없음.**

- [ ] **Step 1: `l3.ts` 작성 (10개).** 아래는 각 문제의 확정 스펙 — id, 제목, prompt, setup, solution, wrongAnswer, check 방식, explanation. 구현 시 이 스펙대로 `Problem` 객체를 짓고, `solution`을 실제 셸에 돌려 정확한 기대 바이트를 확인한 뒤 check를 맞춘다(추측 금지).

```
l3-01 "오류 세기": setup log.txt = 여러 줄 중 ERROR 3개 포함.
  prompt: log.txt 에서 ERROR 가 든 줄이 몇 줄인지, 숫자만 출력하세요.
  solution: grep -c ERROR log.txt   wrongAnswer: grep ERROR log.txt
  check: ctx.lastResult.stdout.trim() === '3'
l3-02 "치환 저장": setup config.txt 에 localhost 여러 개.
  prompt: config.txt 의 모든 localhost 를 0.0.0.0 으로 바꿔 config.new 에 저장하세요.
  solution: sed 's/localhost/0.0.0.0/g' config.txt > config.new
  wrongAnswer: sed 's/localhost/0.0.0.0/' config.txt > config.new   (첫 매치만)
  check: safeRead(config.new) 에 localhost 없음 && 0.0.0.0 개수 == 원본 localhost 개수
l3-03 "이름만 뽑기": setup passwd.txt = "root:x:0\nalice:x:1000\nbob:x:1001\n"
  prompt: passwd.txt(콜론 구분)에서 사용자 이름(첫 필드)만 users.txt 로 저장하세요.
  solution: cut -d: -f1 passwd.txt > users.txt   wrongAnswer: cut -d: -f2 passwd.txt > users.txt
  check: trimEq(safeRead(users.txt), 'root\nalice\nbob')
l3-04 "빈도 집계": setup words.txt 정렬 안 된 단어 반복.
  prompt: words.txt 의 각 단어가 몇 번 나오는지 세어 counts.txt 로 저장하세요. (정렬 후 집계)
  solution: sort words.txt | uniq -c > counts.txt   wrongAnswer: uniq -c words.txt > counts.txt (정렬 안 함)
  check: safeRead(counts.txt) 가 정렬-집계 결과와 정확히 일치.
l3-05 "중복 제거": setup names.txt 정렬 안 된 중복 포함.
  prompt: names.txt 를 정렬하고 중복을 없앤 목록을 unique.txt 로 저장하세요.
  solution: sort names.txt | uniq > unique.txt   또는 sort -u names.txt > unique.txt (둘 다 통과해야)
  wrongAnswer: uniq names.txt > unique.txt   check: safeRead == sorted-unique.
l3-06 "대문자로": setup quiet.txt 소문자 텍스트.
  prompt: quiet.txt 내용을 전부 대문자로 바꿔 loud.txt 로 저장하세요.
  solution: tr a-z A-Z < quiet.txt > loud.txt (그리고 cat quiet.txt | tr a-z A-Z > loud.txt 도 통과)
  wrongAnswer: cp quiet.txt loud.txt   check: safeRead(loud.txt) === 원본 대문자.
l3-07 "합계": setup sales.txt = "alice 30\nbob 25\ncarol 45\n"
  prompt: sales.txt 둘째 열(금액)의 합계를 구해 total.txt 에 숫자만 저장하세요.
  solution: awk '{s+=$2} END{print s}' sales.txt > total.txt   wrongAnswer: awk '{print $2}' sales.txt > total.txt
  check: trimEq(safeRead(total.txt), '100')
l3-08 "실패한 것만": setup runs.txt = 각 줄 "STATUS name code", FAIL 든 줄 몇 개.
  prompt: runs.txt 에서 FAIL 이 든 줄의 세 번째 필드(코드)만 출력하세요.
  solution: awk '/FAIL/{print $3}' runs.txt   wrongAnswer: awk '{print $3}' runs.txt
  check: ctx.lastResult.stdout === 기대 코드 목록.
l3-09 "주석 빼고 세기": setup conf.txt 에 # 로 시작하는 줄 섞임.
  prompt: conf.txt 에서 # 로 시작하는 주석 줄을 뺀 실제 설정 줄이 몇 줄인지 count.txt 에 숫자만 저장하세요.
  solution: grep -v '^#' conf.txt | wc -l > count.txt   wrongAnswer: wc -l conf.txt > count.txt
  check: trimEq(safeRead(count.txt), 기대숫자). (wc 가 파이프 stdin 이면 파일명 없이 숫자만 — M1 확인됨.)
l3-10 "상위 세 줄": setup scores.txt = "이름 점수" 여러 줄.
  prompt: scores.txt 를 점수(2열) 내림차순으로 정렬해 상위 3명의 이름만 top3.txt 로 저장하세요.
  solution: sort -k2 -nr scores.txt | awk '{print $1}' | head -n 3 > top3.txt
  (sort -k 지원이 필요하면 Task와 별개로 sort 에 -k 를 추가하거나, 문제를 -n 로 단순화. 구현 시 sort 의 현재 지원 범위 확인 후 문제를 그에 맞춘다 — sort 가 -k 미지원이면 setup 을 "점수만 든 파일"로 바꿔 sort -nr | head 로.)
  wrongAnswer: head -n 3 scores.txt > top3.txt (정렬 안 함)
```

`l3-10`은 `sort -k`(필드 키) 지원 여부에 달렸다. 구현 시 현재 `sort.ts`가 `-k`를 지원하는지 확인하고, 미지원이면 (a) `sort.ts`에 `-k N`을 최소 추가하거나 (b) 문제 setup을 숫자만 든 파일로 바꿔 `sort -nr | head`로 풀리게 조정한다. 어느 쪽이든 solution을 실제로 돌려 통과를 확인한 뒤 확정.

- [ ] **Step 2~4:** `index.ts`에 l3 등록 → `npx vitest run --project shell tests/problems.test.ts`(이제 solution/wrongAnswer × 30문제) 초록. 빨간불이면 문제(solution/setup/check)를 고친다. 각 solution의 정확한 출력 바이트는 실제 셸로 확인.
- [ ] **Step 5: 커밋** — `git commit -m "feat(game): L3 text-processing problems"`

---

## Task 11: L4 문제 10개 — 시스템

**Files:**
- Create: `src/game/problems/l4.ts`
- Modify: `src/game/problems/index.ts` (l4 등록 → `allProblems`가 40개)

서브셋: find(-name/-type/-exec), xargs(-I), chmod, stat, wc, diff(-q), ln, 파이프. **제어문 없음.** check는 fs 상태 위주(find의 stdout 순서에 절대 의존 안 함).

- [ ] **Step 1: `l4.ts` 작성 (10개).** 확정 스펙:

```
l4-01 "임시파일 청소": setup 여러 디렉터리에 .tmp 파일 흩어놓음 + 지키는 .txt.
  prompt: 현재 디렉터리 아래(하위 포함) 모든 .tmp 파일을 찾아 지우세요. 다른 파일은 건드리지 마세요.
  solution: find . -name '*.tmp' -exec rm {} \;   wrongAnswer: rm *.tmp (하위 못 지움)
  check: safeReaddir 재귀로 .tmp 없음 && .txt 살아있음. (도우미로 재귀 탐색 helper 를 check-helpers 에 추가 가능.)
l4-02 "파일 수 세기": setup tree/ 아래 파일 N개 + 디렉터리.
  prompt: tree 아래의 (디렉터리 말고) 파일이 몇 개인지 세어 count.txt 에 숫자만 저장하세요.
  solution: find tree -type f | wc -l > count.txt   wrongAnswer: ls tree | wc -l > count.txt
  check: trimEq(safeRead(count.txt), N).
l4-03 "일괄 실행권한": setup scripts/ 아래 여러 .sh (mode 644).
  prompt: scripts 아래 모든 .sh 파일에 755 권한을 주세요.
  solution: find scripts -name '*.sh' -exec chmod 755 {} \;   wrongAnswer: chmod 755 scripts/*.sh (하위 못 미침 — setup 을 하위 디렉터리 포함으로)
  check: 모든 .sh 의 lstat().mode === 0o755.
l4-04 "목록대로 삭제": setup delete.txt 에 지울 파일 경로들, 그 파일들 존재.
  prompt: delete.txt 에 적힌 파일들을 모두 지우세요.
  solution: cat delete.txt | xargs rm   또는 xargs rm < delete.txt
  wrongAnswer: rm delete.txt   check: 목록의 파일들 전부 없음 && 다른 파일 살아있음.
l4-05 "총 줄 수": setup logs/ 아래 .log 여러 개.
  prompt: logs 아래 모든 .log 파일의 줄 수 합계를 total.txt 에 저장하세요. (wc 의 total 줄 형식 그대로)
  solution: find logs -name '*.log' | sort | xargs wc -l > total.txt
  wrongAnswer: wc -l logs/*.log > total.txt (경로 형식/합계 다를 수 있음 — 구현 시 확인)
  check: safeRead(total.txt) 가 기대 wc 출력과 일치. (find 순서 때문에 solution 에 | sort 를 넣어 결정적으로.)
l4-06 "같게 만들기": setup expected.txt 와 actual.txt 가 한 줄만 다름.
  prompt: actual.txt 를 expected.txt 와 완전히 같게 고치세요. (diff -q 로 확인)
  solution: cp expected.txt actual.txt   wrongAnswer: (아무것도 안 함)
  check: safeRead(actual.txt) === safeRead(expected.txt) (즉 diff 가 같다고 할 상태).
  explanation 에서 diff -q 로 확인하는 법을 가르친다.
l4-07 "심볼릭 링크": setup current 가 없음, releases/v2 존재.
  prompt: current 라는 이름으로 releases/v2 를 가리키는 심볼릭 링크를 만드세요.
  solution: ln -s releases/v2 current   wrongAnswer: cp -r releases/v2 current
  check: lstat(current).kind === 'symlink' && readFile(current/파일) 이 v2 내용.
l4-08 "숨은 것 포함 개수": setup dir/ 에 .hidden 포함 여러 파일.
  prompt: dir 아래(하위 포함) 모든 파일과 디렉터리의 개수를... → find dir | wc -l > n.txt
  solution: find dir | wc -l > n.txt   wrongAnswer: ls dir | wc -l > n.txt
  check: trimEq(safeRead(n.txt), 기대). (find 는 . 자신도 세므로 주의 — dir 자체 포함.)
l4-09 "특정 확장자만 이동": setup mixed/ 에 .txt, .log 섞임, archive/ 존재.
  prompt: mixed 아래 .log 파일을 전부 archive 로 옮기세요.
  solution: find mixed -name '*.log' -exec mv {} archive \;   wrongAnswer: mv mixed/*.log archive (하위 못 미침)
  check: archive 에 .log 들 있음 && mixed 에 .log 없음 && .txt 그대로.
l4-10 "치환 실행 (xargs -I)": setup names.txt 에 만들 디렉터리 이름들.
  prompt: names.txt 의 각 이름으로 디렉터리를 하나씩 만드세요. (xargs -I 로)
  solution: cat names.txt | xargs -I {} mkdir {}   wrongAnswer: mkdir names.txt
  check: 각 이름이 디렉터리로 존재.
```

`l4-01`/`l4-08`의 재귀 fs 검사를 위해 `check-helpers.ts`에 `safeWalk(fs, path): string[]`(경로 아래 모든 항목, 안전, 절대 안 던짐) 같은 도우미를 추가해도 좋다 — 추가하면 M1의 `safeRead`/`safeReaddir` 옆에 같은 방어 규약으로.

- [ ] **Step 2~4:** 등록 → `tests/problems.test.ts`(40문제) 초록. solution 실제 실행으로 기대 확정. find 순서 의존 없는지 재확인.
- [ ] **Step 5: 커밋** — `git commit -m "feat(game): L4 system problems"`

---

## Task 12: UX — 375px 뷰포트에서 HUD가 입력 줄을 덮는 문제

**Files:**
- Modify: `src/ui/theme.css`, `src/ui/HudCard.tsx`

**M1 최종 리뷰가 Important로 남긴 결함.** `.terminal`이 HUD 자리로 고정 `11rem`(176px)을 예약하는데, `.hud`는 절대 위치에 높이가 가변이다. 375px 폭에서 한국어 prompt가 줄바꿈되면 HUD 하단이 예약치를 넘어(힌트 없이도 191px, 힌트 둘이면 224px) 입력 줄과 그 출력을 덮는다. 데스크톱 1280px은 무관.

**해법:** 매직 넘버 `padding-top: 11rem` 대신 HUD의 **실제 높이**를 측정해 터미널 상단 오프셋에 반영한다. `HudCard`에서 `ResizeObserver`로 HUD 높이를 재고 CSS 변수 `--hud-height`에 써서 `.terminal { padding-top: var(--hud-height) }`가 따라가게 한다. (또는 HUD를 절대 오버레이 대신 일반 흐름에 넣는다 — 하지만 그러면 스크롤 시 HUD가 사라지므로, 측정 방식이 낫다.)

- [ ] **Step 1:** 375px에서 겹침을 재현하는 e2e 또는 jsdom 테스트를 먼저. jsdom은 레이아웃이 없어 겹침을 직접 못 재지만, `HudCard`가 `ResizeObserver`를 붙이고 측정값을 CSS 변수로 쓰는지, 힌트를 펼치면 `--hud-height`가 갱신되는지를 단위로 검증할 수 있다. 진짜 겹침 부재는 e2e(`page.setViewportSize({width:375,height:700})` 후 입력 박스가 HUD에 안 가려지고 클릭 가능)로.
- [ ] **Step 2~4:** `HudCard`에 ResizeObserver 배선, `theme.css`에서 `.terminal` padding을 `var(--hud-height, 11rem)`로. `prefers-reduced-motion`과 무관(레이아웃). 375px에서 입력 클릭·타이핑이 되는지 e2e로 확인. 스크린샷을 `.superpowers/sdd/m2-hud-375.png`로 저장.
- [ ] **Step 5: 커밋** — `git commit -m "fix(ui): measure HUD height so it never covers the input on narrow viewports"`

---

## Task 13: UX — NEXT 이후 포커스가 <body>로 떨어지는 문제

**Files:**
- Modify: `src/ui/Terminal.tsx`, `src/ui/Play.tsx`

**M1 최종 리뷰가 Important로 남긴 결함.** 입력 포커스는 마운트 시 한 번 발화하는 `autoFocus`에만 의존한다. NEXT로 다음 문제로 넘어가는 `startProblem`은 스토어만 바꾸고 `Terminal`을 리마운트하지 않으므로 입력이 다시 포커스되지 않는다 — 키보드 사용자는 문제를 넘길 때마다 타이핑이 무피드백으로 삼켜진다.

**해법:** `Terminal`에 `inputRef`를 두고, 문제가 바뀔 때(문제 id를 키로) `useEffect`로 `inputRef.current?.focus()`. `Play.tsx`가 현재 문제 id를 `Terminal`에 넘기거나, `Terminal`이 스토어의 `status`/문제 id 변화를 구독해 포커스를 되돌린다. RevealSheet의 NEXT는 그대로 두되(엔터로 넘기기 유지), 새 문제 로드 시 포커스가 입력으로 돌아오게 한다.

- [ ] **Step 1:** jsdom 테스트 — 문제를 풀고 NEXT를 눌러 다음 문제로 간 뒤 `document.activeElement`가 터미널 입력인지 단언(현재는 실패). M1 signal.test.tsx가 쓴 fake-timer/`fireEvent` 패턴을 따른다. `setSessionFactory(LocalShellSession)` 필수(jsdom엔 Worker 없음).
- [ ] **Step 2~4:** `Terminal`에 문제-id-키 `useEffect` 포커스 배선 → 통과. 마우스 사용자 경로(onClick 포커스)도 유지되는지 확인. `:focus-visible` 링은 그대로.
- [ ] **Step 5: 커밋** — `git commit -m "fix(ui): return focus to the terminal input when a new problem loads"`

---

## Task 14: 최종 검증 + 플레이스루

**Files:** 없음(검증만). 필요 시 `e2e/smoke.spec.ts` 확장.

- [ ] **Step 1:** 전체 게이트 — `npm run build && npm test && npm run e2e` 전부 초록. 골든 `npm run golden` 재생성 후 `git status`로 바이트 동일 확인.
- [ ] **Step 2:** `npm run dev`로 실제 브라우저 플레이 — L3 한 문제(예: `grep -c`), L4 한 문제(예: `find -exec`)를 실제로 풀어 시트가 뜨는지. grep ReDoS 폭주 입력을 쳐서 탭이 안 얼고 130 후 복원되는지. 375px에서 입력이 안 가려지는지. NEXT 후 키보드로 바로 타이핑되는지. 스크린샷 `.superpowers/sdd/m2-part1-play.png`.
- [ ] **Step 3:** `KNOWN_UNIMPLEMENTED`에 아직 `cut tr uniq sed awk find xargs diff`가 없는지(전부 제거됐는지) 확인.
- [ ] **Step 4:** 최종 커밋(있으면) 또는 정리. 브랜치 마무리는 `superpowers:finishing-a-development-branch`로.

**M2 Part 1 완료.** 여기서 사용자 테스트를 받고 Part 2(2층 엔진 + L5)로 넘어간다.

## 완료 조건

- `npm run build` 타입 에러 0.
- `npm test` — 셸 단위, 골든(18케이스), 문제(40문제 × solution/wrongAnswer/사전풀림/rm-rf), UI 전부 초록. Worker 경로는 jsdom에서 Local 세션으로 대체돼 돌고, 진짜 Worker는 e2e로 검증.
- `npm run e2e` — smoke + worker(데드라인 복원, grep 무정지) 초록.
- `npm run dev` — L1~L4 40문제를 실제로 플레이. 폭주 입력이 탭을 얼리지 않음. 375px에서 입력 안 가려짐. NEXT 후 키보드 연속 플레이.

## Part 2로 넘길 것 (별도 계획)

Layer-2 엔진: 렉서의 개행/키워드 처리, `if`/`for`/`while`/`case`, 함수, `test`/`[`, 위치인자(`$1`..`$@`/`$#`), `source`, shebang 실행, 반복당 `spend()`. L5 스크립팅 문제 10개. `docs/M2-SEAMS.md` §2~5 참조.
