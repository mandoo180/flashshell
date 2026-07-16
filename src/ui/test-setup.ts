import '@testing-library/jest-dom/vitest'

// jsdom does not implement Element.scrollIntoView (it's simply absent, not a
// stub) — https://github.com/jsdom/jsdom/issues/1695. Terminal auto-scrolls
// the scrollback into view on every render, so tests need at least a no-op.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom 의 navigator.language 기본값은 'en-US'다. 기존 컴포넌트 테스트는 전부
// 한국어 문자열을 쿼리하므로, 테스트 브라우저를 한국어 로케일로 고정한다 —
// localStorage.clear() + vi.resetModules() 로 스토어를 다시 만드는 테스트
// (Play.test.tsx 레벨 해제 테스트)에서도 감지 결과가 ko 로 안정된다.
// EN 경로는 detectLang 단위 테스트와 LangToggle/e2e 가 명시적으로 검증한다.
Object.defineProperty(window.navigator, 'language', { value: 'ko-KR', configurable: true })
