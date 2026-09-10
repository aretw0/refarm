export {
	createOslcCrawlExtractor,
	createOslcFetchDriver,
	extractOslcAttachmentRef,
	extractOslcRelationLinks,
	firstRdfMatch,
	isOslcArtifactUrl,
	isOslcCollectionUrl,
	oslcPrimaryTextToMarkdown,
	oslcRequestHeaders,
	oslcResourceRefs,
	OSLC_RELATION_PREDICATES,
	splitOslcResourceBlocks,
	type OslcAttachmentRef,
	type OslcCrawlOptions,
	type OslcRelationLink,
} from "./oslc.js";
export {
	createOslcSourceProvider,
	type OslcSourceProviderOptions,
	type OslcSourceTarget,
} from "./provider.js";
