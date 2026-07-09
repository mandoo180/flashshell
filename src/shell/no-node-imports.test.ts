import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 이 파일 자체(테스트)는 node:fs/node:path 를 쓴다 — 금지 대상은 src/shell 엔진
 * (이 파일을 제외한, src/shell 이하 모든 .ts 파일)뿐이다. tsconfig 의
 * `types: ["vitest/globals", "node"]` 때문에 Node 전역 타입이 src/shell 전체에서
 * 보이게 됐고, 그 결과 예전엔 타입 체크가 기계적으로 막아주던 "엔진은 Node/DOM에
 * 의존하지 않는다"는 규칙이 이제 컨벤션에 불과해졌다. 이 테스트가 그 기계적
 * 가드를 대신한다.
 */
const shellDir = dirname(fileURLToPath(import.meta.url))

const BANNED_IMPORTS: RegExp[] = [/^node:/, /^fs$/, /^fs\//, /^path$/, /^path\//, /^child_process$/, /^child_process\//]
const BANNED_GLOBALS = ['window', 'document', 'localStorage', 'process']

/** src/shell 아래 *.ts 파일을 재귀적으로 모은다. *.test.ts 는 제외한다. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (extname(entry) === '.ts' && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

/**
 * `import ... from '...'`, `export ... from '...'`, `require('...')`,
 * `import('...')` 뒤에 오는 모듈 스펙파이어를 전부 뽑는다.
 */
function importSpecifiers(source: string): string[] {
  const re =
    /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  const specs: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (spec !== undefined) specs.push(spec)
  }
  return specs
}

describe('src/shell 엔진은 Node/DOM 전역을 참조하지 않는다', () => {
  const files = listSourceFiles(shellDir)

  it('가드 대상 파일을 실제로 찾았다(0개면 walk가 깨진 것)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const file of files) {
    const rel = file.slice(shellDir.length + 1)
    it(`${rel}: node 임포트도, window/document/localStorage/process 참조도 없다`, () => {
      const source = readFileSync(file, 'utf8')
      const violations: string[] = []

      for (const spec of importSpecifiers(source)) {
        if (BANNED_IMPORTS.some((re) => re.test(spec))) {
          violations.push(`import '${spec}'`)
        }
      }
      for (const token of BANNED_GLOBALS) {
        if (new RegExp(`\\b${token}\\b`).test(source)) {
          violations.push(`전역 '${token}'`)
        }
      }

      expect(violations, `src/shell/${rel} references Node/DOM-only API(s): ${violations.join(', ')}`).toEqual([])
    })
  }
})
