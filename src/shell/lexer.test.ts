import { describe, it, expect } from 'vitest'
import { tokenize, type Token } from './lexer'

const words = (ts: Token[]) => ts.filter((t) => t.type === 'WORD')
const ops = (ts: Token[]) => ts.filter((t) => t.type === 'OP').map((t) => t.value)

describe('tokenize', () => {
  it('공백으로 단어를 나눈다', () => {
    expect(words(tokenize('ls -a /tmp'))).toHaveLength(3)
  })

  it('연속 공백을 하나로 취급한다', () => {
    expect(words(tokenize('ls    -a'))).toHaveLength(2)
  })

  it('EOF 토큰으로 끝난다', () => {
    const ts = tokenize('ls')
    expect(ts[ts.length - 1]).toEqual({ type: 'EOF' })
  })

  it('연산자를 인식한다', () => {
    expect(ops(tokenize('a | b && c || d ; e'))).toEqual(['|', '&&', '||', ';'])
  })

  it('긴 연산자를 짧은 것보다 먼저 먹는다', () => {
    expect(ops(tokenize('a >> b'))).toEqual(['>>'])
    expect(ops(tokenize('a > b'))).toEqual(['>'])
    expect(ops(tokenize('a 2>> b'))).toEqual(['2>>'])
    expect(ops(tokenize('a 2> b'))).toEqual(['2>'])
  })

  it('연산자에 공백이 없어도 나눈다', () => {
    expect(ops(tokenize('a|b'))).toEqual(['|'])
    expect(words(tokenize('a|b'))).toHaveLength(2)
  })

  it('2> 는 연산자지만 2 는 단어다', () => {
    expect(ops(tokenize('echo 2'))).toEqual([])
    expect(ops(tokenize('echo 2>f'))).toEqual(['2>'])
  })

  it('작은따옴표 안은 literal 조각이다', () => {
    const ts = tokenize("echo '$HOME'")
    expect(words(ts)[1]!.word).toEqual([{ kind: 'literal', text: '$HOME' }])
  })

  it('큰따옴표 안은 dquote 조각이다', () => {
    const ts = tokenize('echo "$HOME"')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'dquote', text: '$HOME' }])
  })

  it('따옴표 없는 부분은 raw 조각이다', () => {
    const ts = tokenize('echo $HOME')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$HOME' }])
  })

  it('한 단어 안에서 조각들이 이어붙는다', () => {
    const ts = tokenize(`echo a'b'"c"`)
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'raw', text: 'a' },
      { kind: 'literal', text: 'b' },
      { kind: 'dquote', text: 'c' },
    ])
  })

  it('백슬래시 이스케이프는 literal 조각이 된다', () => {
    const ts = tokenize('echo a\\ b')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'raw', text: 'a' },
      { kind: 'literal', text: ' ' },
      { kind: 'raw', text: 'b' },
    ])
  })

  it('따옴표 안의 연산자는 연산자가 아니다', () => {
    expect(ops(tokenize(`echo '|'`))).toEqual([])
  })

  it('$( ) 안의 공백과 연산자는 통째로 한 조각이다', () => {
    const ts = tokenize('echo $(ls | wc -l)')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(ls | wc -l)' }])
  })

  it('중첩된 $( ) 괄호를 센다', () => {
    const ts = tokenize('echo $(echo $(echo hi))')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(echo $(echo hi))' }])
  })

  it('닫히지 않은 따옴표는 던진다', () => {
    expect(() => tokenize(`echo 'abc`)).toThrow(/unexpected EOF/)
  })

  it('닫히지 않은 $( 는 끝까지 삼키지 않고 던진다', () => {
    expect(() => tokenize('echo $(ls -l')).toThrow(/unexpected EOF/)
  })

  it('빈 입력은 EOF만 낸다', () => {
    expect(tokenize('   ')).toEqual([{ type: 'EOF' }])
  })

  it('echo "" 는 빈 dquote 조각 하나짜리 WORD 를 낸다 (빈 줄 출력)', () => {
    const ts = tokenize('echo ""')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'dquote', text: '' }])
  })

  it('echo a""b 는 빈 조각이 사라지지 않고 raw/dquote/raw 로 남는다', () => {
    const ts = tokenize('echo a""b')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'raw', text: 'a' },
      { kind: 'dquote', text: '' },
      { kind: 'raw', text: 'b' },
    ])
  })

  it('큰따옴표 안에서 \\n, \\t 는 이스케이프가 아니라 백슬래시 그대로다 (\\", \\\\, \\$ 만 이스케이프)', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'printf "%s\n" "a\nb"' => a\nb (백슬래시 보존)
    const ts1 = tokenize('echo "a\\nb"')
    expect(words(ts1)[1]!.word).toEqual([{ kind: 'dquote', text: 'a\\nb' }])

    const ts2 = tokenize('echo "a\\tb"')
    expect(words(ts2)[1]!.word).toEqual([{ kind: 'dquote', text: 'a\\tb' }])
  })

  it('큰따옴표 안의 \\$ 는 literal 조각으로 갈라진다 ($ 확장을 막기 위해)', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'NAME=world; echo "\$NAME"' => $NAME
    const ts = tokenize('echo "\\$NAME"')
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'literal', text: '$' },
      { kind: 'dquote', text: 'NAME' },
    ])
  })

  it('큰따옴표 중간의 \\$ 도 앞뒤 dquote 조각을 literal로 끊는다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo "a\$b"' => a$b
    const ts = tokenize('echo "a\\$b"')
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'dquote', text: 'a' },
      { kind: 'literal', text: '$' },
      { kind: 'dquote', text: 'b' },
    ])
  })

  it('큰따옴표 안의 \\" 도 literal 조각이다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo "\"x\""' => "x"
    const ts = tokenize('echo "\\"x\\""')
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'literal', text: '"' },
      { kind: 'dquote', text: 'x' },
      { kind: 'literal', text: '"' },
    ])
  })

  it('큰따옴표 안의 \\\\ (이스케이프된 백슬래시) 도 literal 조각이다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo "a\\b"' => a\b
    const ts = tokenize('echo "a\\\\b"')
    expect(words(ts)[1]!.word).toEqual([
      { kind: 'dquote', text: 'a' },
      { kind: 'literal', text: '\\' },
      { kind: 'dquote', text: 'b' },
    ])
  })

  it('큰따옴표 안이 이스케이프된 \\$ 하나뿐이면 dquote 빈 조각이 남지 않는다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo "\$"' => $
    const ts = tokenize('echo "\\$"')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'literal', text: '$' }])
  })

  it('a2>b 는 단어 a2 뒤에 > 리다이렉트다 (2 앞에 글자가 이미 붙어 있으면 2>는 연산자가 아니다)', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo a2>b; cat b' => a2
    const ts = tokenize('a2>b')
    expect(words(ts).map((t) => t.word)).toEqual([[{ kind: 'raw', text: 'a2' }], [{ kind: 'raw', text: 'b' }]])
    expect(ops(ts)).toEqual(['>'])
  })

  it('$( ) 안 큰따옴표 속 )는 괄호 깊이를 끊지 않는다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo $(echo ")")' => )
    const ts = tokenize('echo $(echo ")")')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(echo ")")' }])
  })

  it('$( ) 안 큰따옴표 속 (는 괄호 깊이를 올리지 않는다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo $(echo "(")' => (
    const ts = tokenize('echo $(echo "(")')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(echo "(")' }])
  })

  it('$( ) 안 큰따옴표 속 )가 있어도 전체를 통째로 삼킨다 (grep 패턴 예시)', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c
    //   'printf ")\n(\n" > file && echo $(grep ")" file)' => )
    const ts = tokenize('echo $(grep ")" file)')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(grep ")" file)' }])
  })

  it('$( ) 안 작은따옴표 속 )는 괄호 깊이를 끊지 않는다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c "echo \$(echo ')')" => )
    const ts = tokenize("echo $(echo ')')")
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: "$(echo ')')" }])
  })

  it('$( ) 안 백슬래시로 이스케이프된 )는 괄호 깊이를 끊지 않는다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo $(echo \))' => )
    const ts = tokenize('echo $(echo \\))')
    expect(words(ts)).toHaveLength(2)
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(echo \\))' }])
  })

  it('$( ) 안에 따옴표가 있어도 중첩 $( )는 여전히 동작한다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo $(echo $(echo hi))' => hi
    const ts = tokenize('echo $(echo $(echo hi))')
    expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$(echo $(echo hi))' }])
  })

  it('$( 안에서 진짜로 닫히지 않으면 여전히 던진다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo $(ls' => unexpected EOF while looking for matching `)'
    expect(() => tokenize('echo $(ls')).toThrow(/unexpected EOF/)
  })

  it('$( ) 안의 따옴표가 닫히지 않으면 던진다', () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo $(echo "abc' => unexpected EOF while looking for matching `"'
    expect(() => tokenize('echo $(echo "abc')).toThrow(/unexpected EOF/)
  })
})
