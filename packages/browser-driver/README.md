# @refarm.dev/browser-driver

A light, injectable **browser-login driver** for web sources. Sign in once through a real
browser (SSO / VPN happen in the window, **no "press Enter"** — login is auto-detected), reuse
that session's cookies for authenticated fetches, and persist the session so the next run
skips the login.

This is a framework block: any consumer — an example, an app, or an **agent operator** — can
use it to get an authenticated handle to a system behind a login, without wiring a browser
themselves.

## Why a seam, not a hardcoded browser

- The browser lives behind the `BrowserSession` interface, so the login/reuse logic is
  **testable with a fake** (no real Chrome needed) and a consumer can bring **any** browser
  (puppeteer, Playwright, CDP) without changing callers.
- The heavy dependency (`puppeteer-core`) is **optional** and loaded **lazily** from the
  `/puppeteer` subpath — the main entry never pulls it in, and a machine/CI without Chrome
  still builds and runs everything else.
- The cookie→fetch bridge is pure.

## Usage

```ts
import { createLiveFetch } from "@refarm.dev/browser-driver";
import { createPuppeteerSession } from "@refarm.dev/browser-driver/puppeteer";

// The operator's own Chrome, a persistent profile, login auto-detected.
const session = await createPuppeteerSession({
  executablePath: process.env.CHROME_PATH, // your Chrome
  userDataDir: "/path/to/session",         // persistent profile (cookies survive here)
  // headless defaults to false so the human can complete SSO/VPN in the window.
  signals: { cookieNamed: "JSESSIONID" },  // optional: tune the "logged in" signal
});

const live = await createLiveFetch({
  session,
  baseUrl: "https://your-system.example",
  statePath: "/path/to/session/auth-state.json", // reuse cookies next run
});

// `live.fetchImpl` is an authenticated fetch; `live.driver` is a WebFetchDriver.
// Hand `live.fetchImpl` to a source provider, or wrap `live.driver` with a domain
// request contract (e.g. an OSLC/RDF client).
```

`puppeteer-core` downloads **no browser** — it drives the Chrome you already have. Point at it
with `executablePath` (or `CHROME_PATH`).

## Login auto-detection (no keypress)

`createPuppeteerSession` waits until login is **detected**, never on Enter. It polls until the
page has left the login flow (URL not matching `login|sso|auth|signin`) **and** any configured
success signal is met:

- `signals.urlIncludes` — a substring the post-login URL contains (default: the base host),
- `signals.readySelector` — a CSS selector only present when authenticated,
- `signals.cookieNamed` — the session cookie's name.

Raise `loginTimeoutMs` (default 3 min) if the SSO/VPN dance is slow.

## Testing

The login/reuse/persistence logic is fully unit-tested with a fake `BrowserSession` (see
`src/session.test.ts`) — no real browser required. The puppeteer adapter (`src/puppeteer.ts`)
is the only browser-touching code; it is exercised on a machine with Chrome.
