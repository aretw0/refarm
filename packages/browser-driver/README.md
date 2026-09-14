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
- The heavy dependency (`puppeteer-core` **or** `playwright-core`) is **optional** and loaded
  **lazily** from the `/puppeteer` or `/playwright` subpath — the main entry never pulls one in,
  and a machine/CI without a browser still builds and runs everything else.
- The cookie→fetch bridge is pure. The login-detection loop (`awaitLoginDetected`) is
  browser-agnostic and lives in the main entry — shared by every adapter.

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
// request contract (any REST / GraphQL / RDF / HTML client).
```

`puppeteer-core` downloads **no browser** — it drives the Chrome you already have. Point at it
with `executablePath` (or `CHROME_PATH`).

### Playwright adapter (`/playwright`)

Already on Playwright? Use the sibling adapter — same `BrowserSession` contract, so every caller
is unchanged:

```ts
import { createLiveFetch } from "@refarm.dev/browser-driver";
import { createPlaywrightSession } from "@refarm.dev/browser-driver/playwright";

const session = await createPlaywrightSession({
  executablePath: process.env.CHROME_PATH,
  userDataDir: "/path/to/session",         // persistent profile (login reused across runs)
  signals: { cookieNamed: "JSESSIONID" },  // your app's "logged in" signal
});
```

It lazily imports `playwright-core` (then `playwright`), so a consumer already on `playwright`
just works and this package ships without forcing the install. Your app's **specific** login
(e.g. a QR / token SSO flow) is expressed as your `LoginSignals` — or, for a bespoke flow, as
your own `BrowserSession.ensureLoggedIn`; everything above the login (fetch-in-session, cookie
reuse, the detection loop) stays generic.

## Login auto-detection (no keypress)

`createPuppeteerSession` waits until login is **detected**, never on Enter. It polls until the
page has left the login flow (URL not matching `login|sso|auth|signin`) **and** any configured
success signal is met:

- `signals.urlIncludes` — a substring the post-login URL contains (default: the base host),
- `signals.readySelector` — a CSS selector only present when authenticated,
- `signals.cookieNamed` — the session cookie's name.

Raise `loginTimeoutMs` (default 3 min) if the SSO/VPN dance is slow.

## Testing

The login/reuse/persistence logic and the detection loop are fully unit-tested with a fake
`BrowserSession` / fake probe (see `src/session.test.ts`) — no real browser required. The
Playwright adapter's translation logic is tested against a fake `chromium`
(`src/playwright.test.ts`), since its `chromium` is injectable. The puppeteer adapter
(`src/puppeteer.ts`) is exercised on a machine with Chrome.
