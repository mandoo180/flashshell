import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from './vfs'
import { matchSegment, expandGlob, hasGlob } from './glob'

describe('matchSegment', () => {
  it('* 는 아무 문자열에나 맞는다', () => {
    expect(matchSegment('*', 'abc')).toBe(true)
    expect(matchSegment('*.txt', 'a.txt')).toBe(true)
    expect(matchSegment('*.txt', 'a.md')).toBe(false)
  })
  it('? 는 정확히 한 글자', () => {
    expect(matchSegment('a?c', 'abc')).toBe(true)
    expect(matchSegment('a?c', 'ac')).toBe(false)
  })
  it('[abc] 는 문자 집합', () => {
    expect(matchSegment('[abc].txt', 'b.txt')).toBe(true)
    expect(matchSegment('[abc].txt', 'd.txt')).toBe(false)
  })
  it('[a-c] 는 범위', () => {
    expect(matchSegment('[a-c]', 'b')).toBe(true)
    expect(matchSegment('[a-c]', 'd')).toBe(false)
  })
  it('[!a] 와 [^a] 는 부정', () => {
    expect(matchSegment('[!a]', 'b')).toBe(true)
    expect(matchSegment('[!a]', 'a')).toBe(false)
    expect(matchSegment('[^a]', 'b')).toBe(true)
  })
  it('정규식 메타문자를 문자 그대로 취급한다', () => {
    expect(matchSegment('a.b', 'a.b')).toBe(true)
    expect(matchSegment('a.b', 'axb')).toBe(false)
    expect(matchSegment('a+b', 'a+b')).toBe(true)
    expect(matchSegment('a$b', 'a$b')).toBe(true)
    expect(matchSegment('a{b}', 'a{b}')).toBe(true)
    expect(matchSegment('a(b)', 'a(b)')).toBe(true)
    expect(matchSegment('a|b', 'a|b')).toBe(true)
    expect(matchSegment('a^b', 'a^b')).toBe(true)
    expect(matchSegment('a\\b', 'a\\b')).toBe(true)
  })
  it('* 는 점으로 시작하는 이름에 맞지 않는다', () => {
    expect(matchSegment('*', '.hidden')).toBe(false)
    expect(matchSegment('.*', '.hidden')).toBe(true)
  })
  it('패턴이 리터럴 점으로 시작하지 않으면 대괄호 표현식이 점을 포함해도 선행 점은 보호된다', () => {
    // bash: [.]* 는 .hidden 에 맞지 않는다 — 패턴의 "첫 글자"가 리터럴 '.' 이어야
    // 선행 점 보호가 풀린다. [.]는 '.'을 매칭할 수 있는 구성일 뿐 리터럴 '.'로
    // *시작*하는 패턴이 아니다.
    expect(matchSegment('[.]*', '.hidden')).toBe(false)
    expect(matchSegment('[.]*', 'x.hidden')).toBe(false)
  })
  it('닫히지 않은 [ 는 문자 그대로 취급한다', () => {
    expect(matchSegment('a[bc', 'a[bc')).toBe(true)
    expect(matchSegment('a[bc', 'abc')).toBe(false)
  })
  it(']가 대괄호 표현식의 첫 글자면 리터럴 ]로 취급한다 (POSIX/bash 규칙)', () => {
    // bash: []a] 는 ']' 또는 'a' 에 맞는다. 첫 ']'는 닫는 괄호가 아니라 리터럴 멤버다.
    expect(matchSegment('[]a]', ']')).toBe(true)
    expect(matchSegment('[]a]', 'a')).toBe(true)
    expect(matchSegment('[]a]', 'b')).toBe(false)
    // 전체가 []] 하나뿐이면 리터럴 ']' 만 매칭한다.
    expect(matchSegment('[]]', ']')).toBe(true)
    expect(matchSegment('[]]', 'x')).toBe(false)
  })
  it('[!]] 는 부정과 리터럴 ] 첫 글자 규칙이 함께 동작한다', () => {
    // bash: [!]] 는 ']'가 아닌 모든 한 글자에 맞는다.
    expect(matchSegment('[!]]', 'x')).toBe(true)
    expect(matchSegment('[!]]', ']')).toBe(false)
  })
  it('[a-] 는 끝의 - 를 리터럴로 취급한다 (범위가 아니다)', () => {
    expect(matchSegment('[a-]', 'a')).toBe(true)
    expect(matchSegment('[a-]', '-')).toBe(true)
    expect(matchSegment('[a-]', 'b')).toBe(false)
  })
  it('잘못된 범위([z-a] 처럼 역순)는 던지지 않고 아무것도 매칭하지 않는다', () => {
    expect(() => matchSegment('[z-a]', 'z')).not.toThrow()
    expect(matchSegment('[z-a]', 'z')).toBe(false)
    expect(matchSegment('[z-a]', 'a')).toBe(false)
  })
})

describe('hasGlob', () => {
  it('메타문자를 감지한다', () => {
    expect(hasGlob('*.txt')).toBe(true)
    expect(hasGlob('a?b')).toBe(true)
    expect(hasGlob('[ab]')).toBe(true)
    expect(hasGlob('plain.txt')).toBe(false)
  })
})

describe('expandGlob', () => {
  let fs: VFS
  beforeEach(() => {
    fs = new VFS()
    fs.mkdir('/w/sub', { recursive: true })
    fs.writeFile('/w/a.txt', '')
    fs.writeFile('/w/b.txt', '')
    fs.writeFile('/w/c.md', '')
    fs.writeFile('/w/.hidden', '')
    fs.writeFile('/w/sub/d.txt', '')
  })

  it('cwd 안에서 확장하고 정렬한다', () => {
    expect(expandGlob('*.txt', '/w', fs)).toEqual(['a.txt', 'b.txt'])
  })

  it('매칭이 없으면 패턴 그대로 돌려준다', () => {
    expect(expandGlob('*.zip', '/w', fs)).toEqual(['*.zip'])
  })

  it('경로 중간의 글롭도 확장한다', () => {
    expect(expandGlob('/w/*/d.txt', '/', fs)).toEqual(['/w/sub/d.txt'])
  })

  it('절대경로 패턴은 절대경로를 돌려준다', () => {
    expect(expandGlob('/w/*.md', '/', fs)).toEqual(['/w/c.md'])
  })

  it('숨김파일은 명시적으로 점을 써야 잡힌다', () => {
    expect(expandGlob('*', '/w', fs)).toEqual(['a.txt', 'b.txt', 'c.md', 'sub'])
    expect(expandGlob('.*', '/w', fs)).toEqual(['.hidden'])
  })

  it('상대경로 중간 글롭도 상대경로를 돌려준다', () => {
    expect(expandGlob('sub/*.txt', '/w', fs)).toEqual(['sub/d.txt'])
  })

  it('존재하지 않는 디렉터리 아래 글롭은 패턴 그대로 돌려준다 (throw 하지 않는다)', () => {
    expect(expandGlob('/nope/*', '/', fs)).toEqual(['/nope/*'])
  })

  it('루트 바로 아래 절대경로 글롭은 //, / 접두 없이 재조립된다', () => {
    expect(expandGlob('/*', '/', fs)).toEqual(['/w'])
  })

  it('대문자가 소문자보다 먼저 정렬된다 (localeCompare 아님, C 로케일 바이트 순)', () => {
    fs.writeFile('/w/A.txt', '')
    // A.txt(65) < a.txt(97) < b.txt(98)
    expect(expandGlob('*.txt', '/w', fs)).toEqual(['A.txt', 'a.txt', 'b.txt'])
  })

  it('글롭 세그먼트 다음의 리터럴 세그먼트는 파일인 후보를 조용히 건너뛴다', () => {
    // frontier 에 a.txt, b.txt, c.md, sub 가 모두 오르지만 파일들은 디렉터리가
    // 아니므로 d.txt 세그먼트를 이어 붙일 때 건너뛰어야 하고, 던지면 안 된다.
    expect(() => expandGlob('/w/*/d.txt', '/', fs)).not.toThrow()
  })

  it('심볼릭 링크로 연결된 디렉터리도 글롭이 통과한다 (isDir/readdir 모두 링크를 따라간다)', () => {
    fs.symlink('sub', '/w/link')
    expect(expandGlob('link/*.txt', '/w', fs)).toEqual(['link/d.txt'])
  })

  it('상대 target 심볼릭 링크가 글롭 세그먼트 다음의 리터럴 세그먼트를 가릴 때도 매칭된다 (실제 bash와 동일)', () => {
    // /w/link -> sub (상대 target). '/w/*/d.txt'는 'link'와 'sub' 둘 다 후보로
    // 올리고, 각 후보 뒤에 리터럴 'd.txt'를 붙여 exists()로 확인한다. exists()가
    // 중간 요소의 상대 심볼릭 링크를 링크 자신의 디렉터리 기준으로 풀지 못하면
    // '/w/link/d.txt'는 거짓으로 존재하지 않는다고 보고되어 빠진다 — 실제 bash
    // (`echo w/*/d.txt`)는 둘 다 반환한다.
    fs.symlink('sub', '/w/link')
    expect(expandGlob('/w/*/d.txt', '/', fs)).toEqual(['/w/link/d.txt', '/w/sub/d.txt'])
  })
})
