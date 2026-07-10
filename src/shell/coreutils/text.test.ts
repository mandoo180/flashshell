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
