import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from './vfs'
import { tokenize, type Word } from './lexer'
import { expandWord, expandToSingle, expandForCase, type ExpandCtx } from './expand'

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
    positional: [],
    arrays: new Map(),
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
  it('$1 은 positional이 비어 있으면(M1 시절과 달리 이제는 실제 확장 대상) 미설정 변수처럼 빈 문자열 취급이라 단어가 사라진다 (task 3)', async () => {
    // M1에서는 이름 regex가 숫자를 안 잡아 리터럴 $1로 남았다. task 3부터 $1은 실제
    // 위치 매개변수로 확장된다 — positional이 비어 있으면 $NOPE와 동일하게 취급된다.
    expect(await expandWord(wordOf('$1'), ctx)).toEqual([])
  })
  it('유효한 이름이 뒤따르지 않는 외로운 $ 는 리터럴로 남는다', async () => {
    expect(await expandWord(wordOf('a$'), ctx)).toEqual(['a$'])
    expect(await expandWord(wordOf('a$!b'), ctx)).toEqual(['a$!b'])
  })
  it('닫히지 않은 따옴표 없는 ${ 는 렉서가 던진다 (task 3: ${...} 원자 캡처 후, $( 와 같은 계약)', () => {
    // wordOf 자체가 tokenize 에서 던진다 — 렉서가 ${...} 를 통째로 캡처하면서 짝이 없는
    // }를 발견하면 $( 와 똑같이 unexpected EOF 로 막는다(실제 bash: `echo ${NAME` → exit 2
    // "unexpected EOF while looking for matching `}'"). 인터프리터는 이 throw 를 exit 2
    // 문법 오류 ExecResult 로 바꾼다(run()의 parse catch).
    expect(() => wordOf('${NAME')).toThrow(/unexpected EOF/)
  })
  it('닫힌 따옴표 안의 짝 없는 ${ 는 expandDollar 가 리터럴로 남긴다 (findBraceClose 폴백 — 여전히 도달 가능)', async () => {
    // "${NAME" 는 dquote 조각이 닫혀 있어(따옴표 균형) 렉서를 통과한다 — dquote 텍스트
    // `${NAME` 를 expandDollar 가 처리하다 findBraceClose 가 -1 을 돌려주는 폴백 경로.
    expect(await expandWord(wordOf('"${NAME"'), ctx)).toEqual(['${NAME'])
  })
})

describe('expandWord — 큰따옴표 안의 이스케이프된 $', () => {
  it('\\$NAME 은 확장되지 않고 리터럴 $NAME 으로 남는다', async () => {
    // 실제 bash 확인: docker run --rm debian:stable-slim bash -c 'NAME=world; echo "\$NAME"' => $NAME
    expect(await expandWord(wordOf('"\\$NAME"'), ctx)).toEqual(['$NAME'])
  })
  it('회귀: 이스케이프 없는 "$NAME" 은 여전히 확장된다', async () => {
    expect(await expandWord(wordOf('"$NAME"'), ctx)).toEqual(['world'])
  })
  it('회귀: \\$NAME 은 NAME 값에 공백이 있어도 한 단어로 남는다 (분할되지 않는다)', async () => {
    ctx.env.NAME = 'a b c'
    expect(await expandWord(wordOf('"\\$NAME"'), ctx)).toEqual(['$NAME'])
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

describe('expandWord — 산술 확장 $(( ))', () => {
  it('$((1+2)) 를 3 으로 바꾼다', async () => {
    expect(await expandWord(wordOf('$((1+2))'), ctx)).toEqual(['3'])
  })
  it('echo 인자 자리의 산술 (텍스트에 붙어도 동작)', async () => {
    expect(await expandWord(wordOf('x$((2*3))y'), ctx)).toEqual(['x6y'])
  })
  it('변수를 읽는다 (bare 와 $x 둘 다)', async () => {
    ctx.env.N = '5'
    expect(await expandWord(wordOf('$((N+1))'), ctx)).toEqual(['6'])
    expect(await expandWord(wordOf('$(($N*2))'), ctx)).toEqual(['10'])
  })
  it('대입 부작용이 ctx.env 에 남는다', async () => {
    ctx.env.I = '0'
    expect(await expandWord(wordOf('$((I=I+1))'), ctx)).toEqual(['1'])
    expect(ctx.env.I).toBe('1')
  })
  it('중첩 괄호', async () => {
    expect(await expandWord(wordOf('$(( (1+2)*3 ))'), ctx)).toEqual(['9'])
  })
  it('$(( )) 는 $( 명령치환보다 먼저 잡혀 명령을 실행하지 않는다', async () => {
    let ran = false
    ctx.runSubshell = async (script) => { ran = true; return { stdout: script, stderr: '', exitCode: 0 } }
    expect(await expandWord(wordOf('$((1+2))'), ctx)).toEqual(['3'])
    expect(ran).toBe(false)
  })
  it('산술 오류(0 나누기)는 던져서 위(interpreter)가 ExecResult 로 바꾸게 한다', async () => {
    await expect(expandWord(wordOf('$((1/0))'), ctx)).rejects.toThrow(/division by 0/)
  })
})

describe('expandWord — 산술 안 ${...}/$(...) 확장 (M3 Part 2 task 1)', () => {
  // 전부 docker debian:stable-slim bash 5 로 실측 확인.
  it('${#NAME} 이 산술 식 안에서 길이로 확장된다 (docker: NAME=world; echo $(( ${#NAME} + 1 )) → 6)', async () => {
    // beforeEach 가 이미 NAME=world 를 세팅해 둔다.
    expect(await expandWord(wordOf('$(( ${#NAME} + 1 ))'), ctx)).toEqual(['6'])
  })

  it('${x:-3} 기본값이 산술 식 안에서 값으로 확장된다 (docker: unset x; echo $(( ${x:-3} * 2 )) → 6)', async () => {
    // ctx.env 에 x 가 없다(beforeEach 기본 fixture) — 미설정과 동치.
    expect(await expandWord(wordOf('$(( ${x:-3} * 2 ))'), ctx)).toEqual(['6'])
  })

  it('$(...) 명령치환이 산술 식 안에서 값으로 확장된다 (docker: echo $(( $(echo 5) + 1 )) → 6)', async () => {
    ctx.runSubshell = async (script) => ({ stdout: script === 'echo 5' ? '5\n' : '', stderr: '', exitCode: 0 })
    expect(await expandWord(wordOf('$(( $(echo 5) + 1 ))'), ctx)).toEqual(['6'])
  })

  it('회귀: 산술 밖에서 만든 ${#NAME} 를 bare 변수로 재사용하는 기존 동작은 그대로다 (docker: n=${#NAME}; echo $((n+1)) → 6)', async () => {
    ctx.env.n = String(ctx.env.NAME!.length) // = ${#NAME}, 산술 밖에서 미리 계산했다고 가정
    expect(await expandWord(wordOf('$((n+1))'), ctx)).toEqual(['6'])
  })

  it('역방향 회귀: ${x:-$((1+2))} (산술이 파라미터 확장 기본값 안에 있음) 은 이미 동작하며 계속 동작한다 (docker → 3)', async () => {
    expect(await expandWord(wordOf('${x:-$((1+2))}'), ctx)).toEqual(['3'])
  })

  it('대입 부작용은 확장 후 evalArith 가 처리한다 (docker: unset x y; echo $(( x = ${y:-0} + 1 )); echo $x → 1 / 1)', async () => {
    expect(await expandWord(wordOf('$(( x = ${y:-0} + 1 ))'), ctx)).toEqual(['1'])
    expect(ctx.env.x).toBe('1')
  })

  it('bare 변수와 $변수의 재귀평가 우선순위 차이가 유지된다 (docker: x="1+2"; echo $((x*3)) → 9, echo $(($x*3)) → 7)', async () => {
    // bare x 는 evalArith 자체가 값을 통째로(괄호친 것처럼) 재귀평가하지만, $x 는 이 확장
    // 단계에서 텍스트로 그 자리에 꽂히므로 바깥 식과 우선순위가 섞인다 — 실제 bash와 일치.
    ctx.env.x = '1+2'
    expect(await expandWord(wordOf('$((x*3))'), ctx)).toEqual(['9'])
    expect(await expandWord(wordOf('$(($x*3))'), ctx)).toEqual(['7'])
  })

  it('깨진 ${ 는 evalArith 문법 오류로 surface 되고 크래시하지 않는다 (docker: echo $(( ${ )) → exit 1)', async () => {
    await expect(expandWord(wordOf('$(( ${ ))'), ctx)).rejects.toThrow()
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

describe('expandWord — 위치 매개변수 (task 3)', () => {
  // docker: debian:stable-slim bash -c 'set -- a b c; echo $1 $#; echo "$*"; echo $@' => a 3 / a b c / a b c
  it('$1 $2 가 각 위치 인자로 치환된다', async () => {
    ctx.positional = ['a', 'b']
    expect(await expandWord(wordOf('$1'), ctx)).toEqual(['a'])
    expect(await expandWord(wordOf('$2'), ctx)).toEqual(['b'])
  })
  it('${N} (두 자리 포함) 을 치환한다', async () => {
    ctx.positional = ['7']
    expect(await expandWord(wordOf('${1}0'), ctx)).toEqual(['70'])
  })
  it('"$*" 는 IFS 첫 글자(스페이스)로 조인된 단일 필드', async () => {
    ctx.positional = ['a', 'b']
    expect(await expandWord(wordOf('"$*"'), ctx)).toEqual(['a b'])
  })
  it('$@ 는 따옴표 없이 쓰이면 인자별로 단어분할된다 (splitFields 재사용)', async () => {
    ctx.positional = ['x', 'y']
    expect(await expandWord(wordOf('$@'), ctx)).toEqual(['x', 'y'])
  })
  it('$0 은 지금은 빈 문자열 (스크립트/함수명은 Task 7/8/9가 세팅)', async () => {
    ctx.positional = ['a', 'b']
    expect(await expandWord(wordOf('$0'), ctx)).toEqual([])
  })
  it('미설정 위치인자($1, positional=[])는 빈 문자열이고 단어가 사라진다', async () => {
    ctx.positional = []
    expect(await expandWord(wordOf('$1'), ctx)).toEqual([])
  })
  it('$# 는 정확한 개수 문자열을 낸다', async () => {
    ctx.positional = ['a', 'b', 'c']
    expect(await expandWord(wordOf('$#'), ctx)).toEqual(['3'])
  })
  it('${10} 은 10번째 위치 인자를 가리킨다', async () => {
    ctx.positional = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
    expect(await expandWord(wordOf('${10}'), ctx)).toEqual(['10'])
    expect(await expandWord(wordOf('${11}'), ctx)).toEqual(['11'])
  })
})

describe('expandWord — "$@" per-argument 필드 (task 5, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // docker: set -- x "y z" w; for a in "$@"; do echo "[$a]"; done => [x] [y z] [w]
  it('"$@" 는 각 위치 인자를 개별 필드로 — 인자 내부 공백도 보존한다', async () => {
    ctx.positional = ['x', 'y z', 'w']
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual(['x', 'y z', 'w'])
  })
  // docker: set --; for a in "$@"; do echo x; done => (출력 없음 — 0 필드)
  it('"$@" 는 위치 인자가 없으면 필드를 하나도 남기지 않는다 (빈 단어조차 아님)', async () => {
    ctx.positional = []
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual([])
  })
  // docker: set -- A B C; for a in "pre$@post"; do echo "[$a]"; done => [preA] [B] [Cpost]
  it('"pre$@post" 는 첫 인자를 pre 에, 마지막 인자를 post 에 붙이고 중간은 개별 필드', async () => {
    ctx.positional = ['A', 'B', 'C']
    expect(await expandWord(wordOf('"pre$@post"'), ctx)).toEqual(['preA', 'B', 'Cpost'])
  })
  // docker: set --; for a in "pre$@post"; do echo "[$a]"; done => [prepost]
  it('"pre$@post" 는 인자가 없으면 pre 와 post 가 한 필드로 붙는다 (prepost)', async () => {
    ctx.positional = []
    expect(await expandWord(wordOf('"pre$@post"'), ctx)).toEqual(['prepost'])
  })
  // docker: set -- A; for a in "pre$@post"; do echo "[$a]"; done => [preApost]
  it('"pre$@post" 인자가 하나면 preApost 한 필드', async () => {
    ctx.positional = ['A']
    expect(await expandWord(wordOf('"pre$@post"'), ctx)).toEqual(['preApost'])
  })
  it('"$@" 는 인자가 하나면 필드 하나', async () => {
    ctx.positional = ['solo']
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual(['solo'])
  })
  // docker: set -- "a b" c; for a in $@; do echo "[$a]"; done => [a] [b] [c]
  it('비따옴표 $@ 는 인자 내부 공백까지 단어분할한다', async () => {
    ctx.positional = ['a b', 'c']
    expect(await expandWord(wordOf('$@'), ctx)).toEqual(['a', 'b', 'c'])
  })
  // docker: set --; for a in "$*"; do echo "[$a]"; done => [] (빈 단어 하나 — "$@" 와 다름)
  it('"$*" 는 인자가 없어도 빈 단어 하나를 남긴다 ("$@" 와 달리 사라지지 않는다)', async () => {
    ctx.positional = []
    expect(await expandWord(wordOf('"$*"'), ctx)).toEqual([''])
  })
})

describe('expandWord — env IFS (task 5, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // docker: IFS=:; set -- "x:y:z"; for a in $1; do echo "[$a]"; done => [x] [y] [z]
  it('IFS=: 이면 비따옴표 확장을 : 에서 쪼갠다', async () => {
    ctx.env.IFS = ':'
    ctx.env.V = 'x:y:z'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['x', 'y', 'z'])
  })
  // docker: IFS=:; set -- a b c; echo "$*" => a:b:c
  it('IFS=: 이면 "$*" 를 : 로 조인한다', async () => {
    ctx.env.IFS = ':'
    ctx.positional = ['a', 'b', 'c']
    expect(await expandWord(wordOf('"$*"'), ctx)).toEqual(['a:b:c'])
  })
  // docker: IFS=,; set -- a b c; echo "$*" => a,b,c
  it('IFS=, 이면 "$*" 를 , 로 조인한다', async () => {
    ctx.env.IFS = ','
    ctx.positional = ['a', 'b', 'c']
    expect(await expandWord(wordOf('"$*"'), ctx)).toEqual(['a,b,c'])
  })
  // docker: IFS=xyz; set -- a b c; echo "$*" => axbxc (IFS 의 첫 글자로 조인)
  it('"$*" 조인 문자는 IFS 의 첫 글자다', async () => {
    ctx.env.IFS = 'xyz'
    ctx.positional = ['a', 'b', 'c']
    expect(await expandWord(wordOf('"$*"'), ctx)).toEqual(['axbxc'])
  })
  // docker: IFS=; set -- a b; for a in "$@"; do echo "[$a]"; done => [a] [b] ("$@" 는 IFS 무관)
  it('IFS 가 빈 문자열이어도 "$@" 는 여전히 인자별 개별 필드다', async () => {
    ctx.env.IFS = ''
    ctx.positional = ['a', 'b']
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual(['a', 'b'])
  })
  // docker: IFS=; x="a b"; for a in $x; do echo "[$a]"; done => [a b] (분할 안 함)
  it('IFS 가 빈 문자열이면 비따옴표 확장을 전혀 쪼개지 않는다', async () => {
    ctx.env.IFS = ''
    ctx.env.V = 'a b'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a b'])
  })
  // docker: IFS=; set -- a b c; echo "[$*]" => [abc] (빈 IFS → 분리자 없이 이어붙임)
  it('IFS 가 빈 문자열이면 "$*" 는 분리자 없이 인자를 이어붙인다', async () => {
    ctx.env.IFS = ''
    ctx.positional = ['a', 'b', 'c']
    expect(await expandWord(wordOf('"$*"'), ctx)).toEqual(['abc'])
  })
  // docker: IFS=:; set -- "a:b" c; for a in $@; do echo "[$a]"; done => [a] [b] [c]
  it('IFS=: 이면 비따옴표 $@ 도 조인 후 : 로 재분할된다', async () => {
    ctx.env.IFS = ':'
    ctx.positional = ['a:b', 'c']
    expect(await expandWord(wordOf('$@'), ctx)).toEqual(['a', 'b', 'c'])
  })
  it('IFS=: 이면 "${*}" (중괄호 조인형) 도 : 로 조인한다', async () => {
    ctx.env.IFS = ':'
    ctx.positional = ['a', 'b']
    expect(await expandWord(wordOf('"${*}"'), ctx)).toEqual(['a:b'])
  })
  it('기본 IFS(미설정)에서 tab/newline 도 단어분할 대상이다', async () => {
    ctx.env.V = 'a\tb\nc'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a', 'b', 'c'])
  })
  // docker: IFS=:; echo a:b:c => a:b:c (리터럴 소스 문자는 확장 결과가 아니라 분할 안 됨)
  it('IFS=: 이어도 리터럴 소스 텍스트는 분할되지 않는다 (확장 결과만 분할)', async () => {
    ctx.env.IFS = ':'
    expect(await expandWord(wordOf('a:b:c'), ctx)).toEqual(['a:b:c'])
  })
  it('IFS=: 이어도 따옴표 안 확장은 분할되지 않는다', async () => {
    ctx.env.IFS = ':'
    ctx.env.V = 'x:y:z'
    expect(await expandWord(wordOf('"$V"'), ctx)).toEqual(['x:y:z'])
  })
})

describe('expandWord — "$@" 빈 인자 & 리뷰 수정 (task 5 fix, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // Issue 1: 인자가 하나라도 있으면(빈 문자열이라도) 개별 필드를 남긴다. zero-arg 만 사라진다.
  // docker: f(){ for w in "$@"; do echo "[$w]"; done; }; f "" => [] (빈 필드 하나)
  it('"$@" 인자가 하나뿐인 빈 문자열이면 빈 필드 하나를 남긴다', async () => {
    ctx.positional = ['']
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual([''])
  })
  // docker: f "" "" => [][] (빈 필드 둘)
  it('"$@" 빈 인자 여러 개면 각각 빈 필드로 남는다', async () => {
    ctx.positional = ['', '']
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual(['', ''])
  })
  // docker: f a "" b => [a][][b]
  it('"$@" 중간 빈 인자도 개별 빈 필드로 보존한다', async () => {
    ctx.positional = ['a', '', 'b']
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual(['a', '', 'b'])
  })
  it('회귀: "$@" zero-arg 는 여전히 통째로 사라진다', async () => {
    ctx.positional = []
    expect(await expandWord(wordOf('"$@"'), ctx)).toEqual([])
  })

  // Issue 2: 단일 문자열 문맥(expandForCase)의 "$@" 는 스페이스로 조인한다 (IFS 첫 글자 아님).
  // docker: IFS=:; x="$@" => a b c (콜론 아님). "$*" 만 IFS 첫 글자.
  it('expandForCase 의 "$@" 는 스페이스로 조인한다 (대입/case subject 문맥)', async () => {
    ctx.positional = ['a', 'b', 'c']
    expect(await expandForCase(wordOf('"$@"'), ctx)).toBe('a b c')
  })
  it('expandForCase 의 "$@" 는 IFS=: 여도 스페이스로 조인한다 ("$*" 와 다름)', async () => {
    ctx.env.IFS = ':'
    ctx.positional = ['a', 'b', 'c']
    expect(await expandForCase(wordOf('"$@"'), ctx)).toBe('a b c')
    expect(await expandForCase(wordOf('"$*"'), ctx)).toBe('a:b:c') // "$*" 는 IFS 첫 글자
  })
  it('expandForCase 의 "$@" 빈 중간 인자는 스페이스 둘로 나타난다', async () => {
    ctx.positional = ['a', '', 'c']
    expect(await expandForCase(wordOf('"$@"'), ctx)).toBe('a  c')
  })

  // Issue 3: 비공백 IFS 는 빈 필드를 보존한다(POSIX). 공백 IFS 는 접는다(기존 유지).
  // docker: IFS=:; v="a::b"; for w in $v => [a][][b]
  it('IFS=: 인접 구분자는 빈 필드를 만든다 (a::b → a,"",b)', async () => {
    ctx.env.IFS = ':'
    ctx.env.V = 'a::b'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a', '', 'b'])
  })
  // docker: :a:b → [][a][b]
  it('IFS=: 선행 구분자는 선행 빈 필드를 만든다 (:a:b)', async () => {
    ctx.env.IFS = ':'
    ctx.env.V = ':a:b'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['', 'a', 'b'])
  })
  // docker: a:b: → [a][b] (후행 구분자 하나는 빈 필드 안 더함)
  it('IFS=: 후행 구분자 하나는 빈 필드를 더하지 않는다 (a:b:)', async () => {
    ctx.env.IFS = ':'
    ctx.env.V = 'a:b:'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a', 'b'])
  })
  // docker: a:::b → [a][][][b]
  it('IFS=: 연속 구분자 N개는 N-1 빈 필드 (a:::b)', async () => {
    ctx.env.IFS = ':'
    ctx.env.V = 'a:::b'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a', '', '', 'b'])
  })
  // docker: IFS=" :"; a : b → [a][b] (콜론 주변 공백은 흡수되어 한 구분자)
  it('혼합 IFS(" :")는 공백을 흡수 — a : b → a,b (빈 필드 없음)', async () => {
    ctx.env.IFS = ' :'
    ctx.env.V = 'a : b'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a', 'b'])
  })
  // docker: IFS=" :"; a:  :b → [a][][b]
  it('혼합 IFS: 비공백 구분자 둘이면 빈 필드 (a:  :b → a,"",b)', async () => {
    ctx.env.IFS = ' :'
    ctx.env.V = 'a:  :b'
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a', '', 'b'])
  })
  it('회귀: 기본 공백 IFS 는 연속 공백을 접고 앞뒤를 자른다 (변경 없음)', async () => {
    ctx.env.V = '  a  b  '
    expect(await expandWord(wordOf('$V'), ctx)).toEqual(['a', 'b'])
  })
})

describe('expandWord — 파라미터 확장: 길이 (task 3)', () => {
  // docker: NAME=world; echo ${#NAME} => 5
  it('${#NAME} 은 값의 길이', async () => {
    expect(await expandWord(wordOf('${#NAME}'), ctx)).toEqual(['5'])
  })
  it('${#EMPTY} 는 0', async () => {
    expect(await expandWord(wordOf('${#EMPTY}'), ctx)).toEqual(['0'])
  })
  it('${#UNSET} 은 0 (미설정 변수)', async () => {
    expect(await expandWord(wordOf('${#UNSET}'), ctx)).toEqual(['0'])
  })
  it('${#} 와 ${#@} / ${#*} 는 위치 인자 개수 ($# 과 동일)', async () => {
    ctx.positional = ['a', 'b', 'c']
    expect(await expandWord(wordOf('${#}'), ctx)).toEqual(['3'])
    expect(await expandWord(wordOf('${#@}'), ctx)).toEqual(['3'])
    expect(await expandWord(wordOf('${#*}'), ctx)).toEqual(['3'])
  })
})

describe('expandWord — 파라미터 확장: 기본값/대체 (task 3, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // docker: NAME=world; EMPTY=; echo "${#NAME} ${UNSET:-fb} ${EMPTY:-fb} ${EMPTY-fb}" => 5 fb fb (빈줄)
  it('${UNSET:-fb} 는 미설정이면 fb', async () => {
    expect(await expandWord(wordOf('${UNSET:-fb}'), ctx)).toEqual(['fb'])
  })
  it('${NAME:-fb} 는 설정돼 있으면 원래 값', async () => {
    expect(await expandWord(wordOf('${NAME:-fb}'), ctx)).toEqual(['world'])
  })
  it('${EMPTY:-fb} 는 `:-` 라 빈 값도 미설정 취급 → fb', async () => {
    expect(await expandWord(wordOf('${EMPTY:-fb}'), ctx)).toEqual(['fb'])
  })
  it('${EMPTY-fb} 는 `-` 뿐이라 빈 값은 미설정이 아님 → 빈 문자열(단어 사라짐 없음, 값 자체가 "")', async () => {
    expect(await expandWord(wordOf('"${EMPTY-fb}"'), ctx)).toEqual([''])
  })
  it('${UNSET-fb} 는 미설정이므로 fb', async () => {
    expect(await expandWord(wordOf('${UNSET-fb}'), ctx)).toEqual(['fb'])
  })

  it('${UNSET:=def} 는 def 로 치환되고 ctx.env 에도 대입된다', async () => {
    expect(await expandWord(wordOf('${UNSET:=def}'), ctx)).toEqual(['def'])
    expect(ctx.env.UNSET).toBe('def')
  })
  it('${NAME:=def} 는 이미 설정돼 있으므로 대입하지 않는다', async () => {
    expect(await expandWord(wordOf('${NAME:=def}'), ctx)).toEqual(['world'])
    expect(ctx.env.NAME).toBe('world')
  })

  it('${NAME:+alt} 는 설정+비어있지 않으므로 alt', async () => {
    expect(await expandWord(wordOf('${NAME:+alt}'), ctx)).toEqual(['alt'])
  })
  it('${UNSET:+alt} 는 미설정이므로 빈 문자열(단어 사라짐)', async () => {
    expect(await expandWord(wordOf('${UNSET:+alt}'), ctx)).toEqual([])
  })
  it('${EMPTY:+alt} 는 `:+` 라 빈 값도 대상 → 빈 문자열(단어 사라짐)', async () => {
    expect(await expandWord(wordOf('${EMPTY:+alt}'), ctx)).toEqual([])
  })

  it('arg 는 재확장 대상이다: ${UNSET:-$NAME} → world', async () => {
    expect(await expandWord(wordOf('${UNSET:-$NAME}'), ctx)).toEqual(['world'])
  })
  it('중첩 ${...} 도 arg 재확장으로 풀린다: ${UNSET:-${NAME}}', async () => {
    expect(await expandWord(wordOf('${UNSET:-${NAME}}'), ctx)).toEqual(['world'])
  })

  it('따옴표 없는 arg 안의 공백은 확장 뒤 단어분할된다: ${UNSET:-a b} → [a, b]', async () => {
    // 렉서가 ${...} 를 원자적으로 캡처해야(공백을 안 흘려야) 여기까지 온전히 도달한다.
    // 확장 결과 "a b" 는 unprotected 라 splitFields 가 나눈다 — $(echo a b) 와 같은 흐름.
    expect(await expandWord(wordOf('${UNSET:-a b}'), ctx)).toEqual(['a', 'b'])
  })
  it('큰따옴표 안이면 arg 공백은 분할되지 않는다: "${UNSET:-a b}" → [a b] (회귀)', async () => {
    expect(await expandWord(wordOf('"${UNSET:-a b}"'), ctx)).toEqual(['a b'])
  })
  it('중첩 arg 에 공백이 섞여도 온전히 처리: ${UNSET:-${NAME} x} → [world, x]', async () => {
    expect(await expandWord(wordOf('${UNSET:-${NAME} x}'), ctx)).toEqual(['world', 'x'])
  })

  it('회귀: 연산자 없는 ${NAME} 은 그대로 동작', async () => {
    expect(await expandWord(wordOf('${NAME}'), ctx)).toEqual(['world'])
  })
  it('회귀: 위치 매개변수 ${1} 은 그대로 동작', async () => {
    ctx.positional = ['x']
    expect(await expandWord(wordOf('${1}'), ctx)).toEqual(['x'])
  })
})

describe('expandWord — 파라미터 확장: ${name:?word} 오류 경로 (task 3)', () => {
  // docker: unset U; echo ${U:?boom} => stderr "bash: line 1: U: boom", 스크립트 전체가
  // fatal 로 죽는다(non-interactive bash 실제 동작) — 이 서브셋은 그렇게까지는 안 가고
  // (Task 1의 ArithError 와 같은 패턴) 이 명령 하나만 실패로 처리한다(문서화된 단순화).
  it('${UNSET:?boom} 은 expandWord 를 던진다(reject) — interpreter 가 ExecResult 로 바꾼다', async () => {
    await expect(expandWord(wordOf('${UNSET:?boom}'), ctx)).rejects.toThrow(/UNSET: boom/)
  })
  it('메시지 없으면 기본 메시지(콜론 있음: parameter null or not set)', async () => {
    await expect(expandWord(wordOf('${UNSET:?}'), ctx)).rejects.toThrow(/parameter null or not set/)
  })
  it('콜론 없는 ${UNSET?} 도 기본 메시지는 다르다(parameter not set, null 없음)', async () => {
    await expect(expandWord(wordOf('${UNSET?}'), ctx)).rejects.toThrow(/UNSET: parameter not set/)
  })
  it('설정돼 있으면 에러 없이 값을 낸다', async () => {
    expect(await expandWord(wordOf('${NAME:?boom}'), ctx)).toEqual(['world'])
  })
})

describe('expandWord — 파라미터 확장: 접두/접미 패턴 제거 (task 4, docker debian:stable-slim bash 5 로 확인됨)', () => {
  beforeEach(() => {
    ctx.env.F = 'a.b.txt'
    ctx.env.P = '/a/b/c'
  })
  // docker: F=a.b.txt; echo ${F%.txt} ${F##*.} ${F#*.} => a.b txt b.txt
  it('${F%.txt} 는 최短 접미(리터럴) 제거 → a.b', async () => {
    expect(await expandWord(wordOf('${F%.txt}'), ctx)).toEqual(['a.b'])
  })
  it('${F%%.*} 는 최長 접미 제거(첫 . 부터 끝까지) → a', async () => {
    expect(await expandWord(wordOf('${F%%.*}'), ctx)).toEqual(['a'])
  })
  it('${F#*.} 는 최短 접두 제거(첫 . 까지) → b.txt', async () => {
    expect(await expandWord(wordOf('${F#*.}'), ctx)).toEqual(['b.txt'])
  })
  it('${F##*.} 는 최長 접두 제거(마지막 . 까지) → txt', async () => {
    expect(await expandWord(wordOf('${F##*.}'), ctx)).toEqual(['txt'])
  })
  // docker: P=/a/b/c; echo ${P##*/} ${P%/*} => c /a/b
  it('${P##*/} 는 basename → c', async () => {
    expect(await expandWord(wordOf('${P##*/}'), ctx)).toEqual(['c'])
  })
  it('${P%/*} 는 dirname → /a/b', async () => {
    expect(await expandWord(wordOf('${P%/*}'), ctx)).toEqual(['/a/b'])
  })
  // docker: echo ${F%.zzz} => a.b.txt (매치 없음 — no-op)
  it('매치가 없으면 원본 그대로(no-op)', async () => {
    expect(await expandWord(wordOf('${F%.zzz}'), ctx)).toEqual(['a.b.txt'])
    expect(await expandWord(wordOf('${F#zzz}'), ctx)).toEqual(['a.b.txt'])
  })
  // docker: H=.hidden.txt; echo ${H#*.} ${H##*.} ${H%.*} => hidden.txt txt .hidden
  it('선행 점 보호를 받지 않는다 — 경로명 글롭이 아니라 문자열 패턴이다', async () => {
    ctx.env.H = '.hidden.txt'
    expect(await expandWord(wordOf('${H#*.}'), ctx)).toEqual(['hidden.txt'])
    expect(await expandWord(wordOf('${H##*.}'), ctx)).toEqual(['txt'])
    expect(await expandWord(wordOf('${H%.*}'), ctx)).toEqual(['.hidden'])
  })
  it('빈 패턴은 no-op', async () => {
    expect(await expandWord(wordOf('${F#}'), ctx)).toEqual(['a.b.txt'])
  })
  it('패턴은 재확장 대상이다: ${F#$P2} (변수에서 나온 패턴)', async () => {
    ctx.env.P2 = '*.'
    expect(await expandWord(wordOf('${F#$P2}'), ctx)).toEqual(['b.txt'])
  })
  it('미설정 변수에 적용해도 크래시 없이 빈 문자열 그대로', async () => {
    expect(await expandWord(wordOf('${UNSET#*.}'), ctx)).toEqual([])
  })
})

describe('expandWord — 파라미터 확장: 패턴 치환 (task 4, docker debian:stable-slim bash 5 로 확인됨)', () => {
  // docker: S=hello; echo ${S/l/L} ${S//l/L} ${S/#he/HE} ${S/%lo/LO} ${S//l/}
  //   => heLlo heLLo HEllo helLO heo
  it('${S/l/L} 은 첫 매치만 치환', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S/l/L}'), ctx)).toEqual(['heLlo'])
  })
  it('${S//l/L} 은 전체 매치를 치환', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S//l/L}'), ctx)).toEqual(['heLLo'])
  })
  it('${S/#he/HE} 는 시작 지점 고정 매치', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S/#he/HE}'), ctx)).toEqual(['HEllo'])
  })
  it('${S/%lo/LO} 는 끝 지점 고정 매치', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S/%lo/LO}'), ctx)).toEqual(['helLO'])
  })
  it('${S//l/} 는 빈 rep — 전체 삭제', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S//l/}'), ctx)).toEqual(['heo'])
  })
  it('매치가 없으면 원본 그대로 (기본형/anchored 전부)', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S/nomatch/Y}'), ctx)).toEqual(['hello'])
    expect(await expandWord(wordOf('${S/#nomatch/Y}'), ctx)).toEqual(['hello'])
    expect(await expandWord(wordOf('${S/%nomatch/Y}'), ctx)).toEqual(['hello'])
  })
  // docker: echo ${S/l*/X} ${S/*l/X} => heX Xo — leftmost-longest 글롭 매치
  it('leftmost-longest: ${S/l*/X} 는 pos=2 에서 "llo" 전체를 삼킨다', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S/l*/X}'), ctx)).toEqual(['heX'])
  })
  it('leftmost-longest: ${S/*l/X} 는 pos=0 에서 "hell" 을 삼킨다(마지막 l 까지)', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S/*l/X}'), ctx)).toEqual(['Xo'])
  })
  it('${S/?/X} 는 한 글자만, ${S//?/X} 는 전부', async () => {
    ctx.env.S = 'hello'
    expect(await expandWord(wordOf('${S/?/X}'), ctx)).toEqual(['Xello'])
    expect(await expandWord(wordOf('${S//?/X}'), ctx)).toEqual(['XXXXX'])
  })
  // docker: R=banana; echo ${R/an/X} ${R//an/X} => bXana bXXa (전체는 비중첩 순차 매치)
  it('전체 치환은 비중첩·왼쪽부터 순차 진행', async () => {
    ctx.env.R = 'banana'
    expect(await expandWord(wordOf('${R/an/X}'), ctx)).toEqual(['bXana'])
    expect(await expandWord(wordOf('${R//an/X}'), ctx)).toEqual(['bXXa'])
  })
  it('pat/rep 는 재확장 대상이다: ${S/$a/$b}', async () => {
    ctx.env.S = 'hello'
    ctx.env.a = 'l'
    ctx.env.b = 'L'
    expect(await expandWord(wordOf('${S/$a/$b}'), ctx)).toEqual(['heLlo'])
  })
  it('미설정 변수에 적용해도 크래시 없이 빈 문자열', async () => {
    expect(await expandWord(wordOf('${UNSET/x/y}'), ctx)).toEqual([])
  })
})

describe('expandWord — 파라미터 확장: 부분문자열 (task 4, docker debian:stable-slim bash 5 로 확인됨)', () => {
  beforeEach(() => { ctx.env.S = 'hello' })

  // docker: S=hello; echo ${S:1:3} ${S:2} "${S: -2}" ${S:1:-1} => ell llo lo ell
  it('${S:1:3} 은 offset 1, length 3', async () => {
    expect(await expandWord(wordOf('${S:1:3}'), ctx)).toEqual(['ell'])
  })
  it('${S:2} 는 length 생략 — 끝까지', async () => {
    expect(await expandWord(wordOf('${S:2}'), ctx)).toEqual(['llo'])
  })
  it('${S: -2} 는 음수 offset(공백 필요) — 끝에서부터', async () => {
    expect(await expandWord(wordOf('${S: -2}'), ctx)).toEqual(['lo'])
  })
  it('${S:(-2)} 는 괄호로도 음수 offset 을 명확히 할 수 있다', async () => {
    expect(await expandWord(wordOf('${S:(-2)}'), ctx)).toEqual(['lo'])
  })
  it('${S:1:-1} 은 음수 length — 끝에서 1 뺀 위치까지', async () => {
    expect(await expandWord(wordOf('${S:1:-1}'), ctx)).toEqual(['ell'])
  })
  // docker: echo ${S:-2} => hello (S 가 설정돼 있으므로 `:-` 기본값 연산자가 이김,
  // substring 이 아니다 — 공백/괄호 없는 음수 offset 은 항상 `:-` 로 먼저 소비된다)
  it('공백 없는 ${S:-2} 는 substring 이 아니라 `:-` 기본값 연산자 — S 가 설정돼 있으므로 그대로 hello', async () => {
    expect(await expandWord(wordOf('${S:-2}'), ctx)).toEqual(['hello'])
  })
  it('offset/length 는 산술식이다(evalArith 재사용): ${S:1+1:1+1}', async () => {
    expect(await expandWord(wordOf('${S:1+1:1+1}'), ctx)).toEqual(['ll'])
  })
  // docker: echo ${S:0:100} ${S:100} ${S:100:2} => hello (빈줄) (빈줄) — clamp, 범위 밖은 빈 문자열
  it('length 가 문자열 길이를 넘으면 clamp', async () => {
    expect(await expandWord(wordOf('${S:0:100}'), ctx)).toEqual(['hello'])
  })
  it('offset 이 문자열 길이를 넘으면 빈 문자열(에러 아님)', async () => {
    expect(await expandWord(wordOf('${S:100}'), ctx)).toEqual([])
    expect(await expandWord(wordOf('${S:100:2}'), ctx)).toEqual([])
  })
  // docker: echo "${S: -100}" "${S: -6}" "${S: -5}" => (빈줄) (빈줄) hello — 음수 offset이
  // 왼쪽으로 넘치면 그냥 빈 문자열(에러 아님), 정확히 0 이면 전체
  it('음수 offset 이 문자열 시작보다 왼쪽으로 넘치면 빈 문자열(에러 아님)', async () => {
    expect(await expandWord(wordOf('"${S: -100}"'), ctx)).toEqual([''])
    expect(await expandWord(wordOf('"${S: -6}"'), ctx)).toEqual([''])
  })
  it('음수 offset 이 정확히 0 이 되면 전체 문자열', async () => {
    expect(await expandWord(wordOf('${S: -5}'), ctx)).toEqual(['hello'])
  })
  // docker: echo "${S:6:-1}" => (빈줄), exit 0 — offset(6) > len(5) 라 length 검사 전에
  // 조기 반환된다(length 오류조차 안 낸다)
  it('offset 이 이미 범위 밖이면 length 오류 검사 없이 그냥 빈 문자열', async () => {
    expect(await expandWord(wordOf('"${S:6:-1}"'), ctx)).toEqual([''])
  })
  it('음수 length 라도 구간이 뒤집히지 않으면(end===offset) 그냥 빈 문자열(에러 아님): ${S:2:-3}', async () => {
    expect(await expandWord(wordOf('"${S:2:-3}"'), ctx)).toEqual([''])
  })
  // docker: echo ${S:0:-100} => bash: line 1: -100: substring expression < 0 (해당 명령만
  // 실패, 실제 bash 는 스크립트 전체가 죽지만 이 서브셋은 task 1/3 의 기존 단순화를 따라
  // 이 명령 하나만 실패시킨다)
  it('음수 length 로 구간이 뒤집히면(end<offset) ArithError 를 던진다(task1/3 과 같은 계약)', async () => {
    await expect(expandWord(wordOf('${S:0:-100}'), ctx)).rejects.toThrow(/substring expression < 0/)
  })
  it('미설정 변수의 substring 은 크래시 없이 빈 문자열', async () => {
    expect(await expandWord(wordOf('${UNSET:1:2}'), ctx)).toEqual([])
  })
})

describe('expandForCase (task 6) — case 문의 WORD/PATTERN 전용 확장', () => {
  // expandWord 와 달리 단어분리(IFS)도 파일시스템 글롭(expandGlob)도 하지 않는다 —
  // 문자열 하나만 낸다(case 패턴은 matchSegment 로 별도 매칭한다).
  it('변수 확장은 하지만 IFS 로 쪼개지 않는다 — 공백 포함 문자열 하나', async () => {
    expect(await expandForCase(wordOf('$X'), ctx)).toBe('a b') // X='a b' (beforeEach)
  })

  it('따옴표 없는 글롭 메타문자를 파일시스템에 대해 펼치지 않는다 (expandWord 와의 핵심 차이)', async () => {
    // ctx.cwd 인 /w 에는 a.txt/b.txt 가 있다 — expandWord 라면 ['a.txt','b.txt'] 로
    // 펼쳐지지만(글롭 섹션 테스트 참고), case 패턴은 그 확장을 받으면 안 된다.
    expect(await expandForCase(wordOf('*.txt'), ctx)).toBe('*.txt')
  })

  it('$var 안의 글롭 메타문자는 문자열로 살아남는다 (나중에 matchSegment 가 와일드카드로 해석) — docker 로 실제 bash 와 일치 확인', async () => {
    // docker: p="a*"; case abc in $p) echo match;; *) echo no;; esac → match
    ctx.env.P = 'a*'
    expect(await expandForCase(wordOf('$P'), ctx)).toBe('a*')
  })

  it('따옴표는 제거되지만(quote removal) 글롭 메타 여부는 추적하지 않는다 (문서화된 단순화, 실제 bash와 다름)', async () => {
    // docker: case xyz in "*") echo lit;; *) echo other;; esac → other (진짜 bash는
    // 따옴표로 감싼 * 를 리터럴화한다). 우리는 quoted 여부를 안 실어서 여전히
    // 와일드카드로 해석된다 — 브리프가 명시한 "keep it simple" 단순화.
    expect(await expandForCase(wordOf(`"*"`), ctx)).toBe('*')
  })

  it('빈 단어는 빈 문자열이다 (미설정 변수라도 단어 자체가 사라지지 않는다)', async () => {
    expect(await expandForCase(wordOf('$NOPE'), ctx)).toBe('')
  })

  it('명령치환도 그대로 지원한다', async () => {
    expect(await expandForCase(wordOf('$(echo hi)'), ctx)).toBe('<echo hi>') // runSubshell 목 스텁 (beforeEach)
  })
})

describe('expandWord — 배열 읽기 (task 3, M3 Part 3, docker debian:stable-slim bash 5.2 로 확인됨)', () => {
  beforeEach(() => { ctx.arrays.set('arr', ['a', 'b', 'c']) })

  it('${arr[0]}/${arr[2]} 는 원소, ${arr[9]} 미설정 인덱스는 빈 문자열이라 단어가 사라진다', async () => {
    expect(await expandWord(wordOf('${arr[0]}'), ctx)).toEqual(['a'])
    expect(await expandWord(wordOf('${arr[2]}'), ctx)).toEqual(['c'])
    expect(await expandWord(wordOf('${arr[9]}'), ctx)).toEqual([]) // 빈 → 단어 소멸
    expect(await expandWord(wordOf('x${arr[9]}y'), ctx)).toEqual(['xy'])
  })

  it('${arr[@]} 비따옴표는 단어분할되어 a b c 세 필드', async () => {
    expect(await expandWord(wordOf('${arr[@]}'), ctx)).toEqual(['a', 'b', 'c'])
  })

  it('"${arr[@]}" 는 각 원소를 개별 필드로 보존 (printf "[%s]" → [a][b][c])', async () => {
    expect(await expandWord(wordOf('"${arr[@]}"'), ctx)).toEqual(['a', 'b', 'c'])
  })

  it('"${arr[*]}" 는 IFS[0] 로 조인한 단일 필드; IFS=, 면 a,b,c', async () => {
    expect(await expandWord(wordOf('"${arr[*]}"'), ctx)).toEqual(['a b c'])
    ctx.env.IFS = ','
    expect(await expandWord(wordOf('"${arr[*]}"'), ctx)).toEqual(['a,b,c'])
  })

  it('비따옴표 ${arr[*]} 는 조인 후 단어분할 → a b c', async () => {
    expect(await expandWord(wordOf('${arr[*]}'), ctx)).toEqual(['a', 'b', 'c'])
  })

  it('${#arr[@]} 는 설정 원소 개수(3), ${#arr[1]} 는 원소 문자열 길이(1)', async () => {
    expect(await expandWord(wordOf('${#arr[@]}'), ctx)).toEqual(['3'])
    expect(await expandWord(wordOf('${#arr[*]}'), ctx)).toEqual(['3'])
    expect(await expandWord(wordOf('${#arr[1]}'), ctx)).toEqual(['1'])
  })

  it('${#arr[0]} 는 원소0 길이 (arr=(hello) → 5)', async () => {
    ctx.arrays.set('h', ['hello'])
    expect(await expandWord(wordOf('${#h[0]}'), ctx)).toEqual(['5'])
  })

  it('${!arr[@]} 는 인덱스(키) 목록 0 1 2', async () => {
    expect(await expandWord(wordOf('${!arr[@]}'), ctx)).toEqual(['0', '1', '2'])
  })

  it('"${!arr[@]}" 는 각 키를 개별 필드로, "${!arr[*]}" 는 IFS 조인', async () => {
    expect(await expandWord(wordOf('"${!arr[@]}"'), ctx)).toEqual(['0', '1', '2'])
    expect(await expandWord(wordOf('"${!arr[*]}"'), ctx)).toEqual(['0 1 2'])
  })

  it('${arr[@]:1:2} 는 원소 리스트 슬라이스(offset1 len2) → b c, ${arr[@]:1} → b c', async () => {
    expect(await expandWord(wordOf('${arr[@]:1:2}'), ctx)).toEqual(['b', 'c'])
    expect(await expandWord(wordOf('${arr[@]:1}'), ctx)).toEqual(['b', 'c'])
  })

  it('"${arr[@]:1:2}" 슬라이스도 per-arg (printf "[%s]" → [b][c])', async () => {
    expect(await expandWord(wordOf('"${arr[@]:1:2}"'), ctx)).toEqual(['b', 'c'])
  })

  it('${arr[*]:1:2} 는 슬라이스 후 조인 → b c (한 필드, 따옴표 시)', async () => {
    expect(await expandWord(wordOf('"${arr[*]:1:2}"'), ctx)).toEqual(['b c'])
  })

  it('bare $arr 와 ${arr} 는 원소 0 (a)', async () => {
    expect(await expandWord(wordOf('$arr'), ctx)).toEqual(['a'])
    expect(await expandWord(wordOf('${arr}'), ctx)).toEqual(['a'])
    expect(await expandWord(wordOf('${#arr}'), ctx)).toEqual(['1']) // 원소0 길이
  })

  it('bare $arr[0] 은 중괄호 없으면 첨자가 아니라 리터럴 (a[0])', async () => {
    // docker: arr=(a b c); echo $arr[0] → a[0]
    expect(await expandWord(wordOf('$arr[0]'), ctx)).toEqual(['a[0]'])
  })

  it('산술 첨자: i=2 → ${arr[$i]}=c, ${arr[i-1]}(i=2)=b, ${arr[i+1]}(i=0)', async () => {
    ctx.env.i = '2'
    expect(await expandWord(wordOf('${arr[$i]}'), ctx)).toEqual(['c'])
    expect(await expandWord(wordOf('${arr[i-1]}'), ctx)).toEqual(['b'])
    ctx.env.i = '0'
    expect(await expandWord(wordOf('${arr[i+1]}'), ctx)).toEqual(['b'])
  })

  it('음수 첨자는 끝에서부터: ${arr[-1]}=c, ${arr[-2]}=b, out-of-range ${arr[-9]} 는 빈(크래시 없음)', async () => {
    expect(await expandWord(wordOf('${arr[-1]}'), ctx)).toEqual(['c'])
    expect(await expandWord(wordOf('${arr[-2]}'), ctx)).toEqual(['b'])
    expect(await expandWord(wordOf('x${arr[-9]}y'), ctx)).toEqual(['xy'])
  })
})

describe('expandWord — 배열 SPARSE (task 3, docker 확인)', () => {
  // arr=(a b c); arr[5]=z → 인덱스 3,4 는 진짜 hole
  function sparse(): string[] { const a = ['a', 'b', 'c']; a[5] = 'z'; return a }
  beforeEach(() => { ctx.arrays.set('arr', sparse()) })

  it('${arr[@]} 는 홀을 건너뛴다 → a b c z', async () => {
    expect(await expandWord(wordOf('${arr[@]}'), ctx)).toEqual(['a', 'b', 'c', 'z'])
    expect(await expandWord(wordOf('"${arr[@]}"'), ctx)).toEqual(['a', 'b', 'c', 'z'])
  })

  it('${#arr[@]} 는 설정 개수(4), 길이(6) 아님', async () => {
    expect(await expandWord(wordOf('${#arr[@]}'), ctx)).toEqual(['4'])
  })

  it('${!arr[@]} 는 설정 인덱스만 → 0 1 2 5', async () => {
    expect(await expandWord(wordOf('${!arr[@]}'), ctx)).toEqual(['0', '1', '2', '5'])
  })

  it('${arr[3]} 홀은 빈 문자열, 음수 첨자는 최대인덱스+1 기준: ${arr[-1]}=z, ${arr[-2]}=hole', async () => {
    expect(await expandWord(wordOf('x${arr[3]}y'), ctx)).toEqual(['xy'])
    expect(await expandWord(wordOf('${arr[-1]}'), ctx)).toEqual(['z'])
    expect(await expandWord(wordOf('x${arr[-2]}y'), ctx)).toEqual(['xy'])
  })
})

describe('expandWord — 배열 미정의/스칼라 parity (task 3, docker 확인)', () => {
  it('미정의 배열: ${u[@]} 빈, ${#u[@]} 0, ${u[0]} 빈', async () => {
    expect(await expandWord(wordOf('${u[@]}'), ctx)).toEqual([])
    expect(await expandWord(wordOf('${#u[@]}'), ctx)).toEqual(['0'])
    expect(await expandWord(wordOf('x${u[0]}y'), ctx)).toEqual(['xy'])
  })

  it('"${u[@]}" 빈 배열은 필드조차 안 남긴다 ("$@" zero-arg parity)', async () => {
    // docker: u=(); set -- "${u[@]}"; echo $# → 0
    expect(await expandWord(wordOf('"${u[@]}"'), ctx)).toEqual([])
    expect(await expandWord(wordOf('"x${u[@]}y"'), ctx)).toEqual(['xy'])
  })

  it('스칼라는 1-원소 배열처럼: x=hello → ${x[0]}=hello, ${x[@]}=hello, ${#x[@]}=1, ${!x[@]}=0', async () => {
    ctx.env.x = 'hello'
    expect(await expandWord(wordOf('${x[0]}'), ctx)).toEqual(['hello'])
    expect(await expandWord(wordOf('${x[@]}'), ctx)).toEqual(['hello'])
    expect(await expandWord(wordOf('"${x[@]}"'), ctx)).toEqual(['hello'])
    expect(await expandWord(wordOf('${x[*]}'), ctx)).toEqual(['hello'])
    expect(await expandWord(wordOf('${#x[@]}'), ctx)).toEqual(['1'])
    expect(await expandWord(wordOf('${!x[@]}'), ctx)).toEqual(['0'])
    expect(await expandWord(wordOf('x${x[1]}y'), ctx)).toEqual(['xy']) // 인덱스1 미설정
  })
})

describe('expandWord — 배열 인용/분할 (공백 낀 원소, task 3, docker 확인)', () => {
  beforeEach(() => { ctx.arrays.set('arr', ['x y', 'z']) })

  it('"${arr[@]}" 는 공백 낀 원소를 한 필드로 유지 → [x y][z]', async () => {
    expect(await expandWord(wordOf('"${arr[@]}"'), ctx)).toEqual(['x y', 'z'])
  })

  it('비따옴표 ${arr[@]} 는 공백 낀 원소를 단어분할 → [x][y][z]', async () => {
    expect(await expandWord(wordOf('${arr[@]}'), ctx)).toEqual(['x', 'y', 'z'])
  })

  it('"${arr[*]}" 는 조인 → [x y z] 한 필드', async () => {
    expect(await expandWord(wordOf('"${arr[*]}"'), ctx)).toEqual(['x y z'])
  })
})

describe('expandWord — 배열 malformed 는 크래시하지 않는다 (task 3)', () => {
  beforeEach(() => { ctx.arrays.set('arr', ['a', 'b', 'c']) })
  it('${arr[} / ${arr[@} / ${!arr[} 는 던지지 않고 관대하게 처리', async () => {
    // 닫히지 않은 대괄호 — 첨자로 인식 안 되고 폴백(원소0/빈). 크래시만 없으면 된다.
    await expect(expandWord(wordOf('"${arr[}"'), ctx)).resolves.toBeDefined()
    await expect(expandWord(wordOf('"${arr[@}"'), ctx)).resolves.toBeDefined()
    await expect(expandWord(wordOf('"${!arr[}"'), ctx)).resolves.toBeDefined()
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
