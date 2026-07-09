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
    return this.resolvePhysical(abs, { hops: MAX_SYMLINK_HOPS }, false)?.node ?? null
  }

  /** 심볼릭 링크를 끝까지 따라간다. */
  lookup(abs: string): VNode | null {
    return this.resolvePhysical(abs, { hops: MAX_SYMLINK_HOPS }, true)?.node ?? null
  }

  /**
   * abs를 물리 노드와 그 물리 절대경로로 해석한다. 경로를 왼→오로 딱 한 번 훑으면서
   * "지금 서 있는 디렉터리의 물리 절대경로"(dirAbs)를 들고 다닌다. dirAbs는 '/'에서
   * 출발한다.
   *
   * - 요소로 내려가려면 현재 노드가 디렉터리여야 한다 (아니면 null — ENOTDIR 취급).
   * - 방금 밟은 자식이 심볼릭 링크면:
   *   · 마지막 구성요소이고 followFinal=false면 (lstat) 그 링크 노드를 그대로 돌려준다.
   *   · 아니면 따라간다: 공유 예산에서 정확히 1홉을 쓰고, target이 절대면 그대로,
   *     상대면 this.resolve(target, dirAbs)로 (즉 "그 링크가 실제로 놓인 물리
   *     디렉터리" 기준으로 — 조회 경로의 어휘적 접두가 아니라) 절대경로를 만든 뒤
   *     같은 budget으로 재귀 해석한다. 링크를 따라간 뒤 dirAbs는 착지한 노드의 물리
   *     경로가 된다. 이래야 상대 target 링크가 여러 개 겹쳐도 각 링크가 자기 실제
   *     위치 기준으로 풀린다.
   * - 일반 디렉터리/파일 진입은 0홉이다. 비용은 "따라간 링크 수"에 선형이며, 이게
   *   원래 32홉 예산이 재려던 값이다 (예산은 순환을 막기 위한 것이지 합법적 깊이를
   *   다섯으로 제한하려던 게 아니다).
   *
   * 홉 규약: 링크를 따라가기 직전에 감소시키고 0 이하가 되면 null. 예산 32에서 최대
   * 31번까지 따라갈 수 있어 (32번째 감소가 0을 만들어 컷) 절대/상대/중간 요소 어느
   * 체인이든 31단은 풀리고 32단은 null인 기존 경계가 그대로 유지된다. 예산이
   * 바닥나면(순환 포함) null을 돌려준다 — 절대 던지지 않고 절대 무한루프하지 않는다.
   * 재귀는 같은 budget 객체를 넘기는 한 안전하다.
   */
  private resolvePhysical(
    abs: string,
    budget: { hops: number },
    followFinal: boolean,
  ): { node: VNode; path: string } | null {
    const parts = this.split(abs)
    let node: VNode = this.root
    let dirAbs = '/'
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      if (node.kind !== 'dir') return null // ENOTDIR 취급
      const child = node.children.get(name)
      if (!child) return null // ENOENT 취급
      const childPath = dirAbs === '/' ? `/${name}` : `${dirAbs}/${name}`
      const isFinal = i === parts.length - 1
      if (child.kind === 'symlink' && !(isFinal && !followFinal)) {
        // 링크를 따라간다: 정확히 1홉을 쓴다.
        budget.hops--
        if (budget.hops <= 0) return null // 순환/예산 소진 → ENOENT 취급
        const targetAbs = child.target.startsWith('/')
          ? child.target
          : this.resolve(child.target, dirAbs)
        const resolved = this.resolvePhysical(targetAbs, budget, true)
        if (!resolved) return null
        node = resolved.node
        dirAbs = resolved.path
      } else {
        node = child
        dirAbs = childPath
      }
    }
    return { node, path: dirAbs }
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
      // 이전 구현은 매 구성요소마다 this.lookup(current)와 this.parentDir(current)를
      // 불렀는데, 둘 다 루트부터 전체 경로를 다시 훑는다 — N단 경로에 O(N^2). 여기서는
      // "지금 서 있는 디렉터리 노드"(node)와 그 물리 절대경로(dirAbs)를 들고 다니며 한
      // 구성요소씩 내려가므로 전체가 O(N)이다. 매 구성요소는 다시 lookup하지 않는다.
      const parts = this.split(abs)
      let node: VNode = this.root
      let dirAbs = '/'
      let current = ''
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!
        current += '/' + part
        const isFinal = i === parts.length - 1

        let hit: VNode | null = node.children.get(part) ?? null
        let hitPath = dirAbs === '/' ? `/${part}` : `${dirAbs}/${part}`
        if (hit !== null && hit.kind === 'symlink') {
          // lookup()과 동일하게: 이 구성요소가 심볼릭 링크면 끝까지 따라간다. 매
          // 구성요소마다 새 홉 예산을 준다 — resolvePhysical의 다른 모든 호출부와
          // 같은 계약("한 단계 해석은 순환/체인에도 무한루프하지 않는다")이다.
          const targetAbs = hit.target.startsWith('/') ? hit.target : this.resolve(hit.target, dirAbs)
          const resolved = this.resolvePhysical(targetAbs, { hops: MAX_SYMLINK_HOPS }, true)
          hit = resolved ? resolved.node : null
          hitPath = resolved ? resolved.path : hitPath
        }

        if (hit !== null && hit.kind === 'dir') { node = hit; dirAbs = hitPath; continue }
        // 마지막 구성요소가 디렉터리가 아닌 무언가로 이미 있으면 EEXIST,
        // 중간 구성요소가 막고 있으면 ENOTDIR (mkdir -p의 실제 errno와 동일).
        if (hit !== null) throw new VfsError(isFinal ? 'EEXIST' : 'ENOTDIR', current)

        const created = makeNode('dir', 0o755, this.tick())
        node.children.set(part, created)
        node = created
        dirAbs = hitPath
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
