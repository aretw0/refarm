export {
	DEFAULT_WEB_SOURCE_FIXTURE,
	createWebSourceProvider,
	type WebSourceProviderOptions,
} from "./provider.js";
export {
	HttpFetchError,
	createHttpFetchDriver,
	isRecoverableAuthStatus,
	withReauth,
	type Reauthenticate,
	type WithReauthOptions,
} from "./fetch.js";
export {
	crawlSource,
	type CrawlLink,
	type CrawlLinkExtractor,
	type CrawlOptions,
	type CrawlResult,
	type CrawlSeed,
	type CrawledPage,
} from "./crawl.js";
export {
	loadWebSourceTargets,
	loadWebSourceTargetsSync,
	parseWebSourceTargetsConfig,
	webSourceFixturesFromConfig,
	webSourceSnapshotFromTarget,
	type WebSourceTargetConfig,
	type WebSourceTargetsConfig,
} from "./targets.js";
export {
	ensureAuthenticatedSession,
	fixtureLogin,
	isSessionValid,
	type EnsureSessionOptions,
	type EnsureSessionResult,
	type InteractiveLogin,
	type SessionTarget,
} from "./session.js";
export * from "./types.js";
