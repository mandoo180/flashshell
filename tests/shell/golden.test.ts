import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createShell, VFS } from '../../src/shell/index'

const here = dirname(fileURLToPath(import.meta.url))
const golden = join(here, 'golden')

/** seed.sh 와 동일한 초기 상태를 VFS 위에 직접 만든다. */
function seedVfs(): VFS {
  const fs = new VFS()
  fs.mkdir('/work/project/src', { recursive: true })
  fs.mkdir('/work/project/docs', { recursive: true })
  fs.mkdir('/work/empty', { recursive: true })
  fs.writeFile('/work/a.txt', 'alpha\n')
  fs.writeFile('/work/b.txt', 'beta\n')
  fs.writeFile('/work/project/src/one.txt', 'one\n')
  fs.writeFile('/work/project/src/two.txt', 'two\n')
  fs.writeFile('/work/project/docs/note.md', 'note\n')
  fs.writeFile('/work/fruit.txt', 'banana\napple\ncherry\napple\n')
  fs.writeFile('/work/nums.txt', '10\n9\n100\n')
  fs.writeFile('/work/mixed.txt', 'Hello\nhello\nWORLD\n')
  fs.mkdir('/work/tree/sub', { recursive: true })
  fs.writeFile('/work/pairs.txt', 'alice 30\nbob 25\ncarol 35\n')
  fs.writeFile('/work/colon.txt', 'a:b:c\nd:e:f\n')
  fs.writeFile('/work/adj.txt', 'a\na\nb\nc\nc\n')
  fs.writeFile('/work/tree/one.txt', '1\n')
  fs.writeFile('/work/tree/two.log', '2\n')
  fs.writeFile('/work/tree/sub/three.txt', '3\n')
  fs.writeFile('/work/diffA.txt', 'hello\nworld\n')
  fs.writeFile('/work/diffB.txt', 'hello\nworld\n')
  fs.writeFile('/work/diffC.txt', 'hello\nWORLD\n')
  return fs
}

interface Expected { stdout: string; stderr: string; exitCode: number }

function parseExpected(raw: string): Expected {
  const stderrAt = raw.indexOf('\n===STDERR===\n')
  const exitAt = raw.indexOf('===EXIT===\n')
  return {
    stdout: raw.slice(0, stderrAt),
    stderr: raw.slice(stderrAt + '\n===STDERR===\n'.length, exitAt),
    exitCode: Number(raw.slice(exitAt + '===EXIT===\n'.length).trim()),
  }
}

/** 케이스 파일의 각 줄을 순서대로 실행하고 출력을 이어붙인다. */
async function runCase(script: string): Promise<Expected> {
  const sh = createShell({ fs: seedVfs(), cwd: '/work', home: '/work' })
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  for (const line of script.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const result = await sh.exec(trimmed)
    stdout += result.stdout
    stderr += result.stderr
    exitCode = result.exitCode
  }
  return { stdout, stderr, exitCode }
}

const caseFiles = readdirSync(join(golden, 'cases')).filter((f) => f.endsWith('.sh')).sort()

describe('진짜 bash 대조', () => {
  for (const file of caseFiles) {
    const name = basename(file, '.sh')
    it(name, async () => {
      const script = readFileSync(join(golden, 'cases', file), 'utf8')
      const expected = parseExpected(readFileSync(join(golden, 'expected', `${name}.txt`), 'utf8'))
      const actual = await runCase(script)

      expect(actual.stdout).toBe(expected.stdout)
      expect(actual.stderr).toBe(expected.stderr)
      expect(actual.exitCode).toBe(expected.exitCode)
    })
  }
})
