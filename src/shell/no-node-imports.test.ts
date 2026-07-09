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
 * Extract all import specifiers from source code.
 * Handles: import/export from, require(), dynamic import().
 */
function extractImportSpecifiers(source: string): string[] {
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

/**
 * Check imports. Invert the logic: allow ONLY relative imports (./  or ../).
 * Returns list of bad import specifiers.
 */
function findBadImports(source: string): string[] {
  const specs = extractImportSpecifiers(source)
  return specs.filter((spec) => !spec.startsWith('./') && !spec.startsWith('../'))
}

/**
 * Strip line and block comments from source code.
 */
function stripComments(source: string): string {
  let result = ''
  let i = 0
  while (i < source.length) {
    // Check for line comment
    if (source[i] === '/' && source[i + 1] === '/') {
      i += 2
      while (i < source.length && source[i] !== '\n') i++
      if (i < source.length) result += '\n' // preserve line breaks
      i++
      continue
    }
    // Check for block comment
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') result += '\n' // preserve line breaks
        i++
      }
      i += 2
      continue
    }
    result += source[i]
    i++
  }
  return result
}

/**
 * Banned globals to scan for (as whole words).
 * Include host APIs (Node + browser) that the engine must not reference.
 */
const BANNED_GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'navigator',
  'alert', 'process', 'Buffer', '__dirname', '__filename', 'global', 'require'
]

/**
 * Check for banned globals in source (after stripping comments).
 * Returns list of bad global references.
 *
 * Uses negative lookbehind to exclude property names (like obj.process).
 * Uses negative lookahead to exclude property keys (like { process: 5 }).
 * Allows globalThis.* (e.g., globalThis.process) since globalThis is the standards-compliant global.
 */
function findBannedGlobals(source: string): string[] {
  const noComments = stripComments(source)
  const found: string[] = []
  const seen = new Set<string>()

  for (const token of BANNED_GLOBALS) {
    // Two alternatives:
    // 1. Standalone reference not preceded by dot, not followed by colon
    // 2. Reference via globalThis (which is allowed for standards like TextEncoder)
    const regex = new RegExp(`(?<!\\.)\\b${token}\\b(?!\\s*:)|globalThis\\.\\b${token}\\b`, 'u')
    if (regex.test(noComments) && !seen.has(token)) {
      found.push(token)
      seen.add(token)
    }
  }

  return found
}

describe('src/shell 엔진은 Node/DOM 전역을 참조하지 않는다', () => {
  const files = listSourceFiles(shellDir)

  it('가드 대상 파일을 실제로 찾았다(0개면 walk가 깨진 것)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  describe('import 규칙: 상대 경로만(./  ../)', () => {
    it('상대 import는 통과', () => {
      expect(findBadImports("import { readFileSync } from './file'")).toEqual([])
      expect(findBadImports("import type { T } from '../types'")).toEqual([])
      expect(findBadImports("import * as ns from './module'")).toEqual([])
    })

    it('상대 export는 통과', () => {
      expect(findBadImports("export { errnoText } from '../errors'")).toEqual([])
      expect(findBadImports("export * from './utils'")).toEqual([])
      expect(findBadImports("export type { VFS } from './vfs'")).toEqual([])
    })

    it('node: 프리픽스는 금지', () => {
      expect(findBadImports("import { readFileSync } from 'node:fs'")).toContain('node:fs')
      expect(findBadImports("import os from 'node:os'")).toContain('node:os')
    })

    it('Node 모듈 베어 임포트는 금지', () => {
      expect(findBadImports("import { randomUUID } from 'crypto'")).toContain('crypto')
      expect(findBadImports("import os from 'os'")).toContain('os')
      expect(findBadImports("import { EventEmitter } from 'events'")).toContain('events')
      expect(findBadImports("import { parse } from 'url'")).toContain('url')
    })

    it('require() 는 node 모듈을 금지', () => {
      expect(findBadImports("require('fs')")).toContain('fs')
      expect(findBadImports("const path = require('path')")).toContain('path')
    })

    it('동적 import() 는 node 모듈을 금지', () => {
      expect(findBadImports("await import('node:path')")).toContain('node:path')
      expect(findBadImports("const m = await import('crypto')")).toContain('crypto')
    })
  })

  describe('전역 규칙: 호스트 전용 API 금지 (주석 제외)', () => {
    it('상대경로 import type은 통과', () => {
      expect(findBannedGlobals("import type { VFS } from './vfs'")).toEqual([])
    })

    it('TextEncoder 전역은 통과 (웹 표준, 사용 가능)', () => {
      expect(findBannedGlobals("const encoder = new TextEncoder()")).toEqual([])
    })

    it('Buffer.from() 은 금지', () => {
      expect(findBannedGlobals("const x = Buffer.from('a')")).toContain('Buffer')
    })

    it('__dirname, __filename 은 금지', () => {
      expect(findBannedGlobals("const dir = __dirname")).toContain('__dirname')
      expect(findBannedGlobals("const file = __filename")).toContain('__filename')
    })

    it('process 는 금지', () => {
      expect(findBannedGlobals("const env = process.env")).toContain('process')
    })

    it('global, globalThis.process 는 금지', () => {
      expect(findBannedGlobals("const g = global")).toContain('global')
      expect(findBannedGlobals("const p = globalThis.process")).toContain('process')
    })

    it('require 전역함수는 금지', () => {
      expect(findBannedGlobals("const mod = require('module')")).toContain('require')
    })

    it('require 함수 이름 아니면 통과: processLine 변수, .process 속성', () => {
      expect(findBannedGlobals("let processLine = 1")).not.toContain('process')
      expect(findBannedGlobals("const obj = { process: 5 }")).not.toContain('process')
      expect(findBannedGlobals("obj.process = 10")).not.toContain('process')
    })

    it('주석 속 금지어는 무시', () => {
      expect(findBannedGlobals("// document.title")).toEqual([])
      expect(findBannedGlobals("/* window.alert() */")).toEqual([])
      expect(findBannedGlobals("const x = 5 // process.env")).toEqual([])
    })

    it('DOM 전역 금지: window, document, localStorage, sessionStorage, navigator, alert', () => {
      expect(findBannedGlobals("window.location")).toContain('window')
      expect(findBannedGlobals("document.getElementById('x')")).toContain('document')
      expect(findBannedGlobals("localStorage.setItem('k', 'v')")).toContain('localStorage')
      expect(findBannedGlobals("sessionStorage.getItem('k')")).toContain('sessionStorage')
      expect(findBannedGlobals("navigator.userAgent")).toContain('navigator')
      expect(findBannedGlobals("alert('hi')")).toContain('alert')
    })
  })

  for (const file of files) {
    const rel = file.slice(shellDir.length + 1)
    it(`${rel}: 상대 임포트만, 금지된 전역 없음`, () => {
      const source = readFileSync(file, 'utf8')
      const badImports = findBadImports(source)
      const badGlobals = findBannedGlobals(source)
      const violations: string[] = [
        ...badImports.map((spec) => `import '${spec}'`),
        ...badGlobals.map((token) => `전역 '${token}'`),
      ]

      expect(violations, `src/shell/${rel} references: ${violations.join(', ')}`).toEqual([])
    })
  }
})
