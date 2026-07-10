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

  // Hang 3 회귀: 옛 구현은 재귀 mkdir에서 구성요소마다 this.lookup(current)와
  // this.parentDir(current)를 새로 불렀는데 둘 다 루트부터 전체 경로를 다시 훑어
  // O(N^2)이었다. 5000단은 O(N^2)이면 이미 눈에 띄게 느려지지만(약 25,000,000
  // 단계 규모), O(N)이면 순식간에 끝난다. 실제 hang 재현(4만 단)보다 얕지만 테스트가
  // 빠르게 끝나면서도 이차 시간이면 확연히 느려지는 지점으로 골랐다.
  it('mkdir -p 로 깊은 경로를 올바르게 만들고, 비용이 선형이다 (O(n^2) 아님)', () => {
    // 정확성: 깊은 경로가 전부 만들어지고 최종 노드 모드가 맞다.
    const deep = '/' + Array(5000).fill('x').join('/')
    fs.mkdir(deep, { recursive: true })
    expect(fs.isDir(deep)).toBe(true)
    expect(fs.lstat(deep)!.mode).toBe(0o755)

    // 비용: 깊이를 4배로 늘리면 선형은 ~4배, O(n^2)는 ~16배가 든다.
    // 하드웨어 속도와 무관하게 그 사이(10배)에서 자른다. 절대 임계값은
    // 빠른 머신에서 O(n^2)를 놓칠 수 있어 점근 비율로 검증한다.
    // 각 깊이를 여러 번 재고 최소값을 쓴다 — 최소값은 GC/스케줄러가 끼어든
    // 오염된 실행에 강건하다(병렬 테스트 부하에서 단일 측정이 튀어도 안 흔들림).
    const measure = (depth: number): number => {
      let best = Infinity
      for (let i = 0; i < 3; i++) {
        const local = new VFS()
        const path = '/' + Array(depth).fill('y').join('/')
        const start = performance.now()
        local.mkdir(path, { recursive: true })
        best = Math.min(best, performance.now() - start)
      }
      return best
    }
    measure(1000) // 워밍업으로 JIT 초기 노이즈를 흡수한다.
    const small = Math.max(measure(2000), 0.5)
    const large = measure(8000)
    // O(n): ~4. O(n^2): ~16. 10에서 자르면 부하가 있어도 오탐 없이 O(n^2)를 잡는다.
    expect(large / small).toBeLessThan(10)
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
    // 링크를 따라갈 때 정확히 1홉씩만 소비한다. budget이 전체 걷기에서 공유되지
    // 않는다면 (예: 매번 새 예산을 만들면) 이 경계는 절대 나타나지 않는다.
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

// 물리 경로 추적 회귀: resolvePhysical은 경로를 한 번만 훑으면서 "지금 서 있는
// 디렉터리의 물리 절대경로"(dirAbs)를 들고 다녀야 한다. 상대 target 중간 링크가
// 여러 개 겹치면, 각 링크는 자기 자신이 실제로 놓인 물리 디렉터리 기준으로 풀려야
// 한다 — 원래 조회 경로의 어휘적(pre-resolution) 접두가 아니다. 아래 기대값은 모두
// 실제 bash 5.2에서 실행해 확인했다.
describe('VFS 심볼릭 링크: 겹친 상대 target 중간 요소 (물리 경로 추적)', () => {
  it('..-상대 target 중간 링크 두 개가 겹쳐도 풀린다 (실제 bash: cat R1/lnk/lnk/f)', () => {
    fs.mkdir('/R1'); fs.mkdir('/R2'); fs.mkdir('/R3')
    fs.symlink('../R2', '/R1/lnk') // /R1/lnk -> ../R2  => /R2
    fs.symlink('../R3', '/R2/lnk') // /R2/lnk -> ../R3  => /R3
    fs.writeFile('/R3/f', 'content-1')
    expect(fs.exists('/R1/lnk/lnk/f')).toBe(true)
    expect(fs.readFile('/R1/lnk/lnk/f')).toBe('content-1')
  })

  it('상대/절대가 섞인 중간 링크 세 개가 겹쳐도 풀린다', () => {
    fs.mkdir('/A'); fs.mkdir('/B'); fs.mkdir('/C'); fs.mkdir('/D')
    fs.symlink('../B', '/A/lnk') // 상대 -> /B
    fs.symlink('/C', '/B/lnk')   // 절대 -> /C
    fs.symlink('../D', '/C/lnk') // 상대 -> /D
    fs.writeFile('/D/f', 'content-2')
    expect(fs.exists('/A/lnk/lnk/lnk/f')).toBe(true)
    expect(fs.readFile('/A/lnk/lnk/lnk/f')).toBe('content-2')
  })

  it('앞으로-상대(forward-relative) 중첩 체인 depth 10이 풀린다 (홉이 선형임을 증명)', () => {
    // lvl0/lnk -> lvl1, lvl0/lvl1/lnk -> lvl2, ... 각 lnk는 자기 디렉터리 안의 다음
    // 레벨 디렉터리를 상대로 가리킨다. 옛 코드는 중간 링크마다 루트부터 전체 접두를
    // 다시 걸어 홉을 제곱으로 소비했고 (k(k+1)/2), 32홉 예산이 k>=6에서 바닥났다.
    // 물리 경로를 들고 다니면 링크당 정확히 1홉이라 depth 10도 여유롭게 풀린다.
    let dir = '/lvl0'
    fs.mkdir(dir)
    for (let k = 1; k <= 10; k++) {
      fs.symlink(`lvl${k}`, `${dir}/lnk`)
      dir = `${dir}/lvl${k}`
      fs.mkdir(dir)
    }
    fs.writeFile(`${dir}/f`, 'deep-content')
    const path = '/lvl0/' + Array(10).fill('lnk').join('/') + '/f'
    expect(fs.exists(path)).toBe(true)
    expect(fs.readFile(path)).toBe('deep-content')
  })

  it('상대 target 링크 31단은 풀리고 32단은 null — 절대 체인과 같은 경계 (링크당 1홉)', () => {
    // 상대 target 체인: L0 -> real, L1 -> L0, ... 모두 루트 안, 상대 경로.
    fs.writeFile('/real', 'ok')
    for (let i = 0; i < 31; i++) {
      fs.symlink(i === 0 ? 'real' : `L${i - 1}`, `/L${i}`)
    }
    expect(fs.lookup('/L30')!.content).toBe('ok')
    fs.symlink('L30', '/L31')
    expect(fs.lookup('/L31')).toBeNull()

    // 절대 target도 정확히 같은 31/32 경계 (한쪽을 깨서 다른 쪽을 만족시키지 못하게
    // 두 체계를 한 테스트에서 함께 못박는다).
    const abs = new VFS()
    abs.writeFile('/real', 'ok')
    for (let i = 0; i < 31; i++) {
      abs.symlink(i === 0 ? '/real' : `/A${i - 1}`, `/A${i}`)
    }
    expect(abs.lookup('/A30')!.content).toBe('ok')
    abs.symlink('/A30', '/A31')
    expect(abs.lookup('/A31')).toBeNull()
  })

  it('세 가지 순환 링크는 여전히 throw 없이 null이다 (자기경유/상호경유/상대 자기순환)', () => {
    const a = new VFS(); a.symlink('/a/b', '/a')
    expect(() => a.lookup('/a')).not.toThrow()
    expect(a.lookup('/a')).toBeNull()

    const b = new VFS(); b.symlink('/b/x', '/a'); b.symlink('/a/y', '/b')
    expect(() => b.lookup('/a')).not.toThrow()
    expect(b.lookup('/a')).toBeNull()

    const c = new VFS(); c.mkdir('/w'); c.symlink('link', '/w/link') // 상대 자기순환
    expect(() => c.lookup('/w/link')).not.toThrow()
    expect(c.lookup('/w/link')).toBeNull()
  })

  it('상대 target이 마지막 구성요소일 때 lstat은 링크를, lookup은 대상을 준다', () => {
    fs.mkdir('/w')
    fs.writeFile('/w/f.txt', 'body')
    fs.symlink('f.txt', '/w/flink') // 상대 마지막 구성요소
    expect(fs.lstat('/w/flink')!.kind).toBe('symlink')
    expect(fs.lookup('/w/flink')!.kind).toBe('file')
    expect(fs.readFile('/w/flink')).toBe('body')
  })

  it('첫 구성요소가 심볼릭 링크여도 동작한다 (내부에서 // 나 빈 문자열 생성 금지)', () => {
    fs.mkdir('/w')
    fs.writeFile('/w/d.txt', 'D')
    fs.symlink('w', '/link') // /link -> w (상대, 루트 기준)
    expect(fs.exists('/link/d.txt')).toBe(true)
    expect(fs.readFile('/link/d.txt')).toBe('D')
    // 절대 target 첫 구성요소도 동일하게.
    fs.symlink('/w', '/alink')
    expect(fs.readFile('/alink/d.txt')).toBe('D')
  })
})
