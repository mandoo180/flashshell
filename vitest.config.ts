import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: 'shell', environment: 'node', include: ['src/shell/**/*.test.ts', 'tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'ui', environment: 'jsdom', include: ['src/ui/**/*.test.tsx'], setupFiles: ['./src/ui/test-setup.ts'] },
      },
    ],
  },
})
