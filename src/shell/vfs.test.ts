import { describe, it, expect, beforeEach } from 'vitest'
import { VFS } from './vfs'
import { VfsError } from './errors'

let fs: VFS
beforeEach(() => { fs = new VFS() })

describe('VFS.resolve', () => {
  it('상대경로를 cwd 기준 절대경로로 만든다', () => {
    expect(fs.resolve('a/b', '/home')).toBe('/home/a/b')
  })
  it('. 과 .. 를 접는다', () => {
    expect(fs.resolve('./a/../b/./c', '/home')).toBe('/home/b/c')
  })
  it('루트 위로 올라가지 않는다', () => {
    expect(fs.resolve('../../..', '/home')).toBe('/')
  })
  it('후행 슬래시를 제거하되 루트는 보존한다', () => {
    expect(fs.resolve('/a/b/', '/')).toBe('/a/b')
    expect(fs.resolve('/', '/')).toBe('/')
  })
})

describe('VFS 파일 조작', () => {
  it('디렉터리를 만들고 파일을 쓰고 읽는다', () => {
    fs.mkdir('/home', { recursive: true })
    fs.writeFile('/home/a.txt', 'hello')
    expect(fs.readFile('/home/a.txt')).toBe('hello')
  })

  it('부모가 없으면 writeFile은 ENOENT', () => {
    expect(() => fs.writeFile('/nope/a.txt', 'x')).toThrow(VfsError)
    try { fs.writeFile('/nope/a.txt', 'x') } catch (e) { expect((e as VfsError).code).toBe('ENOENT') }
  })

  it('recursive 없이 중첩 mkdir은 ENOENT', () => {
    try { fs.mkdir('/a/b') } catch (e) { expect((e as VfsError).code).toBe('ENOENT') }
  })

  it('이미 있는 디렉터리에 mkdir은 EEXIST', () => {
    fs.mkdir('/a')
    try { fs.mkdir('/a') } catch (e) { expect((e as VfsError).code).toBe('EEXIST') }
  })

  it('recursive mkdir은 이미 있어도 조용하다', () => {
    fs.mkdir('/a/b', { recursive: true })
    expect(() => fs.mkdir('/a/b', { recursive: true })).not.toThrow()
  })

  it('비어있지 않은 디렉터리 rmdir은 ENOTEMPTY', () => {
    fs.mkdir('/a'); fs.writeFile('/a/f', '')
    try { fs.rmdir('/a') } catch (e) { expect((e as VfsError).code).toBe('ENOTEMPTY') }
  })

  it('rm -r 은 하위를 통째로 지운다', () => {
    fs.mkdir('/a/b', { recursive: true }); fs.writeFile('/a/b/f', 'x')
    fs.rm('/a', { recursive: true })
    expect(fs.exists('/a')).toBe(false)
  })

  it('디렉터리를 readFile 하면 EISDIR', () => {
    fs.mkdir('/a')
    try { fs.readFile('/a') } catch (e) { expect((e as VfsError).code).toBe('EISDIR') }
  })

  it('readdir은 정렬된 이름을 준다', () => {
    fs.mkdir('/a'); fs.writeFile('/a/c', ''); fs.writeFile('/a/b', ''); fs.mkdir('/a/A')
    expect(fs.readdir('/a')).toEqual(['A', 'b', 'c'])
  })

  it('appendFile은 이어붙인다', () => {
    fs.writeFile('/f', 'a'); fs.appendFile('/f', 'b')
    expect(fs.readFile('/f')).toBe('ab')
  })

  it('rename은 파일을 옮긴다', () => {
    fs.writeFile('/a', 'x'); fs.rename('/a', '/b')
    expect(fs.exists('/a')).toBe(false)
    expect(fs.readFile('/b')).toBe('x')
  })

  it('touch는 없으면 만들고 있으면 mtime만 올린다', () => {
    fs.touch('/f')
    const t1 = fs.lstat('/f')!.mtime
    fs.touch('/f')
    expect(fs.lstat('/f')!.mtime).toBeGreaterThan(t1)
    expect(fs.readFile('/f')).toBe('')
  })
})

describe('VFS 심볼릭 링크', () => {
  it('lookup은 링크를 따라가고 lstat은 따라가지 않는다', () => {
    fs.writeFile('/real', 'data')
    fs.symlink('/real', '/link')
    expect(fs.lookup('/link')!.kind).toBe('file')
    expect(fs.lstat('/link')!.kind).toBe('symlink')
    expect(fs.readFile('/link')).toBe('data')
  })

  it('끊어진 링크를 읽으면 ENOENT', () => {
    fs.symlink('/gone', '/link')
    try { fs.readFile('/link') } catch (e) { expect((e as VfsError).code).toBe('ENOENT') }
  })

  it('순환 링크는 ELOOP 대신 ENOENT로 끝난다 (무한루프 금지)', () => {
    fs.symlink('/b', '/a'); fs.symlink('/a', '/b')
    expect(() => fs.readFile('/a')).toThrow(VfsError)
  })
})

describe('VFS.chmod', () => {
  it('권한 비트를 바꾼다', () => {
    fs.writeFile('/f', '')
    fs.chmod('/f', 0o755)
    expect(fs.lstat('/f')!.mode).toBe(0o755)
  })
})

// 아래는 브리프의 18개 테스트에는 없지만, 실제 POSIX 동작(Node fs로 검증)과
// 대조해 구현이 틀렸던 부분을 고정하는 회귀 테스트다.
describe('VFS 트랩 검증', () => {
  it('lstat은 중간 경로의 심볼릭 링크는 따라가지만 마지막 구성요소는 따라가지 않는다', () => {
    fs.mkdir('/real')
    fs.writeFile('/real/c', 'x')
    fs.symlink('/real', '/a') // /a -> /real (중간 요소)
    // /a/c 의 'a'는 중간 요소이므로 링크를 따라가 /real/c 를 찾아야 한다.
    expect(fs.lstat('/a/c')!.kind).toBe('file')
    expect(fs.lstat('/a/c')!.content).toBe('x')
    // 마지막 구성요소 자체가 링크면 lstat은 그 링크 노드를 그대로 반환해야 한다.
    fs.symlink('/real/c', '/link')
    expect(fs.lstat('/link')!.kind).toBe('symlink')
  })

  it('mkdir recursive가 이미 파일인 최종 목적지를 만나면 EEXIST (ENOTDIR 아님)', () => {
    fs.writeFile('/a', 'x')
    try {
      fs.mkdir('/a', { recursive: true })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as VfsError).code).toBe('EEXIST')
    }
  })

  it('mkdir recursive가 중간 경로에서 파일을 만나면 ENOTDIR', () => {
    fs.writeFile('/a', 'x')
    try {
      fs.mkdir('/a/b/c', { recursive: true })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as VfsError).code).toBe('ENOTDIR')
    }
  })

  it('mkdir(비재귀)이 이미 있는 심볼릭 링크(끊어진 링크 포함) 위에서 EEXIST', () => {
    fs.symlink('/nowhere', '/broken')
    try {
      fs.mkdir('/broken')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as VfsError).code).toBe('EEXIST')
    }
  })

  it('unlink는 디렉터리를 가리키는 심볼릭 링크를 지울 때 링크만 지우고 대상은 남긴다', () => {
    fs.mkdir('/realdir')
    fs.writeFile('/realdir/f', 'x')
    fs.symlink('/realdir', '/link')
    fs.unlink('/link')
    expect(fs.exists('/link')).toBe(false)
    expect(fs.exists('/realdir')).toBe(true)
    expect(fs.readFile('/realdir/f')).toBe('x')
  })

  it('rm -r 도 심볼릭 링크 자체만 지우고 링크가 가리키는 디렉터리는 남긴다', () => {
    fs.mkdir('/realdir')
    fs.writeFile('/realdir/f', 'x')
    fs.symlink('/realdir', '/link')
    fs.rm('/link', { recursive: true })
    expect(fs.exists('/link')).toBe(false)
    expect(fs.exists('/realdir')).toBe(true)
  })

  it('writeFile은 부모가 파일이면 ENOTDIR', () => {
    fs.writeFile('/f', 'x')
    try {
      fs.writeFile('/f/child', 'y')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as VfsError).code).toBe('ENOTDIR')
    }
  })

  it('writeFile은 파일을 가리키는 심볼릭 링크를 통해 대상 파일에 쓰고, 링크 자체는 남긴다', () => {
    fs.writeFile('/real', 'orig')
    fs.symlink('/real', '/link')
    fs.writeFile('/link', 'new-content')
    expect(fs.lstat('/link')!.kind).toBe('symlink')
    expect(fs.readFile('/real')).toBe('new-content')
  })

  it('writeFile은 끊어진 심볼릭 링크를 통해 쓰면 그 목적지에 파일을 새로 만든다', () => {
    fs.symlink('/gone', '/link')
    fs.writeFile('/link', 'hi')
    expect(fs.readFile('/gone')).toBe('hi')
    expect(fs.lstat('/link')!.kind).toBe('symlink')
  })

  it('writeFile은 디렉터리를 가리키는 심볼릭 링크에 쓰면 EISDIR', () => {
    fs.mkdir('/realdir')
    fs.symlink('/realdir', '/link')
    try {
      fs.writeFile('/link', 'x')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as VfsError).code).toBe('EISDIR')
    }
  })

  it('rename은 디렉터리를 옮길 때 그 하위 항목을 함께 옮긴다', () => {
    fs.mkdir('/a/b', { recursive: true })
    fs.writeFile('/a/b/f', 'x')
    fs.rename('/a', '/z')
    expect(fs.exists('/a')).toBe(false)
    expect(fs.readFile('/z/b/f')).toBe('x')
  })

  it('rename은 디렉터리를 자기 자신의 하위 경로로 옮기려 하면 던진다 (트리 자기참조 방지)', () => {
    fs.mkdir('/a')
    expect(() => fs.rename('/a', '/a/sub')).toThrow(VfsError)
  })

  it('lstat과 lookup의 상호재귀는 하나의 홉 예산을 공유해야 한다 (자기 자신을 경유하는 링크)', () => {
    // '/a' -> '/a/b': lookup('/a')가 lstat('/a/b')를 부르면, 'a/b'의 중간 요소 'a'는
    // 다시 심볼릭 링크 '/a' 자신이라 lstat이 lookup을 부르고 그 lookup이 다시
    // lstat('/a/b')를 부르는 식으로 서로가 서로를 무한히 되부른다. 두 함수가 독립된
    // 홉 카운터를 쓰면 이 재귀는 절대 끝나지 않고 RangeError로 스택이 터진다.
    fs.symlink('/a/b', '/a')
    expect(fs.lookup('/a')).toBeNull()
  })

  it('자기 자신을 경유하는 링크는 exists/readFile 같은 공개 API에서도 크래시 없이 실패해야 한다', () => {
    fs.symlink('/a/b', '/a')
    expect(fs.exists('/a')).toBe(false)
    expect(() => fs.readFile('/a')).toThrow(VfsError)
  })

  it('서로를 경유하는 두 링크도 무한 재귀 없이 ENOENT(null)로 끝나야 한다', () => {
    fs.symlink('/b/x', '/a') // '/a' -> '/b/x'
    fs.symlink('/a/y', '/b') // '/b' -> '/a/y'
    expect(fs.lookup('/a')).toBeNull()
  })

  it('31단 심볼릭 링크 체인은 풀리고 32단 체인은 null이다 (공유 홉 예산의 경계)', () => {
    fs.writeFile('/real', 'ok')
    // L0 -> /real, L1 -> L0, ..., L30 -> L29  (실 파일까지 총 31개 링크)
    for (let i = 0; i < 31; i++) {
      fs.symlink(i === 0 ? '/real' : `/L${i - 1}`, `/L${i}`)
    }
    expect(fs.lookup('/L30')!.content).toBe('ok')

    // L31 -> L30 을 추가하면 실 파일까지 총 32개 링크가 되어 예산을 넘긴다.
    fs.symlink('/L30', '/L31')
    expect(fs.lookup('/L31')).toBeNull()
  })
})

// resolveLstat이 중간 경로 요소의 심볼릭 링크를 따라갈 때, 그 target이 상대경로면
// "그 심볼릭 링크 자신이 있는 디렉터리" 기준으로 풀어야 한다 — 루트 기준이 아니다.
// resolveLookup의 마지막 구성요소 처리는 이미 이렇게 하고 있었고 (this.dirname(current)
// 사용), 중간 요소 처리만 target 원문 문자열을 그대로 resolveLookup에 넘겨 루트 기준으로
// 오인했다. 아래는 그 회귀를 고정한다.
describe('VFS 심볼릭 링크: 중간 요소의 상대 target', () => {
  it('상대 target 심볼릭 링크가 중간 요소일 때 그 자신의 디렉터리 기준으로 풀린다', () => {
    fs.mkdir('/w/sub', { recursive: true })
    fs.writeFile('/w/sub/d.txt', 'hi')
    fs.symlink('sub', '/w/link') // 상대 target — '/w' 기준으로 풀려야 한다 ('/'가 아니라)
    expect(fs.exists('/w/link/d.txt')).toBe(true)
    expect(fs.readFile('/w/link/d.txt')).toBe('hi')
    expect(fs.lstat('/w/link/d.txt')!.kind).toBe('file')
    expect(fs.lstat('/w/link/d.txt')!.content).toBe('hi')
  })

  it('.. 를 포함한 상대 target도 중간 요소에서 링크 자신의 디렉터리 기준으로 풀린다', () => {
    fs.mkdir('/a/b', { recursive: true })
    fs.mkdir('/a/other', { recursive: true })
    fs.writeFile('/a/other/f', 'x')
    fs.symlink('../other', '/a/b/link') // /a/b/link -> resolve('../other','/a/b') = /a/other
    expect(fs.readFile('/a/b/link/f')).toBe('x')
  })

  it('절대 target 심볼릭 링크는 중간 요소에서도 그대로 동작한다 (회귀)', () => {
    fs.mkdir('/w/sub', { recursive: true })
    fs.writeFile('/w/sub/d.txt', 'hi')
    fs.symlink('/w/sub', '/w/abslink')
    expect(fs.readFile('/w/abslink/d.txt')).toBe('hi')
  })

  it('상대 target 심볼릭 링크가 마지막 구성요소일 때 동작은 그대로다 (회귀)', () => {
    fs.mkdir('/w/sub', { recursive: true })
    fs.writeFile('/w/sub/d.txt', 'hi')
    fs.symlink('sub', '/w/link') // 디렉터리를 가리키는 상대 링크 — 마지막 구성요소
    try {
      fs.readFile('/w/link')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as VfsError).code).toBe('EISDIR')
    }

    fs.writeFile('/w/f.txt', 'content')
    fs.symlink('f.txt', '/w/flink') // 파일을 가리키는 상대 링크 — 마지막 구성요소
    expect(fs.readFile('/w/flink')).toBe('content')
  })

  it('자기 자신을 경유하는 순환 링크는 여전히 크래시 없이 null/false로 끝난다 (회귀)', () => {
    fs.symlink('/a/b', '/a')
    expect(fs.lookup('/a')).toBeNull()
    expect(fs.exists('/a')).toBe(false)
    expect(() => fs.readFile('/a')).not.toThrow(RangeError)
    expect(() => fs.readFile('/a')).toThrow(VfsError)
  })

  it('공유 홉 예산은 중간 요소 심볼릭 링크에도 적용된다: 31단 체인은 풀리고 32단은 null', () => {
    // root의 'lnk' -> /R1, /R1의 'lnk' -> /R2, ..., /R(k-1)의 'lnk' -> /Rk 로 체인을
    // 만들고 '/lnk/lnk/.../lnk/f' (lnk가 k개)를 찾는다. 각 'lnk'는 다음 세그먼트를
    // 보기 위해 반드시 거쳐야 하는 "중간 요소"이고, target이 일반 디렉터리이므로
    // resolveLookup 내부 while 루프가 정확히 1홉씩만 소비한다. budget이 resolveLstat의
    // for 루프 전체에서 공유되지 않는다면(예: 매번 새 예산을 만들면) 이 경계는 절대
    // 나타나지 않는다.
    const buildChain = (target: VFS, k: number): void => {
      target.mkdir('/R1')
      target.symlink('/R1', '/lnk')
      for (let i = 1; i < k; i++) {
        target.mkdir(`/R${i + 1}`)
        target.symlink(`/R${i + 1}`, `/R${i}/lnk`)
      }
      target.writeFile(`/R${k}/f`, 'ok')
    }
    const path = (k: number): string => '/' + Array(k).fill('lnk').join('/') + '/f'

    buildChain(fs, 31)
    expect(fs.lookup(path(31))!.content).toBe('ok')

    const fs2 = new VFS()
    buildChain(fs2, 32)
    expect(fs2.lookup(path(32))).toBeNull()
  })
})
