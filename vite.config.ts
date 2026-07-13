import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 프로젝트 사이트(https://<user>.github.io/flashshell/)는 하위 경로에서
  // 서빙되므로 배포 빌드만 base 를 바꾼다. 로컬 dev/e2e 는 '/' 그대로 — Playwright
  // baseURL(localhost:5173)과 기존 테스트가 영향받지 않는다. CI 의 deploy 잡이
  // DEPLOY_BASE=/flashshell/ 로 빌드한다(.github/workflows/ci.yml).
  base: process.env.DEPLOY_BASE ?? '/',
})
