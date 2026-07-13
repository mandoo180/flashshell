# FlashShell 배포 설계 — GitHub Pages + 풀 게이트 CI

날짜: 2026-07-13. 대상: main @ b2b3e65 (60문제, 게이트 1786 unit/11 e2e/39 golden). 접근: **A. 단일 워크플로, Actions-네이티브 Pages** (승인됨 — public 리포 생성·푸시·배포 포함).

## 확정된 결정

- **호스팅**: GitHub Pages (소스 = GitHub Actions, gh-pages 브랜치 없음). URL `https://mandoo180.github.io/flashshell/`.
- **리포**: `mandoo180/flashshell`, **public** (무료 Pages 조건). 전체 히스토리 푸시. 공개 전 보안 감사 완료(시크릿·히스토리·절대경로·개인정보 — 클린, 노출은 커밋 author 이메일뿐이며 계정 공개 신원과 동일).
- **CI 범위 = 풀 게이트**: push/PR마다 build + vitest + Playwright e2e + **골든 Docker 재생성 바이트 동일 검증**(`npm run golden` 후 `git diff --exit-code tests/shell/golden/`) — "bash-정확성" 약속을 CI가 상시 강제.
- **배포 게이트**: 단일 워크플로에서 `deploy` 잡이 `needs: test` + main 한정 — CI 초록이어야만 배포.

## 구성 요소

1. **`vite.config.ts` base 조건부**: `base: process.env.DEPLOY_BASE ?? '/'` — 로컬 dev/e2e는 `/` 그대로(Playwright baseURL·기존 테스트 무변경), 배포 빌드만 `DEPLOY_BASE=/flashshell/`. Worker 번들 경로는 Vite가 base 처리(빌드 산출물에서 확인).
2. **`.github/workflows/ci.yml`**:
   - `test` 잡(ubuntu-latest): checkout → setup-node(lts) → `npm ci` → `npm run build` → `npm test` → `npx playwright install --with-deps chromium` → `npm run e2e` → `npm run golden` + `git diff --exit-code tests/shell/golden/`.
   - `deploy` 잡: `needs: test`, `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`, permissions `pages: write, id-token: write`, environment `github-pages`: `DEPLOY_BASE=/flashshell/ npm run build` → `actions/configure-pages` → `actions/upload-pages-artifact`(dist) → `actions/deploy-pages`.
3. **`README.md`**: 프로젝트 소개(브라우저 셸 학습 게임, bash-5 정확 엔진), 플레이 URL, 개발 명령(dev/test/e2e/golden — golden은 Docker 필요), 라이선스 없음 명시 생략(기본 저작권).
4. **리포 공개 절차**: `gh repo create mandoo180/flashshell --public --source . --push`(또는 create 후 remote add + push) → Pages 설정 소스=Actions(gh api) → 첫 CI 런 초록 확인 → 공개 URL 실브라우저 스모크(레벨 진입·문제 해결·Worker 데드라인 동작·새로고침 후 진행 유지 — base path 하위에서 localStorage/워커 정상).

## 검증 (완료 조건)

- 첫 CI 런: test 잡 초록(build+1786+11+골든 바이트 동일), deploy 잡 성공.
- `https://mandoo180.github.io/flashshell/` 에서: 타이틀 렌더, LEVEL 1 진입, `cat readme.txt` 해결(Worker 경유), 새로고침 후 진행 유지(`1/10`), 콘솔 에러 0.
- 로컬 회귀: 기존 dev/e2e 무변경 동작(base 조건부).

## 스코프 밖

커스텀 도메인 · PR 프리뷰 · 애널리틱스 · LICENSE 파일 · 브랜치 보호 규칙 · Dependabot.
