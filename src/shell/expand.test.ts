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
