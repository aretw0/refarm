export {
	DEFAULT_WEB_SOURCE_FIXTURE,
	createWebSourceProvider,
	type WebSourceProviderOptions,
} from "./provider.js";
export {
	loadWebSourceTargets,
	loadWebSourceTargetsSync,
	parseWebSourceTargetsConfig,
	webSourceFixturesFromConfig,
	webSourceSnapshotFromTarget,
	type WebSourceTargetConfig,
	type WebSourceTargetsConfig,
} from "./targets.js";
export * from "./types.js";
