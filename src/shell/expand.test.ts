import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from './vfs'
import { tokenize, type Word } from './lexer'
import { expandWord, expandToSingle, type ExpandCtx } from './expand'

function wordOf(source: string): Word {
  const tokens = tokenize(source)
  const first = tokens[0]
  if (!first || first.type !== 'WORD') throw new Error(`not a word: ${source}`)
  return first.word
}

let ctx: ExpandCtx
beforeEach(() => {
  const fs = new VFS()
  fs.mkdir('/w', { recursive: true })
  fs.writeFile('/w/a.txt', '')
  fs.writeFile('/w/b.txt', '')
  ctx = {
    env: { HOME: '/home/player', X: 'a b', EMPTY: '', NAME: 'world' },
    cwd: '/w',
    home: '/home/player',
    fs,
    lastExitCode: 0,
    runSubshell: async (script) => ({ stdout: `<${script}>`, stderr: '', exitCode: 0 }),
  }
})

describe('expandWord — 변수', () => {
  it('$VAR 를 치환한다', async () => {
    expect(await expandWord(wordOf('$NAME'), ctx)).toEqual(['world'])
  })
  it('${VAR} 를 치환한다', async () => {
    expect(await expandWord(wordOf('${NAME}x'), ctx)).toEqual(['worldx'])
  })
  it('없는 변수는 빈 문자열이고 단어가 사라진다', async () => {
    expect(await expandWord(wordOf('$NOPE'), ctx)).toEqual([])
  })
  it('$? 는 직전 exit code', async () => {
    ctx.lastExitCode = 3
    expect(await expandWord(wordOf('$?'), ctx)).toEqual(['3'])
  })
  it('작은따옴표 안에서는 확장하지 않는다', async () => {
    expect(await expandWord(wordOf("'$NAME'"), ctx)).toEqual(['$NAME'])
  })
  it('큰따옴표 안에서는 확장한다', async () => {
    expect(await expandWord(wordOf('"$NAME"'), ctx)).toEqual(['world'])
  })
  it('$1 (positional, M1 범위 밖) 은 크래시 없이 리터럴 $1로 남는다', async () => {
    expect(await expandWord(wordOf('$1'), ctx)).toEqual(['$1'])
  })
  it('유효한 이름이 뒤따르지 않는 외로운 $ 는 리터럴로 남는다', async () => {
    expect(await expandWord(wordOf('a$'), ctx)).toEqual(['a$'])
    expect(await expandWord(wordOf('a$!b'), ctx)).toEqual(['a$!b'])
  })
  it('닫히지 않은 ${ 는 크래시 없이 리터럴로 남는다', async () => {
    expect(await expandWord(wordOf('${NAME'), ctx)).toEqual(['${NAME'])
  })
})

describe('expandWord — 단어분할', () => {
  it('따옴표 없는 $X 는 공백으로 쪼개진다', async () => {
    expect(await expandWord(wordOf('$X'), ctx)).toEqual(['a', 'b'])
  })
  it('큰따옴표 안의 $X 는 쪼개지지 않는다', async () => {
    expect(await expandWord(wordOf('"$X"'), ctx)).toEqual(['a b'])
  })
  it('빈 변수는 따옴표가 없으면 단어를 남기지 않는다', async () => {
    expect(await expandWord(wordOf('$EMPTY'), ctx)).toEqual([])
  })
  it('빈 변수도 큰따옴표 안이면 빈 단어를 남긴다', async () => {
    expect(await expandWord(wordOf('"$EMPTY"'), ctx)).toEqual([''])
  })
  it('리터럴 텍스트는 분할되지 않는다', async () => {
    expect(await expandWord(wordOf(`'a b'`), ctx)).toEqual(['a b'])
  })
  it("작은따옴표 '' 는 빈 단어 하나를 남긴다", async () => {
    expect(await expandWord(wordOf("''"), ctx)).toEqual([''])
  })
  it('빈 변수가 다른 글자에 붙어 있으면 그 글자만 남는다 (x$EMPTY)', async () => {
    expect(await expandWord(wordOf('x$EMPTY'), ctx)).toEqual(['x'])
  })
})

describe('expandWord — 틸드', () => {
  it('맨 앞의 ~ 만 홈으로 바꾼다', async () => {
    expect(await expandWord(wordOf('~/x'), ctx)).toEqual(['/home/player/x'])
    expect(await expandWord(wordOf('~'), ctx)).toEqual(['/home/player'])
  })
  it('중간의 ~ 는 그대로 둔다', async () => {
    expect(await expandWord(wordOf('a~b'), ctx)).toEqual(['a~b'])
  })
  it('따옴표 안의 ~ 는 확장하지 않는다', async () => {
    expect(await expandWord(wordOf('"~"'), ctx)).toEqual(['~'])
  })
  it('홈 경로 안에 공백이 있어도 재분할되지 않는다', async () => {
    ctx.home = '/home/a b'
    expect(await expandWord(wordOf('~/x'), ctx)).toEqual(['/home/a b/x'])
  })
})

describe('expandWord — 명령치환', () => {
  it('$(...) 를 stdout 으로 바꾼다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'hi\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('$(echo hi)'), ctx)).toEqual(['hi'])
  })
  it('후행 개행을 전부 벗긴다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'hi\n\n\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('$(x)'), ctx)).toEqual(['hi'])
  })
  it('내부 개행은 단어분할 대상이다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'a\nb\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('$(x)'), ctx)).toEqual(['a', 'b'])
  })
  it('큰따옴표 안이면 개행이 보존된다', async () => {
    ctx.runSubshell = async () => ({ stdout: 'a\nb\n', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('"$(x)"'), ctx)).toEqual(['a\nb'])
  })
  it('따옴표 속 )는 명령치환의 짝 찾기를 끊지 않는다 (렉서와 같은 버그를 expand가 재현하지 않는지 확인)', async () => {
    let received = ''
    ctx.runSubshell = async (script) => {
      received = script
      return { stdout: ')', stderr: '', exitCode: 0 }
    }
    expect(await expandWord(wordOf('$(echo ")")'), ctx)).toEqual([')'])
    expect(received).toBe('echo ")"')
  })
  it('닫히지 않은 $( 는 던진다', async () => {
    // wordOf 자체가 tokenize에서 던지므로 lexer 단계에서 이미 막힌다 — expand가
    // 별도로 unterminated 케이스를 마주칠 일은 없지만, 렉서 계약을 여기서도 확인한다.
    expect(() => wordOf('$(echo foo')).toThrow(/unexpected EOF/)
  })
})

describe('expandWord — 글롭', () => {
  it('따옴표 없는 패턴을 확장한다', async () => {
    expect(await expandWord(wordOf('*.txt'), ctx)).toEqual(['a.txt', 'b.txt'])
  })
  it('따옴표 붙은 패턴은 확장하지 않는다', async () => {
    expect(await expandWord(wordOf(`'*.txt'`), ctx)).toEqual(['*.txt'])
  })
  it('변수에서 나온 글롭 문자도 확장된다 (bash 동작)', async () => {
    ctx.env.P = '*.txt'
    expect(await expandWord(wordOf('$P'), ctx)).toEqual(['a.txt', 'b.txt'])
  })
  it('큰따옴표 안에서 나온 글롭 문자는 확장되지 않는다', async () => {
    ctx.env.P = '*.txt'
    expect(await expandWord(wordOf('"$P"'), ctx)).toEqual(['*.txt'])
  })
  it('한 단어 안에 따옴표 붙은 메타와 안 붙은 메타가 섞이면 리터럴로 취급한다 (문서화된 한계, 실제 bash와 다름)', async () => {
    // 실제 bash: docker run --rm debian:stable-slim bash -c
    //   'cd /tmp && rm -rf gg && mkdir gg && cd gg && touch star1 star2 &&
    //    echo "*"*' => 파일이 없으면 리터럴 **, 있으면 그 별표로 시작하는 파일들.
    // 여기서는 후자를 흉내낼 파일이 없으므로 두 구현 모두 겉보기엔 같은 출력(**)을
    // 내지만, 메커니즘은 다르다(brief는 애초에 글롭 시도조차 하지 않는다). 이 테스트는
    // 그 알려진 한계를 고정한다 — bash와 일치시키는 "수정"은 여기서 하지 않는다.
    expect(await expandWord(wordOf('"*"*'), ctx)).toEqual(['**'])
  })
})

describe('expandToSingle', () => {
  it('정확히 한 문자열을 준다', async () => {
    expect(await expandToSingle(wordOf('out.txt'), ctx)).toBe('out.txt')
  })
  it('여러 개로 확장되면 ambiguous redirect', async () => {
    await expect(expandToSingle(wordOf('*.txt'), ctx)).rejects.toThrow(/ambiguous redirect/)
  })
  it('0개로 확장되어도 ambiguous redirect', async () => {
    await expect(expandToSingle(wordOf('$NOPE'), ctx)).rejects.toThrow(/ambiguous redirect/)
  })
})
