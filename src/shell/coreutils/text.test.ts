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
  fs.writeFile('/w/aba.txt', 'a\nb\na\n')
  fs.writeFile('/w/Aa.txt', 'A\na\n')
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
  it('translate mode: 하나의 피연산자만 있으면 exit 1', async () => {
    const r = await run('echo abc | tr abc')
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('tr')
  })
  it('translate mode: 올바른 두 피연산자는 작동한다', async () => { expect(await out('echo abc | tr abc x')).toBe('xxx\n') })
  it('-d mode: 하나의 피연산자는 유효하다', async () => { expect(await out('echo a1b | tr -d 0-9')).toBe('ab\n') })
  it('-s mode: 하나의 피연산자는 유효하다', async () => { expect(await out('echo aabb | tr -s ab')).toBe('ab\n') })
})

describe('uniq', () => {
  it('인접 중복을 접는다', async () => { expect(await out('uniq dup.txt')).toBe('a\nb\nc\n') })
  it('정렬은 안 한다 (인접만)', async () => { expect(await out('uniq aba.txt')).toBe('a\nb\na\n') })
  it('-c 개수 (7칸)', async () => { expect(await out('uniq -c dup.txt')).toBe('      2 a\n      1 b\n      2 c\n') })
  it('-d 중복된 것만', async () => { expect(await out('uniq -d dup.txt')).toBe('a\nc\n') })
  it('-u 유일한 것만', async () => { expect(await out('uniq -u dup.txt')).toBe('b\n') })
  it('-i 대소문자 무시', async () => { expect(await out('uniq -i Aa.txt')).toBe('A\n') })
  it('stdin 도 된다', async () => { expect(await out('cat dup.txt | uniq')).toBe('a\nb\nc\n') })
})

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

  // \1..\9 캡처 그룹, \& 리터럴
  it('\\1 은 캡처 그룹 (패턴은 grep 과 같은 JS RegExp 문법 — 괄호에 이스케이프 없음)', async () => {
    expect(await out("echo 'foo bar' | sed 's/(foo) (bar)/\\2 \\1/'")).toBe('bar foo\n')
  })
  it('\\& 는 리터럴 &', async () => {
    expect(await out("echo abc | sed 's/b/[\\&]/'")).toBe('a[&]c\n')
  })

  // p (자동인쇄 + 명시인쇄) vs -n p (명시인쇄만) — Docker 로 재확인한 서브셋의 핵심 함정.
  it("'p' 는 -n 없으면 각 줄을 두 번 낸다", async () => {
    expect(await out('sed p t.txt')).toBe(
      'hello world\nhello world\nhello there\nhello there\ngoodbye\ngoodbye\n',
    )
  })
  it("'-n p' 는 각 줄을 한 번만 낸다", async () => {
    expect(await out('sed -n p t.txt')).toBe('hello world\nhello there\ngoodbye\n')
  })

  // 파일 여러 개는 이어붙인 하나의 스트림처럼 줄 번호를 연속으로 센다(GNU 실측:
  // `sed -n '3p' f1 f2` 는 f1 이 2줄이면 f2 의 1번째 줄, 즉 전체 3번째 줄을 낸다).
  it('여러 파일은 줄 번호가 이어진다 (파일별로 리셋 안 함)', async () => {
    fs.writeFile('/w/a2.txt', 'l1\nl2\n')
    fs.writeFile('/w/b2.txt', 'l3\nl4\n')
    expect(await out('sed -n 3p a2.txt b2.txt')).toBe('l3\n')
  })

  // -n 플래그와 delete 명령: delete 는 매칭된 줄을 삭제하고 나머지는 auto-print 해야 한다.
  // 하지만 -n (quiet) 플래그가 있으면 auto-print 는 억제되므로 delete 는 아무것도 출력하지 않아야 한다.
  it('sed -n "2d" 로 줄 2를 삭제하되 -n 이므로 출력 없음', async () => {
    expect(await out('sed -n 2d t.txt')).toBe('')
  })
  it('sed -n "/hello/d" 로 패턴 일치 줄을 삭제하되 -n 이므로 출력 없음', async () => {
    expect(await out('sed -n /hello/d t.txt')).toBe('')
  })
  it('sed "2d" (no -n) 는 줄 2 를 삭제하고 나머지는 auto-print', async () => {
    expect(await out('sed 2d t.txt')).toBe('hello world\ngoodbye\n')
  })

  // 서브셋 밖: 단일 명령이 아닌 스크립트는 침묵하며 잘못 동작하지 말고 flashshell: 로 거부한다.
  it("';' 로 이은 두 s 명령은 flashshell: 로 거부한다 (조용히 첫 명령만 적용하지 않는다)", async () => {
    const r = await run("sed 's/a/b/;s/c/d/' t.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell:')
  })
  it("';' 로 이은 두 주소 명령도 flashshell: 로 거부한다", async () => {
    const r = await run("sed '/hello/p;/goodbye/d' t.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell:')
  })
  it('-e 플래그는 미지원 — flashshell: 로 거부한다', async () => {
    const r = await run("sed -e 's/a/b/' t.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell:')
  })
  it('알 수 없는 명령 문자는 flashshell: 로 거부한다', async () => {
    const r = await run('sed z t.txt')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell:')
  })
  it('s///p 처럼 지원하지 않는 플래그는 flashshell: 로 거부한다', async () => {
    const r = await run("sed 's/a/b/p' t.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell:')
  })

  // sed 의 파일 에러 문구·종료코드는 cat/head/grep 과 다르다(docker debian:stable-slim
  // sed 4.9 실측 — 아래 두 테스트 참고).
  it("없는 파일은 GNU 문구 그대로다 (\"can't read ...\"), exit 2", async () => {
    const r = await run("sed 's/a/b/' nope.txt")
    expect(r.stderr).toBe("sed: can't read nope.txt: No such file or directory\n")
    expect(r.exitCode).toBe(2)
  })
  it('디렉터리를 파일로 주면 GNU 문구 그대로다 ("read error on ..."), exit 4', async () => {
    fs.mkdir('/w/adir')
    const r = await run("sed 's/a/b/' adir")
    expect(r.stderr).toBe('sed: read error on adir: Is a directory\n')
    expect(r.exitCode).toBe(4)
  })
})

describe('awk', () => {
  beforeEach(() => { fs.writeFile('/w/p.txt', 'alice 30\nbob 25\ncarol 35\n') })
  it('필드 인쇄', async () => { expect(await out("awk '{print $1}' p.txt")).toBe('alice\nbob\ncarol\n') })
  it('NR NF', async () => { expect(await out("awk '{print NR, NF}' p.txt")).toBe('1 2\n2 2\n3 2\n') })
  it('-F 구분자', async () => { expect(await out("echo a:b:c | awk -F: '{print $2}'")).toBe('b\n') })
  it('정규식 규칙', async () => { expect(await out("awk '/bob/{print $2}' p.txt")).toBe('25\n') })
  it('누적 + END', async () => { expect(await out("awk '{s+=$2} END{print s}' p.txt")).toBe('90\n') })
  it('BEGIN', async () => { expect(await out("awk 'BEGIN{print \"start\"} {print $1}' p.txt")).toBe('start\nalice\nbob\ncarol\n') })
  it('숫자 비교 조건', async () => { expect(await out("awk '$2>28{print $1}' p.txt")).toBe('alice\ncarol\n') })

  // 아래는 브리프의 8개 테스트를 넘어, docker debian:stable-slim mawk 1.3.4 실측과
  // 대조한 경계 동작들이다(리포트에 각 docker 명령·출력을 남겼다).
  it('기본 구분자는 공백 연속이고 앞뒤 공백은 무시한다', async () => {
    // printf 는 우리 셸에 없으므로(브리프 참고) 파일 픽스처로 공백/탭 혼합 줄을 만든다.
    fs.writeFile('/w/ws.txt', '  a   b\tc  \n')
    expect(await out('awk \'{print NF, $1, $2, $3}\' ws.txt')).toBe('3 a b c\n')
  })
  it('숫자 아닌 필드의 산술 문맥은 0 (docker: `echo abc | awk \'{print $1+0}\'` -> 0)', async () => {
    expect(await out("echo abc | awk '{print $1+0}'")).toBe('0\n')
  })
  it('선행 숫자 접두만 파싱 (docker: `42abc` -> 42)', async () => {
    expect(await out("echo 42abc | awk '{print $1+0}'")).toBe('42\n')
  })
  it('print 인자 없으면 $0 그대로', async () => {
    expect(await out('awk \'{print}\' p.txt')).toBe('alice 30\nbob 25\ncarol 35\n')
  })
  it('문자열 리터럴 비교는 필드가 숫자처럼 보여도 문자열 비교다 (docker 실측: $2==" 30" 은 false, $2=="30" 은 true)', async () => {
    expect(await out('echo \'a 30\' | awk \'$2==" 30"{print "eq"}\'')).toBe('')
    expect(await out('echo \'a 30\' | awk \'$2=="30"{print "eq"}\'')).toBe('eq\n')
  })
  it('필드 vs 문자열 리터럴 비교(사전식) — $1<"b"', async () => {
    expect(await out("awk '$1<\"b\"{print $1}' p.txt")).toBe('alice\n')
  })

  it('비어있는 줄은 -F 커스텀 구분자 사용시 NF=0', async () => {
    fs.writeFile('/w/blank.csv', 'a:b\n\nc:d\n')
    expect(await out("awk -F: '{print NF}' blank.csv")).toBe('2\n0\n2\n')
  })

  it('NF>0 으로 비어있는 줄을 필터링', async () => {
    fs.writeFile('/w/blank.csv', 'a:b\n\nc:d\n')
    expect(await out("awk -F: 'NF>0{print}' blank.csv")).toBe('a:b\nc:d\n')
  })

  it('기본 구분자로 비어있는 줄도 NF=0 (회귀 테스트)', async () => {
    fs.writeFile('/w/blanksp.txt', 'a b\n\nc d\n')
    expect(await out("awk '{print NF}' blanksp.txt")).toBe('2\n0\n2\n')
  })

  it('$2>=28 은 28 을 포함하고 $2>28 은 제외 (경계값 테스트)', async () => {
    fs.writeFile('/w/ages.txt', 'alice 27\ndave 28\nevelyn 29\n')
    expect(await out("awk '$2>=28{print $1}' ages.txt")).toBe('dave\nevelyn\n')
    expect(await out("awk '$2>28{print $1}' ages.txt")).toBe('evelyn\n')
  })

  it('미지원 구문은 flashshell 로 거부', async () => {
    const r = await run("awk '{for(i=0;i<3;i++)print}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })

  // 브리프가 요구한 for 외에, 이 서브셋 밖 구문 전부가 "조용히 틀리게 실행"되지 않고
  // 반드시 거부되는지 실행으로 확인한다 — awk는 조용한 오답이 나기 가장 쉬운 곳이다.
  it('while 제어문도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{while(NR<3)print}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('if 제어문도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{if($1==\"bob\")print}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('배열 사용도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{a[1]=$1; print a[1]}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('printf 도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{printf \"%s\\n\", $1}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('gsub 도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{gsub(/a/,\"b\"); print}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('사용자 함수(function)도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk 'function f(x){return x} {print f($1)}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('getline 도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{getline; print}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('삼항 연산자도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{print $1==\"bob\" ? \"y\" : \"n\"}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
  it('++ 연산자도 flashshell 로 거부(출력 없음)', async () => {
    const r = await run("awk '{i=0; i++; print i}' p.txt")
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('flashshell')
    expect(r.stdout).toBe('')
  })
})
