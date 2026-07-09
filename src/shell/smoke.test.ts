import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs vitest in node environment', () => {
    expect(typeof globalThis.document).toBe('undefined')
  })
})
