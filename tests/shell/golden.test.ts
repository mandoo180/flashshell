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
  fs.writeFile('/work/conf.sh', 'x=5\ny=hello\n')
  fs.writeFile('/work/greet.sh', '#!/bin/bash\necho hello from script\n', 0o755)
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

const WHOLE_FILE_MARKER = '# GOLDEN: whole-file'

/**
 * 케이스 파일의 각 줄을 순서대로 실행하고 출력을 이어붙인다(기존 36개 line-by-line 케이스).
 * here-doc 처럼 본문이 여러 물리 줄에 걸치는 구조는 줄 단위 실행으로는 표현할 수 없다
 * (본문 줄들이 개별 명령으로 오인되어 exec 된다) — 그런 케이스는 whole-file 모드를 쓴다.
 */
async function runCaseLineByLine(script: string): Promise<Expected> {
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

/**
 * opt-in whole-file 모드(첫 줄이 `# GOLDEN: whole-file`인 케이스): 파일 전체를 단 한 번의
 * `sh.exec`로 넘긴다. 렉서가 이미 개행을 `;`로 접고 `#` 주석을 스스로 건너뛰므로, 마커
 * 줄을 포함한 원문을 그대로 넘겨도 마커는 평범한 주석으로 무시된다 — 별도 스트리핑 불필요.
 * gen-golden.sh 도 케이스 파일을 bash 에 통째로 넘기므로(whole-file), 이 모드의 `.txt` 는
 * 이미 정확하다: 테스트만 그 실행 방식을 맞춰주면 된다.
 */
async function runCaseWholeFile(script: string): Promise<Expected> {
  const sh = createShell({ fs: seedVfs(), cwd: '/work', home: '/work' })
  const result = await sh.exec(script)
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
}

async function runCase(script: string): Promise<Expected> {
  return script.startsWith(WHOLE_FILE_MARKER) ? runCaseWholeFile(script) : runCaseLineByLine(script)
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
