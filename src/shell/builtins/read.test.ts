import { describe, it, expect, beforeEach } from 'vitest'
import { createShell } from '../index'
import { VFS } from '../vfs'
import type { CommandEnv, ShellState, Shell } from '../types'
import { builtins } from './index'

/**
 * 모든 기대값은 `docker run --rm debian:stable-slim bash -c '...'`(bash 5.2.37)로
 * 실측했다(task-4-report.md 참고). 두 층으로 나눠 테스트한다:
 *  - 빌트인 직접 호출(`run('read', ...)`, e.stdin 을 바로 넣음) — 분할/트림/-r/REPLY/
 *    EOF/식별자 검증 같은 read.ts 자체 로직.
 *  - 전체 `exec()`(createShell) — `read v < file`(단순명령 리다이렉션에서 대입이 밖으로
 *    보존됨) 와 `echo x | read v`(파이프 스테이지는 childCtx 로 격리돼 밖으로 안 샘) 의
 *    엔진 배선 확인. 이건 read.ts 코드가 아니라 interpreter.ts 의 기존 격리가 낸다 —
 *    회귀 확인 목적.
 */

let fs: VFS
let state: ShellState

beforeEach(() => {
  fs = new VFS()
  fs.mkdir('/home/player', { recursive: true })
  state = { cwd: '/home/player', oldPwd: '/home/player', env: { HOME: '/home/player' }, lastExitCode: 0, home: '/home/player', functions: new Map(), arrays: new Map() }
})

const env = (name: string, args: string[], stdin = ''): CommandEnv =>
  ({ name, args, stdin, stdinFromFile: false, fs, state })
const run = (name: string, args: string[], stdin = '') => builtins[name]!(env(name, args, stdin))
const runRead = (args: string[], stdin: string) => run('read', args, stdin)

describe('read 레지스트리', () => {
  it('builtins 표에 read 가 있다', () => {
    expect(builtins.read).toBeDefined()
  })
})

describe('단일 변수', () => {
  it('한 줄을 읽어 변수에 넣는다 (docker: [hello])', async () => {
    const out = await runRead(['v'], 'hello\n')
    expect(state.env.v).toBe('hello')
    expect(out.exitCode).toBe(0)
  })
  it('앞뒤 IFS 공백을 트림한다 (docker: a=[hello])', async () => {
    await runRead(['a'], '  hello  \n')
    expect(state.env.a).toBe('hello')
  })
})

describe('여러 변수 (마지막이 나머지)', () => {
  it('2개 변수: 마지막이 나머지 (docker: a=[x] b=[y z])', async () => {
    await runRead(['a', 'b'], 'x y z\n')
    expect(state.env.a).toBe('x')
    expect(state.env.b).toBe('y z')
  })
  it('3개 변수 정확히 매치 (docker: a=x b=y c=z)', async () => {
    await runRead(['a', 'b', 'c'], 'x y z\n')
    expect(state.env.a).toBe('x')
    expect(state.env.b).toBe('y')
    expect(state.env.c).toBe('z')
  })
  it('단어보다 변수가 많으면 남는 변수는 빈 문자열 (docker: a=x b=y c=z d=[])', async () => {
    await runRead(['a', 'b', 'c', 'd'], 'x y z\n')
    expect(state.env.a).toBe('x')
    expect(state.env.b).toBe('y')
    expect(state.env.c).toBe('z')
    expect(state.env.d).toBe('')
  })
  it('앞뒤 공백 + 2변수 (docker: a=[hello] b=[world])', async () => {
    await runRead(['a', 'b'], '  hello world  \n')
    expect(state.env.a).toBe('hello')
    expect(state.env.b).toBe('world')
  })
})

describe('$REPLY (변수 인자 없음)', () => {
  it('인자 없이 read 는 REPLY 에 넣는다 (docker: [the line])', async () => {
    await runRead([], 'the line\n')
    expect(state.env.REPLY).toBe('the line')
  })
  it('REPLY 는 트림되지 않는다 — 가공 없이 통째로 (docker: [  the line  ])', async () => {
    await runRead([], '  the line  \n')
    expect(state.env.REPLY).toBe('  the line  ')
  })
  it('명시적 read REPLY 는(1개 변수와 동일하게) 트림된다 (docker: [hello world])', async () => {
    await runRead(['REPLY'], '  hello world  \n')
    expect(state.env.REPLY).toBe('hello world')
  })
})

describe('-r (raw, 백슬래시 리터럴)', () => {
  it('-r 은 백슬래시를 리터럴로 남긴다 (docker: [a\\tb])', async () => {
    await runRead(['-r', 'line'], 'a\\tb\n')
    expect(state.env.line).toBe('a\\tb')
  })
  it('-r 없으면 \\t 의 백슬래시가 지워지고 t 만 남는다 (docker: [atb])', async () => {
    await runRead(['line'], 'a\\tb\n')
    expect(state.env.line).toBe('atb')
  })
  it('-r 없으면 백슬래시-개행은 줄이어짐(다음 물리 줄과 합쳐짐, docker: [ab])', async () => {
    await runRead(['line'], 'a\\\nb\n')
    expect(state.env.line).toBe('ab')
  })
  it('-r 이면 백슬래시-개행도 줄이어짐 없이 리터럴 백슬래시, 첫 물리 줄만 소비 (docker: [a\\])', async () => {
    await runRead(['-r', 'line'], 'a\\\nb\n')
    expect(state.env.line).toBe('a\\')
  })
  it('-r 없이 백슬래시-공백은 공백을 리터럴로 보존(구분자 아님) — 1개 변수라 전체가 한 필드 (docker: [a b])', async () => {
    await runRead(['line'], 'a\\ b\n')
    expect(state.env.line).toBe('a b')
  })
})

describe('커스텀 IFS', () => {
  it('IFS=: 로 분할, 마지막이 나머지 (docker: a=[x] b=[y:z])', async () => {
    state.env.IFS = ':'
    await runRead(['a', 'b'], 'x:y:z\n')
    expect(state.env.a).toBe('x')
    expect(state.env.b).toBe('y:z')
  })
  it('IFS=: 로 정확히 2필드 (docker: a=[x] b=[y])', async () => {
    state.env.IFS = ':'
    await runRead(['a', 'b'], 'x:y\n')
    expect(state.env.a).toBe('x')
    expect(state.env.b).toBe('y')
  })
  it('선행 구분자는 빈 필드를 만들고, 비공백 구분자는 후행이라도 안 벗겨진다 (docker: a=[] b=[x:y:])', async () => {
    state.env.IFS = ':'
    await runRead(['a', 'b'], ':x:y:\n')
    expect(state.env.a).toBe('')
    expect(state.env.b).toBe('x:y:')
  })
})

describe('혼합 IFS (공백류+비공백류) — POSIX 단일 구분자 병합', () => {
  // docker: printf "a  ::b\n" > f; IFS=" :" read a b < f → a=[a] b=[:b]
  it('ws런+비공백 하나가 구분자 하나로 합쳐진다 (docker: a=[a] b=[:b], NOT b=[::b])', async () => {
    state.env.IFS = ' :'
    await runRead(['a', 'b'], 'a  ::b\n')
    expect(state.env.a).toBe('a')
    expect(state.env.b).toBe(':b')
  })
  // docker: printf "a  ::b c\n" > f; IFS=" :" read a b c < f → a=[a] b=[] c=[b c]
  it('연속 비공백 구분자 사이엔 빈 필드가 생긴다 (docker: a=[a] b=[] c=[b c], NOT c=[:b c])', async () => {
    state.env.IFS = ' :'
    await runRead(['a', 'b', 'c'], 'a  ::b c\n')
    expect(state.env.a).toBe('a')
    expect(state.env.b).toBe('')
    expect(state.env.c).toBe('b c')
  })
  // docker: printf "  x : y \n" > f; IFS=" :" read a b < f → a=[x] b=[y]
  it('선행/중간/후행 ws-run + 비공백 하나가 각각 한 구분자로 병합된다 (docker: a=[x] b=[y])', async () => {
    state.env.IFS = ' :'
    await runRead(['a', 'b'], '  x : y \n')
    expect(state.env.a).toBe('x')
    expect(state.env.b).toBe('y')
  })
  // docker: printf "  x : y \n" > f; IFS=" :" read a b c < f → a=[x] b=[y] c=[]
  it('마지막 변수는 후행 ws만 벗기고 남는 게 없으면 빈 문자열 (docker: a=[x] b=[y] c=[])', async () => {
    state.env.IFS = ' :'
    await runRead(['a', 'b', 'c'], '  x : y \n')
    expect(state.env.a).toBe('x')
    expect(state.env.b).toBe('y')
    expect(state.env.c).toBe('')
  })
  // docker: printf "a, b, c\n" > f; IFS=", " read a b c < f → a=[a] b=[b] c=[c] (회귀 확인)
  it('CSV 관용구( IFS=", " )는 계속 정상 동작한다 — 회귀 확인 (docker: a=[a] b=[b] c=[c])', async () => {
    state.env.IFS = ', '
    await runRead(['a', 'b', 'c'], 'a, b, c\n')
    expect(state.env.a).toBe('a')
    expect(state.env.b).toBe('b')
    expect(state.env.c).toBe('c')
  })
})

describe('EOF', () => {
  it('빈 stdin 이면 exit 1', async () => {
    const out = await runRead(['v'], '')
    expect(out.exitCode).toBe(1)
  })
  it('빈 stdin 이어도 변수는 빈 문자열로 대입된다 (docker: isset val=[])', async () => {
    await runRead(['v'], '')
    expect(state.env.v).toBe('')
  })
  it('개행 없이 끝나는 줄도 읽되(부분 대입) exit 1 (docker: [noeol] exit=1)', async () => {
    const out = await runRead(['v'], 'noeol')
    expect(state.env.v).toBe('noeol')
    expect(out.exitCode).toBe(1)
  })
  it('빈 줄(선두 개행)은 성공 취급 (docker: [] exit=0)', async () => {
    const out = await runRead(['v'], '\nnext\n')
    expect(state.env.v).toBe('')
    expect(out.exitCode).toBe(0)
  })
})

describe('첫 줄만 소비', () => {
  it('여러 줄 중 첫 줄만 읽는다 (docker: [one])', async () => {
    await runRead(['v'], 'one\ntwo\n')
    expect(state.env.v).toBe('one')
  })
})

describe('잘못된 식별자', () => {
  it('숫자로 시작하는 이름은 얌전히 실패한다 (docker: exit=1, 크래시 없음)', async () => {
    const out = await runRead(['1abc'], 'x y\n')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).not.toBe('')
  })
  it('= 가 낀 이름도 얌전히 실패한다', async () => {
    const out = await runRead(['a=b'], 'x\n')
    expect(out.exitCode).toBe(1)
  })
  it('앞쪽 유효한 이름은 이미 대입된 채로 남는다 (docker: a=[x] c=[])', async () => {
    const out = await runRead(['a', '1bad', 'c'], 'x y z\n')
    expect(state.env.a).toBe('x')
    expect(state.env.c).toBeUndefined()
    expect(out.exitCode).toBe(1)
  })
})

describe('알 수 없는 플래그', () => {
  it('read -x 는 크래시 없이 nonzero (docker: exit=2)', async () => {
    const out = await runRead(['-x', 'v'], 'hello\n')
    expect(out.exitCode).toBeGreaterThan(0)
    expect(state.env.v).toBeUndefined()
  })
})

describe('exec() 배선: 단순명령 리다이렉션은 밖으로 보존', () => {
  let sh: Shell
  beforeEach(() => {
    fs.writeFile('/home/player/f', 'hello\n')
    fs.writeFile('/home/player/f2', 'x y z\n')
    sh = createShell({ fs, cwd: '/home/player', home: '/home/player' })
  })
  it('read v < file 후 $v 가 밖에서 보인다', async () => {
    await sh.exec('read v < f')
    const out = await sh.exec('echo "[$v]"')
    expect(out.stdout).toBe('[hello]\n')
  })
  it('read a b < file (2 vars, 마지막 나머지) 후 밖에서 보인다', async () => {
    await sh.exec('read a b < f2')
    const out = await sh.exec('echo "a=$a b=$b"')
    expect(out.stdout).toBe('a=x b=y z\n')
  })
  it('read v < /dev/null 스타일(빈 stdin) exit 1', async () => {
    fs.writeFile('/home/player/empty', '')
    const out = await sh.exec('read v < empty')
    expect(out.exitCode).toBe(1)
  })
})

describe('exec() 배선: 파이프는 격리(subshell) — 밖으로 안 샌다', () => {
  it('echo hi | read v; echo $v 는 밖에서 빈 값 (docker 실측: pipe read 는 subshell)', async () => {
    const sh = createShell({ fs, cwd: '/home/player', home: '/home/player', env: { v: 'UNSET' } })
    await sh.exec('echo hi | read v')
    const out = await sh.exec('echo "[$v]"')
    expect(out.stdout).toBe('[UNSET]\n')
  })
})

/**
 * `read -a`(M3 Part 4 task 2). 전부 docker debian:stable-slim bash 5.2.37 실측(task-2-report.md
 * 참고). 스칼라 read 와 달리 "마지막 변수 나머지" 규칙이 없다 — 모든 필드가 배열 원소가 된다.
 * splitForRead 의 "마지막 아님" 필드 스캔 규칙(선행 IFS-공백 스킵→다음 구분자까지→구분자
 * 하나 소비)을 텍스트 끝까지 반복 적용하면 되는 걸 docker 로 확인했다 — 후행 구분자가
 * 있어도 그 뒤에 유령 빈 원소가 안 생긴다(`a:` + IFS=: → 1원소, `a::` → 2원소 그 중
 * 마지막이 빈 문자열: 두 비공백 구분자 사이만 빈 원소, 끝의 단일 구분자는 그냥 소비됨).
 */
describe('-a (인덱스 배열)', () => {
  it('기본: 3단어 → 3원소 (docker: a b c / 3 / b)', async () => {
    const out = await runRead(['-a', 'arr'], 'a b c\n')
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'c'])
    expect(out.exitCode).toBe(0)
  })
  it('여러 공백류(스페이스+탭)는 하나의 구분자로 합쳐진다 (docker: 3원소)', async () => {
    await runRead(['-a', 'arr'], 'x  y\tz\n')
    expect(state.arrays.get('arr')).toEqual(['x', 'y', 'z'])
  })
  it('커스텀 IFS(:)로 3원소 (docker: a:b:c → 3)', async () => {
    state.env.IFS = ':'
    await runRead(['-a', 'arr'], 'a:b:c\n')
    expect(state.arrays.get('arr')).toEqual(['a', 'b', 'c'])
  })
  it('비공백 IFS 인접 구분자는 그 사이에 빈 원소를 만든다 (docker: a::b → 3원소, [1]="")', async () => {
    state.env.IFS = ':'
    await runRead(['-a', 'arr'], 'a::b\n')
    expect(state.arrays.get('arr')).toEqual(['a', '', 'b'])
  })
  it('후행 비공백 구분자 하나는 유령 빈 원소를 안 만든다 (docker: "a:" + IFS=: → 1원소)', async () => {
    state.env.IFS = ':'
    await runRead(['-a', 'arr'], 'a:\n')
    expect(state.arrays.get('arr')).toEqual(['a'])
  })
  it('-ra (r 다음 a): 백슬래시 리터럴 보존 + 2원소 (docker: [a\\tb] / 2)', async () => {
    const out = await runRead(['-ra', 'arr'], 'a\\tb c\n')
    expect(state.arrays.get('arr')).toEqual(['a\\tb', 'c'])
    expect(out.exitCode).toBe(0)
  })
  it('-ar (a 다음 r, 순서 반대): 같은 결과 (docker: [a\\tb] / 2)', async () => {
    await runRead(['-ar', 'arr'], 'a\\tb c\n')
    expect(state.arrays.get('arr')).toEqual(['a\\tb', 'c'])
  })
  it('-r -a (분리된 두 플래그): 같은 결과 (docker: [a\\tb] / 2)', async () => {
    await runRead(['-r', '-a', 'arr'], 'a\\tb c\n')
    expect(state.arrays.get('arr')).toEqual(['a\\tb', 'c'])
  })
  it('빈 줄 → 빈 배열, exit 1 (docker: 1/0)', async () => {
    const out = await runRead(['-a', 'arr'], '')
    expect(state.arrays.get('arr')).toEqual([])
    expect(out.exitCode).toBe(1)
  })
  it('앞뒤 IFS 공백은 트림된다 (docker: "  a b  " → 2원소)', async () => {
    await runRead(['-a', 'arr'], '  a b  \n')
    expect(state.arrays.get('arr')).toEqual(['a', 'b'])
  })
  it('잘못된 배열 이름은 얌전히 nonzero, 크래시 없음 (docker: exit=1)', async () => {
    const out = await runRead(['-a', '1bad'], 'x y\n')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).not.toBe('')
    expect(state.arrays.has('1bad')).toBe(false)
  })
  it('-a 뒤에 이름이 없으면 얌전히 exit 2, 크래시 없음 (docker: exit=2)', async () => {
    const out = await runRead(['-a'], 'x y\n')
    expect(out.exitCode).toBe(2)
  })
})

describe('exec() 배선: read -a < file 은 밖으로 보존, 파이프는 격리', () => {
  it('read -a arr < f 후 ${arr[@]} 가 밖에서 보인다 (docker: a b c / 3 / b)', async () => {
    fs.writeFile('/home/player/farr', 'a b c\n')
    const sh = createShell({ fs, cwd: '/home/player', home: '/home/player' })
    await sh.exec('read -a arr < farr')
    const out = await sh.exec('echo "${arr[@]}"; echo "${#arr[@]}"; echo "${arr[1]}"')
    expect(out.stdout).toBe('a b c\n3\nb\n')
  })
  it('echo "a b" | read -a arr; ${#arr[@]} 는 밖에서 0 (docker: pipe read 는 subshell)', async () => {
    const sh = createShell({ fs, cwd: '/home/player', home: '/home/player' })
    await sh.exec('echo "a b" | read -a arr')
    const out = await sh.exec('echo "${#arr[@]}"')
    expect(out.stdout).toBe('0\n')
  })
})
