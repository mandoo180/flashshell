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
})
