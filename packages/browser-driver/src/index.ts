export {
	cookieFetch,
	cookieHeader,
	createCookieFetchDriver,
	createFetchDriver,
	sessionFetch,
	createLiveFetch,
	loadCookieState,
	saveCookieState,
	type BrowserSession,
	type LiveFetch,
	type LiveFetchOptions,
	type SessionCookie,
} from "./session.js";
// The puppeteer adapter is a SEPARATE entry (@refarm.dev/browser-driver/puppeteer) so the
// main barrel never pulls in puppeteer-core — only a consumer that imports the subpath does.
