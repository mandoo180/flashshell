# FlashShell

명령줄로만 풀 수 있는 문제들 — 브라우저에서 도는 셸 학습 게임.

**▶ 플레이: <https://mandoo180.github.io/flashshell/>**

리눅스 셸을 플래시카드 게임처럼 익힙니다. 레벨 1(탐색)부터 레벨 6(자동화 — 배열·read·스크립트)까지 60문제를, 진짜 명령을 타이핑해서 풉니다. 문제는 명령 문자열이 아니라 **파일시스템의 최종 상태**로 채점됩니다.

## 특징

- **bash-정확 엔진** — 손으로 만든 bash 서브셋 인터프리터(렉서→파서→확장기→인터프리터)가 가상 파일시스템 위에서 동작합니다. 모든 동작은 `debian:stable-slim`의 bash 5와 차등 검증되며, 골든 픽스처는 진짜 bash에서 재생성해 바이트 단위로 비교합니다(CI 상시 강제).
- **완전 클라이언트 사이드** — 서버 없음. 셸은 Web Worker에서 실행되고 2초 데드라인으로 폭주(무한 루프, ReDoS)를 격리합니다.
- **지원 문법** — 파이프·리다이렉션·글롭, `if`/`for`/`while`/`case`·함수, `$(( ))` 산술·`${...}` 파라미터 확장, 배열·`read`·`while read`·here-doc, 30+ 코어유틸.

## 개발

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # 단위 테스트 (엔진·게임·UI)
npm run e2e        # Playwright (크로미움 필요: npx playwright install chromium)
npm run golden     # 골든 픽스처 재생성 — Docker 필요 (bash 5 차등 검증)
npm run build      # 정적 빌드 (dist/)
```

스택: Vite · React · TypeScript · Zustand · Vitest · Playwright.
