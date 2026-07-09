import '@testing-library/jest-dom/vitest'

// jsdom does not implement Element.scrollIntoView (it's simply absent, not a
// stub) — https://github.com/jsdom/jsdom/issues/1695. Terminal auto-scrolls
// the scrollback into view on every render, so tests need at least a no-op.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
