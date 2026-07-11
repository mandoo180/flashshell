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

  it('`;;` 는 하나의 토큰이다 (`;` 두 개가 아니다) (task 6: case 분기 종료자)', () => {
    expect(ops(tokenize('a;;b'))).toEqual([';;'])
    expect(ops(tokenize('a ;; b'))).toEqual([';;'])
  })

  it('`;;` 는 `;` 보다 먼저 매칭된다 (longest-match-first)', () => {
    expect(ops(tokenize('a;;;b'))).toEqual([';;', ';'])
    expect(ops(tokenize('a;b'))).toEqual([';'])
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

  describe('${ ... } 파라미터 확장 원자 캡처 (task 3)', () => {
    it('${x:-a b} 안의 공백은 통째로 한 raw 조각으로 삼킨다 (분할은 확장 후에)', () => {
      const ts = tokenize('echo ${UNSET:-a b}')
      expect(words(ts)).toHaveLength(2)
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '${UNSET:-a b}' }])
    })

    it('중첩 ${...} 의 안쪽 } 에서 조기 종료하지 않는다 (중괄호 깊이 카운트)', () => {
      const ts = tokenize('echo ${UNSET:-${NAME}}')
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '${UNSET:-${NAME}}' }])
    })

    it('arg 안 따옴표 속 } 는 짝으로 세지 않는다 (따옴표 인식)', () => {
      const ts = tokenize('echo ${UNSET:-"a}b"}')
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '${UNSET:-"a}b"}' }])
    })

    it('${#NAME} 길이형도 한 조각', () => {
      const ts = tokenize('echo ${#NAME}')
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '${#NAME}' }])
    })

    it('닫히지 않은 ${ 는 던진다', () => {
      expect(() => tokenize('echo ${UNSET')).toThrow(/unexpected EOF/)
    })

    it('$ 뒤에 { 가 아닌 것은 원자 캡처 대상이 아니다 (일반 $VAR 회귀)', () => {
      const ts = tokenize('echo $HOME')
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$HOME' }])
    })
  })

  it('닫히지 않은 따옴표는 던진다', () => {
    expect(() => tokenize(`echo 'abc`)).toThrow(/unexpected EOF/)
  })

  it('닫히지 않은 $( 는 끝까지 삼키지 않고 던진다', () => {
    expect(() => tokenize('echo $(ls -l')).toThrow(/unexpected EOF/)
  })

  describe('(( expr )) 산술 명령 (task 2)', () => {
    it('단어 시작의 bare (( 는 짝이 맞는 )) 까지 raw 조각 하나로 통째로 삼킨다', () => {
      const ts = tokenize('(( 1 + 2 ))')
      expect(words(ts)).toHaveLength(1)
      expect(words(ts)[0]!.word).toEqual([{ kind: 'raw', text: '(( 1 + 2 ))' }])
    })

    it('안의 <, > 는 리다이렉트 연산자로 오인되지 않는다 (배경 버그 회귀)', () => {
      // 수정 전: `((` 가 raw 두 글자로 흩어지고 `<` 가 리다이렉트로 토큰화되어 완전히 깨졌다.
      const ts = tokenize('(( i < 5 ))')
      expect(ops(ts)).toEqual([])
      expect(words(ts)).toHaveLength(1)
      expect(words(ts)[0]!.word).toEqual([{ kind: 'raw', text: '(( i < 5 ))' }])
    })

    it('안쪽에 괄호 그룹이 있어도 짝을 정확히 센다', () => {
      const ts = tokenize('(( (1+2) * 3 ))')
      expect(words(ts)[0]!.word).toEqual([{ kind: 'raw', text: '(( (1+2) * 3 ))' }])
    })

    it('&& 뒤 등 다른 자리의 (( 도 같은 방식으로 삼킨다 (합성 문맥)', () => {
      const ts = tokenize('(( 2 > 1 )) && echo yes')
      expect(words(ts)[0]!.word).toEqual([{ kind: 'raw', text: '(( 2 > 1 ))' }])
      expect(ops(ts)).toEqual(['&&'])
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: 'echo' }])
    })

    it('$(( 는 여전히 $ 분기가 먼저 가로챈다 (산술 확장과 충돌 없음)', () => {
      const ts = tokenize('echo $((1+2))')
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: '$((1+2))' }])
    })

    it('닫히지 않은 (( 는 끝까지 삼키지 않고 던진다', () => {
      expect(() => tokenize('(( 1 + 2')).toThrow(/unexpected EOF/)
    })

    it('단어 중간의 (( 는 (단어 시작이 아니므로) 산술이 아니라 메타문자 ( 로 단어를 끊는다', () => {
      // 예: a((b -- 첫 글자 a 로 이미 단어가 시작된 뒤라 word.length !== 0 → 산술 캡처 안 함.
      // ( 는 메타문자라 단어를 끊는다. 실제 bash 확인:
      //   docker run --rm debian:stable-slim bash -c 'a((b))' => syntax error near unexpected token `('
      // (즉 bash 도 ( 를 메타문자로 보고 단어를 끊는다 — 산술로 통째 삼키지 않는다.)
      const ts = tokenize('a((b))')
      expect(ops(ts)).toEqual(['(', '(', ')', ')'])
      expect(words(ts).map((t) => t.word)).toEqual([[{ kind: 'raw', text: 'a' }], [{ kind: 'raw', text: 'b' }]])
    })
  })

  describe('( ) 메타문자 토큰화 (task 2 part 2)', () => {
    it('단일 ( 와 ) 는 별도 OP 토큰이다 (공백으로 갈라진 subshell 형태)', () => {
      // 실제 bash 확인: docker run --rm debian:stable-slim bash -c '( echo sub )' => sub
      const ts = tokenize('( echo )')
      expect(ops(ts)).toEqual(['(', ')'])
      expect(words(ts).map((t) => t.word)).toEqual([[{ kind: 'raw', text: 'echo' }]])
    })

    it('( 는 글자에 붙어 있어도 단어를 끊는다 (메타문자)', () => {
      // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo a(b' => syntax error near `('
      const ts = tokenize('echo a(b')
      expect(ops(ts)).toEqual(['('])
      expect(words(ts).map((t) => t.word)).toEqual([
        [{ kind: 'raw', text: 'echo' }],
        [{ kind: 'raw', text: 'a' }],
        [{ kind: 'raw', text: 'b' }],
      ])
    })

    it('f() 는 f ( ) 세 토큰이다 (공백 유무 무관)', () => {
      for (const src of ['f()', 'f ()', 'f( )', 'f ( )']) {
        const ts = tokenize(src)
        expect(ops(ts)).toEqual(['(', ')'])
        expect(words(ts).map((t) => t.word)).toEqual([[{ kind: 'raw', text: 'f' }]])
      }
    })

    it('컴팩트 f(){ 는 f ( ) { 로 쪼개지고 { 는 별도 WORD 로 남는다', () => {
      const ts = tokenize('f(){ echo hi; }')
      const shape = ts
        .filter((t) => t.type !== 'EOF')
        .map((t) => (t.type === 'OP' ? `OP(${t.value})` : `WORD(${(t as { word: { text: string }[] }).word.map((p) => p.text).join('')})`))
      expect(shape).toEqual(['WORD(f)', 'OP(()', 'OP())', 'WORD({)', 'WORD(echo)', 'WORD(hi)', 'OP(;)', 'WORD(})'])
    })

    it('word-start (( 는 여전히 산술로 통째 캡처(단일 ( 토큰으로 쪼개지 않는다)', () => {
      const ts = tokenize('(( 1+2 ))')
      expect(ops(ts)).toEqual([])
      expect(words(ts)).toHaveLength(1)
      expect(words(ts)[0]!.word).toEqual([{ kind: 'raw', text: '(( 1+2 ))' }])
    })

    it('공백으로 갈라진 ( ( 는 두 개의 ( 토큰이다 (중첩 subshell, 산술 아님)', () => {
      // word-start `((` 만 산술. 공백이 끼면 각각 단일 ( 토큰(중첩 subshell — Task 3).
      const ts = tokenize('( (echo) )')
      expect(ops(ts)).toEqual(['(', '(', ')', ')'])
      expect(words(ts).map((t) => t.word)).toEqual([[{ kind: 'raw', text: 'echo' }]])
    })

    it('따옴표 안의 ( ) 는 토큰이 아니라 리터럴이다', () => {
      const ts = tokenize(`echo '(a)'`)
      expect(ops(ts)).toEqual([])
      expect(words(ts)[1]!.word).toEqual([{ kind: 'literal', text: '(a)' }])
    })

    it('{ 와 } 는 (메타문자가 아니라 예약어라) 글자에 붙으면 끊지 않는다', () => {
      // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo a{b' => a{b (안 끊음)
      const ts = tokenize('echo a{b')
      expect(ops(ts)).toEqual([])
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: 'a{b' }])
    })
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

  describe('개행 분리자와 # 주석', () => {
    const shape = (ts: Token[]) =>
      ts.map((t) => (t.type === 'OP' ? `OP(${t.value})` : t.type === 'WORD' ? 'WORD' : 'EOF'))

    it('개행은 ; 와 동등한 분리자 토큰으로 접힌다', () => {
      // 실제 bash 확인: echo a; echo b 와 echo a\necho b 는 동일하게 a\nb 를 출력한다.
      const ts = tokenize('echo a\necho b')
      expect(shape(ts)).toEqual(['WORD', 'WORD', 'OP(;)', 'WORD', 'WORD', 'EOF'])
      expect(words(ts).map((t) => t.word.map((p) => p.text).join(''))).toEqual(['echo', 'a', 'echo', 'b'])
    })

    it('# 이후 줄 끝까지는 주석으로 버려진다', () => {
      // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo hi # comment here' => hi
      const ts = tokenize('echo hi # 주석')
      expect(shape(ts)).toEqual(['WORD', 'WORD', 'EOF'])
      expect(words(ts).map((t) => t.word.map((p) => p.text).join(''))).toEqual(['echo', 'hi'])
    })

    it('단어 중간의 #은 리터럴이다 (a#b)', () => {
      // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo a#b' => a#b
      const ts = tokenize('echo a#b')
      expect(shape(ts)).toEqual(['WORD', 'WORD', 'EOF'])
      expect(words(ts)[1]!.word).toEqual([{ kind: 'raw', text: 'a#b' }])
    })

    it('따옴표 안의 #은 리터럴이다', () => {
      // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'echo "# x"' => # x
      const ts = tokenize("echo '# not'")
      expect(words(ts)[1]!.word).toEqual([{ kind: 'literal', text: '# not' }])
    })

    it('if/then/fi 여러 줄이 세미콜론 흐름과 동등하게 토큰화된다', () => {
      const multi = tokenize('if true\nthen echo hi\nfi')
      const single = tokenize('if true ; then echo hi ; fi')
      expect(shape(multi)).toEqual(shape(single))
      expect(words(multi).map((t) => t.word.map((p) => p.text).join(''))).toEqual(
        words(single).map((t) => t.word.map((p) => p.text).join('')),
      )
    })

    it('빈 줄(연속 개행)은 빈 리스트 항목을 만들지 않고 ; 하나로 접힌다', () => {
      // 실제 bash 확인: docker run --rm debian:stable-slim bash -c $'echo a\n\necho b' => a\nb (빈 줄은 무시된다)
      const ts = tokenize('echo a\n\necho b')
      expect(shape(ts)).toEqual(['WORD', 'WORD', 'OP(;)', 'WORD', 'WORD', 'EOF'])
    })

    it('선행 주석 줄은 선행 ; 를 만들지 않는다', () => {
      // 실제 bash 확인: 스크립트 첫 줄이 주석이어도 문법 오류 없이 실행된다.
      const ts = tokenize('# leading comment\necho hi')
      expect(shape(ts)).toEqual(['WORD', 'WORD', 'EOF'])
    })

    it('후행 개행은 후행 세미콜론처럼 접힌다 (파서가 허용)', () => {
      const ts = tokenize('echo hi\n')
      expect(shape(ts)).toEqual(['WORD', 'WORD', 'OP(;)', 'EOF'])
    })
  })
})

describe('배열 리터럴 인접 캡처 (M3 Part 3 task 2)', () => {
  // WORD 조각 텍스트까지 보는 shape (배열 캡처가 안쪽 공백을 삼켰는지 확인용).
  const shapeT = (ts: Token[]) =>
    ts
      .filter((t) => t.type !== 'EOF')
      .map((t) => (t.type === 'OP' ? `OP(${t.value})` : `WORD(${(t as { word: { text: string }[] }).word.map((p) => p.text).join('')})`))

  it('arr=(a b c) 는 안쪽 공백째로 하나의 raw WORD 로 캡처된다 (인접)', () => {
    const ts = tokenize('arr=(a b c)')
    expect(shapeT(ts)).toEqual(['WORD(arr=(a b c))'])
    expect(words(ts)[0]!.word).toEqual([{ kind: 'raw', text: 'arr=(a b c)' }])
  })

  it('arr= (a b c) [= 뒤 공백] 은 배열이 아니라 WORD(arr=) + OP(() 로 갈린다 (adjacency)', () => {
    // bash 확인: `arr= (a b c)` 는 배열 대입이 아니라 문법 오류다. 공백이 인접을 깬다 —
    // 렉서가 공백에서 word 를 flush 하므로 ( 도달 시 word 가 비어 배열 캡처가 안 걸린다.
    const ts = tokenize('arr= (a b c)')
    expect(shapeT(ts)).toEqual(['WORD(arr=)', 'OP(()', 'WORD(a)', 'WORD(b)', 'WORD(c)', 'OP())'])
  })

  it('빈 배열 arr=() 도 하나의 WORD 로 캡처된다', () => {
    expect(shapeT(tokenize('arr=()'))).toEqual(['WORD(arr=())'])
  })

  it('첨자 LHS arr[0]=(x y) 도 인접 배열로 캡처된다', () => {
    expect(shapeT(tokenize('arr[0]=(x y)'))).toEqual(['WORD(arr[0]=(x y))'])
  })

  it('quote/subst 인식: arr=(")" $(echo a b)) 의 안쪽 ) 는 짝으로 세지 않는다', () => {
    expect(shapeT(tokenize('arr=(")" $(echo a b))'))).toEqual(['WORD(arr=(")" $(echo a b)))'])
  })

  it('함수정의 f() 는 영향 없음 (= 로 안 끝나 캡처 안 됨)', () => {
    expect(shapeT(tokenize('f()'))).toEqual(['WORD(f)', 'OP(()', 'OP())'])
  })

  it('서브셸 (echo a) 는 영향 없음 (앞에 NAME= 가 없음)', () => {
    expect(shapeT(tokenize('(echo a)'))).toEqual(['OP(()', 'WORD(echo)', 'WORD(a)', 'OP())'])
  })

  it('명령 인자의 x=(...) 도 캡처된다 (렉서는 명령 위치를 모른다 — 문서화된 관대함)', () => {
    // 실제 bash 는 `echo arr=(x)` 를 문법 오류로 보지만, 렉서는 문맥을 모르므로 인접
    // 배열로 삼킨다. 퍼즐에 없는 obscure edge — "더 관대한" 방향이라 무해하다.
    expect(shapeT(tokenize('echo arr=(x)'))).toEqual(['WORD(echo)', 'WORD(arr=(x))'])
  })

  // M3 Part 4 task 1: `NAME+=(...)` append LHS 도 인접 배열로 캡처한다.
  it('arr+=(c d) 도 인접 배열로 캡처된다 (+= append LHS)', () => {
    expect(shapeT(tokenize('arr+=(c d)'))).toEqual(['WORD(arr+=(c d))'])
    expect(words(tokenize('arr+=(c d)'))[0]!.word).toEqual([{ kind: 'raw', text: 'arr+=(c d)' }])
  })

  it('첨자 LHS arr[0]+=(x y) 도 인접 배열로 캡처된다', () => {
    expect(shapeT(tokenize('arr[0]+=(x y)'))).toEqual(['WORD(arr[0]+=(x y))'])
  })
})
