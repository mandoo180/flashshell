import type { VFS } from './vfs'
import type { Word } from './lexer'
import { expandGlob } from './glob'
import { matchSubstitutionEnd } from './subst'

export interface ExpandCtx {
  env: Record<string, string>
  cwd: string
  home: string
  fs: VFS
  lastExitCode: number
  runSubshell(script: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

/**
 * 확장 중간 표현.
 * - quoted[i] 는 text[i] 가 따옴표 보호를 받는지 나타낸다.
 * - hadQuotes 는 "따옴표 조각이 하나라도 있었는가"다. 내용이 비어도 참일 수 있다.
 *   `""` 는 빈 단어를 남기고 `$EMPTY` 는 단어를 남기지 않는 차이가 여기서 갈린다.
 */
interface Field { text: string; quoted: boolean[]; hadQuotes: boolean }

const empty = (): Field => ({ text: '', quoted: [], hadQuotes: false })

function append(field: Field, text: string, quoted: boolean): void {
  field.text += text
  for (let i = 0; i < text.length; i++) field.quoted.push(quoted)
}

const IFS = [' ', '\t', '\n']

/** $VAR, ${VAR}, $?, $(...) 를 치환한다. protectedResult 면 결과 문자는 따옴표 보호를 받는다. */
async function expandDollar(source: string, protectedResult: boolean, field: Field, ctx: ExpandCtx): Promise<void> {
  let i = 0
  while (i < source.length) {
    const ch = source[i]!

    if (ch !== '$') { append(field, ch, protectedResult); i++; continue }

    // $(...) — 짝 찾기는 렉서와 공유하는 따옴표 인식 스캐너를 쓴다. 여기서 독자적으로
    // 괄호 깊이를 세면 따옴표 속 )를 짝으로 착각하는 버그를 다시 만들게 된다
    // (`echo $(echo ")")` 가 대표 사례 — lexer.ts 도 한때 이 버그가 있었다).
    if (source[i + 1] === '(') {
      const closeIndex = matchSubstitutionEnd(source, i)
      const script = source.slice(i + 2, closeIndex)
      const result = await ctx.runSubshell(script)
      // 명령치환 결과의 후행 개행은 전부 벗긴다. 이것이 bash 동작이다.
      const output = result.stdout.replace(/\n+$/, '')
      // 결과는 따옴표 보호를 물려받는다. 안 그러면 "$(x)"가 쪼개진다.
      append(field, output, protectedResult)
      i = closeIndex + 1
      continue
    }

    // $?
    if (source[i + 1] === '?') {
      append(field, String(ctx.lastExitCode), protectedResult)
      i += 2
      continue
    }

    // ${NAME}
    if (source[i + 1] === '{') {
      const close = source.indexOf('}', i + 2)
      if (close === -1) { append(field, ch, protectedResult); i++; continue }
      const name = source.slice(i + 2, close)
      append(field, ctx.env[name] ?? '', protectedResult)
      i = close + 1
      continue
    }

    // $NAME — 위치 매개변수($1 등)는 M1 범위 밖이다. 이름 정규식이 숫자로 시작하는
    // 것을 애초에 매치하지 않으므로 $1은 아래 "매치 실패" 경로로 빠져 리터럴 $1로
    // 남는다. 크래시하지 않는다.
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i + 1))
    if (!match) { append(field, ch, protectedResult); i++; continue }
    append(field, ctx.env[match[0]] ?? '', protectedResult)
    i += 1 + match[0].length
  }
}

/** 따옴표 보호를 받지 않는 IFS 문자에서 필드를 쪼갠다. */
function splitFields(field: Field): Field[] {
  const out: Field[] = []
  let current = empty()
  let started = false

  for (let i = 0; i < field.text.length; i++) {
    const ch = field.text[i]!
    const isQuoted = field.quoted[i]!
    if (!isQuoted && IFS.includes(ch)) {
      if (started) { out.push(current); current = empty(); started = false }
      continue
    }
    append(current, ch, isQuoted)
    started = true
  }
  if (started) out.push(current)

  // 내용이 하나도 안 나왔지만 따옴표는 있었다면(`""`), 빈 단어 하나를 남긴다.
  if (out.length === 0 && field.hadQuotes) out.push(empty())
  return out
}

/**
 * 이 필드를 글롭 패턴으로 볼 것인가?
 * 따옴표 보호를 받지 않는 메타문자가 하나라도 있어야 패턴이다.
 *
 * 알려진 한계: 한 단어 안에 따옴표 보호를 받는 메타문자와 받지 않는 메타문자가
 * 섞이면(`"*"*`) 글롭하지 않고 리터럴로 취급한다. 진짜 bash는 글롭한다.
 * 문제 출제에서 이 조합을 쓰지 않는다.
 */
function globPattern(field: Field): string | null {
  let hasUnquotedMeta = false
  for (let i = 0; i < field.text.length; i++) {
    if (!field.quoted[i] && '*?['.includes(field.text[i]!)) hasUnquotedMeta = true
  }
  if (!hasUnquotedMeta) return null

  for (let i = 0; i < field.text.length; i++) {
    if (field.quoted[i] && '*?['.includes(field.text[i]!)) return null
  }
  return field.text
}

export async function expandWord(word: Word, ctx: ExpandCtx): Promise<string[]> {
  const field = empty()

  for (let index = 0; index < word.length; index++) {
    const part = word[index]!

    if (part.kind === 'literal') { field.hadQuotes = true; append(field, part.text, true); continue }
    if (part.kind === 'dquote') { field.hadQuotes = true; await expandDollar(part.text, true, field, ctx); continue }

    // raw: 맨 앞 조각의 맨 앞 ~ 만 홈으로 바꾼다.
    let text = part.text
    if (index === 0 && text.startsWith('~') && (text.length === 1 || text[1] === '/')) {
      append(field, ctx.home, true) // 홈 경로는 다시 분할되면 안 된다
      text = text.slice(1)
    }
    await expandDollar(text, false, field, ctx)
  }

  // 아무 조각도 없으면(있을 수 없지만) 빈 배열
  if (word.length === 0) return []

  const fields = splitFields(field)

  // 따옴표가 전혀 없고 내용도 비었으면 단어가 통째로 사라진다 ($NOPE, $EMPTY)
  if (fields.length === 0) return []

  const results: string[] = []
  for (const f of fields) {
    const pattern = globPattern(f)
    if (pattern === null) { results.push(f.text); continue }
    results.push(...expandGlob(pattern, ctx.cwd, ctx.fs))
  }
  return results
}

export async function expandToSingle(word: Word, ctx: ExpandCtx): Promise<string> {
  const results = await expandWord(word, ctx)
  if (results.length !== 1) throw new Error('ambiguous redirect')
  return results[0]!
}
