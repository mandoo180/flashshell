# FlashShell

[한국어](README.ko.md)

Problems only the command line can solve — a shell-learning game that runs in your browser.

**▶ Play: <https://flashshell.anonpengling.org/>**

Learn the Linux shell like a flashcard game. 60 problems from Level 1 (exploration) to Level 6 (automation — arrays, read, scripts), solved by typing real commands. Problems are graded on the **final state of the filesystem**, not on the command string you typed.

## Features

- **bash-accurate engine** — a hand-rolled bash-subset interpreter (lexer → parser → expander → interpreter) running on a virtual filesystem. Every behavior is differentially verified against bash 5 on `debian:stable-slim`; golden fixtures are regenerated with real bash and compared byte-for-byte (enforced in CI on every push).
- **Fully client-side** — no server. The shell runs in a Web Worker with a 2-second deadline that isolates runaways (infinite loops, ReDoS).
- **Supported syntax** — pipes · redirection · globs, `if`/`for`/`while`/`case` · functions, `$(( ))` arithmetic · `${...}` parameter expansion, arrays · `read` · `while read` · here-docs, 30+ coreutils.
- **English / Korean** — auto-detected from your browser, switchable in-game with the `[EN|KO]` toggle.

## Development

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (engine · game · UI)
npm run e2e        # Playwright (needs Chromium: npx playwright install chromium)
npm run golden     # regenerate golden fixtures — requires Docker (bash 5 differential)
npm run build      # static build (dist/)
```

Stack: Vite · React · TypeScript · Zustand · Vitest · Playwright.

---

An app by [Pengling](https://anonpengling.org) — an indie studio building daily learning games.
