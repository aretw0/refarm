export interface TurboCacheServiceManifest {
	readonly id: "turbo-cache";
	readonly displayName: string;
	readonly description: string;
	readonly ciSecrets: readonly ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"];
}

export const turboCacheManifest: TurboCacheServiceManifest = {
	id: "turbo-cache",
	displayName: "Turborepo Remote Cache",
	description: "Provider-neutral Turborepo Remote Cache service block",
	ciSecrets: ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"],
};
