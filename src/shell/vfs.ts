import { VfsError } from './errors'

export type NodeKind = 'file' | 'dir' | 'symlink'

export interface VNode {
  kind: NodeKind
  mode: number
  content: string
  target: string
  children: Map<string, VNode>
  mtime: number
}

const MAX_SYMLINK_HOPS = 32

function makeNode(kind: NodeKind, mode: number, mtime: number): VNode {
  return { kind, mode, content: '', target: '', children: new Map(), mtime }
}

export class VFS {
  private root: VNode
  private clock = 1

  constructor() {
    this.root = makeNode('dir', 0o755, this.clock)
  }

  private tick(): number { return ++this.clock }

  resolve(path: string, cwd: string): string {
    const start = path.startsWith('/') ? '/' : cwd
    const segments = `${start}/${path}`.split('/')
    const stack: string[] = []
    for (const seg of segments) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') { stack.pop(); continue }
      stack.push(seg)
    }
    return '/' + stack.join('/')
  }

  private split(abs: string): string[] {
    return abs.split('/').filter((s) => s !== '')
  }

  /** 심볼릭 링크를 따라가지 않고 노드를 찾는다. 중간 경로 요소가 링크면 그것은 따라간다. */
  lstat(abs: string): VNode | null {
    return this.resolveLstat(abs, { hops: MAX_SYMLINK_HOPS })
  }

  /** 심볼릭 링크를 끝까지 따라간다. */
  lookup(abs: string): VNode | null {
    return this.resolveLookup(abs, { hops: MAX_SYMLINK_HOPS })
  }

  /**
   * lstat과 lookup은 서로를 호출하는 상호재귀 구조다: 중간 경로 요소가 심볼릭 링크면
   * lstat이 lookup을 부르고, lookup은 각 홉마다 lstat을 부른다. 두 함수가 각자 독립된
   * 홉 카운터를 쓰면, 링크의 target이 그 링크 자신을 다시 중간 경로 요소로 거치는
   * 경우 (예: symlink('/a/b', '/a') — '/a'가 자기 자신을 통해야 도달하는 '/a/b'를
   * 가리킨다) 재귀할 때마다 카운터가 리셋되어 무한 재귀에 빠지고 RangeError로 죽는다.
   * budget 객체를 참조로 공유해 lstat<->lookup 상호재귀 전체가 하나의 32홉 예산을
   * 소비하도록 한다 — 예산이 바닥나면 어느 쪽에서든 즉시 null로 되돌아온다.
   */
  private resolveLstat(abs: string, budget: { hops: number }): VNode | null {
    const parts = this.split(abs)
    let node: VNode = this.root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      // 중간 경로 요소는 반드시 디렉터리여야 한다. 링크면 따라간다.
      if (node.kind === 'symlink') {
        if (budget.hops <= 0) return null
        const resolved = this.resolveLookup(node.target, budget)
        if (!resolved) return null
        node = resolved
      }
      if (node.kind !== 'dir') return null
      const child = node.children.get(name)
      if (!child) return null
      node = child
    }
    return node
  }

  private resolveLookup(abs: string, budget: { hops: number }): VNode | null {
    let current = abs
    while (budget.hops > 0) {
      budget.hops--
      const node = this.resolveLstat(current, budget)
      if (!node) return null
      if (node.kind !== 'symlink') return node
      current = node.target.startsWith('/') ? node.target : this.resolve(node.target, this.dirname(current))
    }
    return null // 순환/예산 소진. ENOENT로 취급한다.
  }

  private dirname(abs: string): string {
    const parts = this.split(abs)
    parts.pop()
    return '/' + parts.join('/')
  }

  private basename(abs: string): string {
    const parts = this.split(abs)
    return parts[parts.length - 1] ?? ''
  }

  /** 부모 디렉터리 노드를 얻는다. 없거나 디렉터리가 아니면 던진다. */
  private parentDir(abs: string): VNode {
    const parent = this.dirname(abs)
    const node = this.lookup(parent)
    if (!node) throw new VfsError('ENOENT', parent)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', parent)
    return node
  }

  /**
   * writeFile 대상 경로 마지막 구성요소가 심볼릭 링크 체인이면, 그 링크가 가리키는
   * 최종 목적지 경로로 치환한다 (open(2)이 쓰기용으로 열 때 마지막 심볼릭 링크를
   * 따라가는 것과 동일). 순환이면 ENOENT로 취급한다. 링크가 아니면 그대로 반환한다.
   */
  private resolveWriteTarget(abs: string): string {
    let current = abs
    for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop++) {
      const raw = this.lstat(current)
      if (!raw || raw.kind !== 'symlink') return current
      current = raw.target.startsWith('/') ? raw.target : this.resolve(raw.target, this.dirname(current))
    }
    throw new VfsError('ENOENT', abs) // 순환
  }

  exists(abs: string): boolean { return this.lookup(abs) !== null }

  isDir(abs: string): boolean { return this.lookup(abs)?.kind === 'dir' }

  readFile(abs: string): string {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind === 'dir') throw new VfsError('EISDIR', abs)
    return node.content
  }

  writeFile(abs: string, content: string, mode = 0o644): void {
    // 마지막 구성요소가 심볼릭 링크면 그 목적지에 쓴다 (링크 자체를 대체하지 않는다).
    const target = this.resolveWriteTarget(abs)
    const parent = this.parentDir(target)
    const name = this.basename(target)
    const existing = parent.children.get(name)
    if (existing?.kind === 'dir') throw new VfsError('EISDIR', abs)
    if (existing?.kind === 'file') {
      existing.content = content
      existing.mtime = this.tick()
      return
    }
    const node = makeNode('file', mode, this.tick())
    node.content = content
    parent.children.set(name, node)
  }

  appendFile(abs: string, content: string): void {
    if (!this.exists(abs)) { this.writeFile(abs, content); return }
    this.writeFile(abs, this.readFile(abs) + content)
  }

  readdir(abs: string): string[] {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', abs)
    return [...node.children.keys()].sort()
  }

  mkdir(abs: string, opts: { recursive?: boolean } = {}): void {
    if (opts.recursive) {
      const parts = this.split(abs)
      let current = ''
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!
        current += '/' + part
        const node = this.lookup(current)
        if (node?.kind === 'dir') continue
        // 마지막 구성요소가 디렉터리가 아닌 무언가로 이미 있으면 EEXIST,
        // 중간 구성요소가 막고 있으면 ENOTDIR (mkdir -p의 실제 errno와 동일).
        if (node) throw new VfsError(i === parts.length - 1 ? 'EEXIST' : 'ENOTDIR', current)
        this.parentDir(current).children.set(part, makeNode('dir', 0o755, this.tick()))
      }
      return
    }
    // mkdir(2)는 마지막 구성요소가 무엇이든(파일/디렉터리/링크) 이미 있으면 EEXIST다.
    // 심볼릭 링크를 따라가지 않으므로 lstat으로 확인한다.
    if (this.lstat(abs)) throw new VfsError('EEXIST', abs)
    this.parentDir(abs).children.set(this.basename(abs), makeNode('dir', 0o755, this.tick()))
  }

  rmdir(abs: string): void {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', abs)
    if (node.children.size > 0) throw new VfsError('ENOTEMPTY', abs)
    this.parentDir(abs).children.delete(this.basename(abs))
  }

  unlink(abs: string): void {
    const node = this.lstat(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind === 'dir') throw new VfsError('EISDIR', abs)
    this.parentDir(abs).children.delete(this.basename(abs))
  }

  rm(abs: string, opts: { recursive?: boolean } = {}): void {
    const node = this.lstat(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    if (node.kind === 'dir' && !opts.recursive) throw new VfsError('EISDIR', abs)
    this.parentDir(abs).children.delete(this.basename(abs))
  }

  rename(from: string, to: string): void {
    const node = this.lstat(from)
    if (!node) throw new VfsError('ENOENT', from)
    // 디렉터리를 자기 자신의 하위 경로로 옮기면 트리가 자기 자신을 참조하게 되어
    // rm/readdir 등이 무한루프에 빠진다. 실제 rename(2)도 EINVAL로 거부한다.
    if (node.kind === 'dir' && (to === from || to.startsWith(from + '/'))) {
      throw new VfsError('EINVAL', to)
    }
    const destParent = this.parentDir(to)
    this.parentDir(from).children.delete(this.basename(from))
    node.mtime = this.tick()
    destParent.children.set(this.basename(to), node)
  }

  symlink(target: string, abs: string): void {
    const parent = this.parentDir(abs)
    if (parent.children.has(this.basename(abs))) throw new VfsError('EEXIST', abs)
    const node = makeNode('symlink', 0o777, this.tick())
    node.target = target
    parent.children.set(this.basename(abs), node)
  }

  chmod(abs: string, mode: number): void {
    const node = this.lookup(abs)
    if (!node) throw new VfsError('ENOENT', abs)
    node.mode = mode
    node.mtime = this.tick()
  }

  touch(abs: string): void {
    const node = this.lookup(abs)
    if (!node) { this.writeFile(abs, ''); return }
    node.mtime = this.tick()
  }
}
