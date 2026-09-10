export {
	awaitLoginDetected,
	cookieFetch,
	cookieHeader,
	createCookieFetchDriver,
	createFetchDriver,
	sessionFetch,
	createLiveFetch,
	loadCookieState,
	saveCookieState,
	type AwaitLoginOptions,
	type BrowserSession,
	type LiveFetch,
	type LiveFetchOptions,
	type LoginProbe,
	type LoginSignals,
	type SessionCookie,
} from "./session.js";
// The browser adapters are SEPARATE entries (@refarm.dev/browser-driver/puppeteer,
// /playwright) so the main barrel never pulls in a browser automation lib — only a consumer
// that imports the subpath does. The login-detection primitives above are browser-agnostic and
// live here, shared by every adapter.
