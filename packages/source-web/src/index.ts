export {
	DEFAULT_WEB_SOURCE_FIXTURE,
	createWebSourceProvider,
	type WebSourceProviderOptions,
} from "./provider.js";
export {
	ConnectivityError,
	HttpFetchError,
	createHttpFetchDriver,
	isConnectivityError,
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
	DEFAULT_MAX_ATTACHMENT_BYTES,
	downloadAttachment,
	extensionFromMimeOrTitle,
	resolveAttachmentPolicy,
	type AttachmentPolicyDecision,
	type AttachmentResult,
	type AttachmentSkipReason,
	type BinaryFetchDriver,
	type BinaryFetchResult,
	type DownloadAttachmentOptions,
} from "./attachment.js";
export {
	conditionalValidators,
	decideSync,
	emptyCacheManifest,
	normalizeCacheManifest,
	recordSync,
	syncManifest,
	type CacheEntry,
	type CacheManifest,
	type ObservedResource,
	type SyncDecision,
	type SyncReport,
	type SyncStatus,
} from "./cache.js";
export {
	decodeHtmlEntities,
	htmlToMarkdown,
	minimalHtmlToMarkdown,
	stripNonContentHtml,
	type HtmlToMarkdownConverter,
	type HtmlToMarkdownOptions,
} from "./html-markdown.js";
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
