/**
 * installPlugin — Browser-side plugin installation
 *
 * Fetches a WASM plugin from a remote URL and caches it to OPFS.
 * After installation, the plugin's WASM is available for PluginHost.load()
 * when running in environments with OPFS support.
 */

import {
	type BrowserRuntimeModuleDescriptorMetadata,
	type BrowserRuntimeModuleMetadata,
	type BrowserRuntimeProvenanceMetadata,
	type BrowserRuntimeToolchainMetadata,
	installWasmArtifact,
	type PluginBinaryCacheAdapter,
	type PluginManifest,
	verifyBufferIntegrity,
	type WasmBinaryKind,
} from "@refarm.dev/plugin-manifest";
import {
	cachePlugin,
	cachePluginRuntimeModule,
	evictPlugin,
	getCachedPlugin,
	getPluginCachePath,
	getPluginRuntimeModuleCachePath,
} from "./opfs-plugin-cache";
import {
	buildGithubReleaseAssetUrl,
	fetchRuntimeDescriptorRevocationList,
	isDescriptorHashRevoked,
	normalizeRuntimeDescriptorRevocationList,
	type RuntimeDescriptorRevocationList,
	type RuntimeDescriptorRevocationListReference,
	resolveGithubRepoCoordinates,
} from "./runtime-descriptor-revocation";

const OPFS_CACHE_ADAPTER: PluginBinaryCacheAdapter = {
	get: getCachedPlugin,
	set: cachePlugin,
	evict: evictPlugin,
};

export interface InstallPluginResult {
	pluginId: string;
	wasmUrl: string;
	cached: boolean;
	byteLength: number;
	wasmHash: string;
	artifactKind: WasmBinaryKind;
	cachePath: string;
	runtimeModuleCachePath?: string;
}

export interface BrowserRuntimeModuleInstallInput {
	url: string;
	integrity: string;
}

export interface BrowserRuntimeModuleDescriptor {
	schemaVersion: 1;
	pluginId: string;
	componentWasmUrl: string;
	module: BrowserRuntimeModuleInstallInput & { format?: "esm" };
	toolchain: BrowserRuntimeToolchainMetadata;
	provenance: {
		commitSha: string;
		buildId: string;
		sourceRepository?: string;
	};
	descriptorIntegrity?: string;
}

export interface BrowserRuntimeModuleDescriptorReference {
	url: string;
}

export type BrowserRuntimeDescriptorRevocationList =
	RuntimeDescriptorRevocationList;

export type BrowserRuntimeDescriptorRevocationListReference =
	RuntimeDescriptorRevocationListReference;

export type BrowserRuntimeDescriptorDistributionPolicy =
	| "package-embedded"
	| "external-signed";

export type BrowserRuntimeDescriptorRevocationUnavailablePolicy =
	| "fail-closed"
	| "stale-allowed"
	| "fail-open";

export type BrowserRuntimeDescriptorTrustMode =
	| "strict-manual"
	| "repository-derived";

export interface InstallPluginOptions {
	force?: boolean;
	browserRuntimeModule?: BrowserRuntimeModuleInstallInput;
	browserRuntimeModuleDescriptor?:
		| BrowserRuntimeModuleDescriptor
		| BrowserRuntimeModuleDescriptorReference;
	descriptorSourceRepository?: string;
	descriptorReleaseTag?: string;
	descriptorReleaseAssetName?: string;
	descriptorRevocationList?:
		| BrowserRuntimeDescriptorRevocationList
		| BrowserRuntimeDescriptorRevocationListReference;
	descriptorRevocationAssetName?: string;
	descriptorRevocationCacheTtlMs?: number;
	descriptorRevocationUnavailablePolicy?: BrowserRuntimeDescriptorRevocationUnavailablePolicy;
	descriptorDistributionPolicy?: BrowserRuntimeDescriptorDistributionPolicy;
	descriptorTrustedOrigins?: string[];
	descriptorTrustMode?: BrowserRuntimeDescriptorTrustMode;
}

interface ResolvedBrowserRuntimeModule {
	source: string;
	metadata: BrowserRuntimeModuleMetadata;
	descriptorMetadata: BrowserRuntimeModuleDescriptorMetadata;
	toolchainMetadata?: BrowserRuntimeToolchainMetadata;
	provenanceMetadata?: BrowserRuntimeProvenanceMetadata;
}

function normalizeToolchainMetadata(
	toolchain: BrowserRuntimeToolchainMetadata | undefined,
): BrowserRuntimeToolchainMetadata | undefined {
	if (!toolchain?.name || !toolchain?.version) return undefined;
	return {
		name: toolchain.name,
		version: toolchain.version,
		generatedAt: toolchain.generatedAt,
	};
}

function normalizeProvenanceMetadata(
	provenance:
		| {
				commitSha?: string;
				buildId?: string;
				sourceRepository?: string;
		  }
		| undefined,
	source: "descriptor" | "direct",
): BrowserRuntimeProvenanceMetadata | undefined {
	if (!provenance?.commitSha || !provenance?.buildId) return undefined;

	return {
		source,
		commitSha: provenance.commitSha,
		buildId: provenance.buildId,
		sourceRepository: provenance.sourceRepository,
	};
}

function isFullCommitSha(value: string | undefined): boolean {
	return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value.trim());
}

function safeParseUrl(input: string): URL | null {
	try {
		return new URL(input);
	} catch {
		return null;
	}
}

function normalizeTrustedOrigins(origins: string[] | undefined): Set<string> {
	const normalized = new Set<string>();
	for (const origin of origins ?? []) {
		const parsed = safeParseUrl(origin);
		if (parsed?.origin) normalized.add(parsed.origin);
	}
	return normalized;
}

function buildReleaseAssetDescriptorUrl(
	manifest: PluginManifest,
	options: InstallPluginOptions,
): BrowserRuntimeModuleDescriptorReference | null {
	const sourceRepository = options.descriptorSourceRepository;
	if (!sourceRepository) return null;

	const coordinates = resolveGithubRepoCoordinates(sourceRepository);
	if (!coordinates) {
		throw new Error(
			`[install-plugin] Unable to resolve GitHub repository coordinates from descriptorSourceRepository for ${manifest.id}.`,
		);
	}

	const releaseTag =
		options.descriptorReleaseTag ?? `${manifest.id}@${manifest.version}`;
	const descriptorAssetName =
		options.descriptorReleaseAssetName ?? "runtime-descriptor-manifest.json";

	const releaseAssetUrl = buildGithubReleaseAssetUrl(
		sourceRepository,
		releaseTag,
		descriptorAssetName,
	);

	return { url: releaseAssetUrl };
}

function isRevocationListReference(
	input:
		| BrowserRuntimeDescriptorRevocationList
		| BrowserRuntimeDescriptorRevocationListReference,
): input is BrowserRuntimeDescriptorRevocationListReference {
	return (
		typeof (input as BrowserRuntimeDescriptorRevocationListReference).url ===
		"string"
	);
}

function resolveAutoRevocationListReference(
	manifest: PluginManifest,
	descriptor: BrowserRuntimeModuleDescriptor,
	options: InstallPluginOptions,
): BrowserRuntimeDescriptorRevocationListReference | null {
	const sourceRepository =
		options.descriptorSourceRepository ??
		descriptor.provenance?.sourceRepository;
	if (!sourceRepository) return null;

	const releaseTag =
		options.descriptorReleaseTag ?? `${manifest.id}@${manifest.version}`;
	const revocationAssetName =
		options.descriptorRevocationAssetName ??
		"runtime-descriptor-revocations.json";

	try {
		return {
			url: buildGithubReleaseAssetUrl(
				sourceRepository,
				releaseTag,
				revocationAssetName,
			),
		};
	} catch (error: any) {
		if (options.descriptorSourceRepository) {
			throw new Error(
				`[install-plugin] Unable to resolve descriptor revocation list URL for ${manifest.id}: ${error?.message ?? error}`,
			);
		}
		return null;
	}
}

async function assertDescriptorNotRevoked(
	manifest: PluginManifest,
	descriptorHash: string,
	descriptor: BrowserRuntimeModuleDescriptor,
	options: InstallPluginOptions,
): Promise<void> {
	const unavailablePolicy =
		options.descriptorRevocationUnavailablePolicy ?? "fail-closed";
	const revocationInput =
		options.descriptorRevocationList ??
		resolveAutoRevocationListReference(manifest, descriptor, options);

	if (!revocationInput) return;

	const revocationList = isRevocationListReference(revocationInput)
		? await (async () => {
				try {
					return await fetchRuntimeDescriptorRevocationList(revocationInput, {
						cacheTtlMs: options.descriptorRevocationCacheTtlMs,
						fetchFn: globalThis.fetch.bind(globalThis),
						allowStaleOnError: unavailablePolicy === "stale-allowed",
					});
				} catch (error: any) {
					if (unavailablePolicy === "fail-open") {
						console.warn(
							`[install-plugin] Revocation list unavailable for ${manifest.id}; continuing due fail-open policy: ${error?.message ?? error}`,
						);
						return null;
					}
					throw error;
				}
		  })()
		: normalizeRuntimeDescriptorRevocationList(revocationInput, "inline");

	if (!revocationList) return;

	if (isDescriptorHashRevoked(descriptorHash, revocationList)) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor ${descriptorHash} for ${manifest.id} is revoked by release revocation list.`,
		);
	}
}

function deriveTrustedOriginsFromSourceRepository(
	sourceRepository: string | undefined,
): Set<string> {
	const trustedOrigins = new Set<string>();
	if (!sourceRepository) return trustedOrigins;

	const repositoryUrl = safeParseUrl(sourceRepository);
	if (!repositoryUrl?.origin) return trustedOrigins;

	trustedOrigins.add(repositoryUrl.origin);

	if (repositoryUrl.hostname === "github.com") {
		trustedOrigins.add("https://objects.githubusercontent.com");
		trustedOrigins.add("https://github-releases.githubusercontent.com");
		trustedOrigins.add("https://raw.githubusercontent.com");
	}

	return trustedOrigins;
}

function assertDescriptorReferencePolicy(
	manifest: PluginManifest,
	wasmUrl: string,
	descriptorUrlRaw: string,
	policy: BrowserRuntimeDescriptorDistributionPolicy,
	trustedOrigins: Set<string>,
	trustMode: BrowserRuntimeDescriptorTrustMode,
): URL {
	const descriptorUrl = safeParseUrl(descriptorUrlRaw);
	if (!descriptorUrl) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor URL is invalid for ${manifest.id}.`,
		);
	}

	if (descriptorUrl.protocol !== "https:") {
		throw new Error(
			`[install-plugin] Browser runtime descriptor URL must use https for ${manifest.id}.`,
		);
	}

	const isBundleManifestPath =
		/runtime-descriptor-manifest(?:-[^/]+)?\.json$/i.test(
			descriptorUrl.pathname,
		);
	const isDescriptorPath = descriptorUrl.pathname.endsWith(
		".runtime-descriptor.json",
	);

	if (!isDescriptorPath && !isBundleManifestPath) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor URL must point to descriptor (*.runtime-descriptor.json) or bundle manifest (runtime-descriptor-manifest*.json) for ${manifest.id}.`,
		);
	}

	const wasmParsedUrl = safeParseUrl(wasmUrl);
	const wasmOrigin = wasmParsedUrl?.origin;

	if (policy === "package-embedded") {
		if (!wasmOrigin || descriptorUrl.origin !== wasmOrigin) {
			throw new Error(
				`[install-plugin] Descriptor distribution policy package-embedded requires descriptor URL origin to match component origin for ${manifest.id}.`,
			);
		}
		return descriptorUrl;
	}

	if (trustMode === "repository-derived") {
		return descriptorUrl;
	}

	if (
		wasmOrigin &&
		descriptorUrl.origin !== wasmOrigin &&
		!trustedOrigins.has(descriptorUrl.origin)
	) {
		throw new Error(
			`[install-plugin] Descriptor distribution policy external-signed requires descriptor origin allowlist for ${manifest.id}.`,
		);
	}

	return descriptorUrl;
}

function isBundleManifestUrl(descriptorUrl: URL): boolean {
	return /runtime-descriptor-manifest(?:-[^/]+)?\.json$/i.test(
		descriptorUrl.pathname,
	);
}

function extractDescriptorFromBundleManifest(
	bundlePayload: unknown,
	manifest: PluginManifest,
	wasmUrl: string,
	sourceUrl: string,
): BrowserRuntimeModuleDescriptor {
	const bundle = bundlePayload as {
		schemaVersion?: number;
		descriptors?: Array<{
			pluginId?: string;
			componentWasmUrl?: string;
			descriptor?: BrowserRuntimeModuleDescriptor;
		}>;
	};

	if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle?.descriptors)) {
		throw new Error(
			`[install-plugin] Runtime descriptor bundle manifest is invalid for ${manifest.id}: ${sourceUrl}`,
		);
	}

	const entry = bundle.descriptors.find(
		(item) =>
			item?.pluginId === manifest.id && item?.componentWasmUrl === wasmUrl,
	);

	if (!entry?.descriptor || typeof entry.descriptor !== "object") {
		throw new Error(
			`[install-plugin] Runtime descriptor bundle manifest missing descriptor entry for ${manifest.id} (${wasmUrl}).`,
		);
	}

	return entry.descriptor;
}

function isDescriptorReference(
	input:
		| BrowserRuntimeModuleDescriptor
		| BrowserRuntimeModuleDescriptorReference,
): input is BrowserRuntimeModuleDescriptorReference {
	return (
		typeof (input as BrowserRuntimeModuleDescriptorReference).url === "string"
	);
}

function stableCanonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => stableCanonicalize(item));
	}

	if (value && typeof value === "object") {
		const sortedEntries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, itemValue]) => [key, stableCanonicalize(itemValue)]);
		return Object.fromEntries(sortedEntries);
	}

	return value;
}

async function computeSha256IntegrityFromText(source: string): Promise<string> {
	const bytes = new TextEncoder().encode(source).buffer;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const digestBytes = new Uint8Array(digest);
	let binary = "";
	for (const byte of digestBytes) binary += String.fromCharCode(byte);
	return `sha256-${btoa(binary)}`;
}

function assertDescriptorShape(
	descriptor: BrowserRuntimeModuleDescriptor,
	manifest: PluginManifest,
	wasmUrl: string,
): void {
	if (descriptor.schemaVersion !== 1) {
		throw new Error(
			`[install-plugin] Unsupported browser runtime descriptor schemaVersion=${descriptor.schemaVersion}.`,
		);
	}

	if (descriptor.pluginId !== manifest.id) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor pluginId mismatch for ${manifest.id}.`,
		);
	}

	if (descriptor.componentWasmUrl !== wasmUrl) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor componentWasmUrl mismatch for ${manifest.id}.`,
		);
	}

	if (!descriptor.module?.url || !descriptor.module?.integrity) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor for ${manifest.id} requires module url + integrity.`,
		);
	}

	if (descriptor.module.format && descriptor.module.format !== "esm") {
		throw new Error(
			`[install-plugin] Browser runtime descriptor module format must be 'esm' for ${manifest.id}.`,
		);
	}

	if (!descriptor.toolchain?.name || !descriptor.toolchain?.version) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor for ${manifest.id} requires toolchain name/version provenance.`,
		);
	}

	if (
		!descriptor.provenance?.buildId ||
		!isFullCommitSha(descriptor.provenance?.commitSha)
	) {
		throw new Error(
			`[install-plugin] Browser runtime descriptor for ${manifest.id} requires provenance buildId + full commitSha.`,
		);
	}
}

function assertDescriptorObjectPolicy(
	manifest: PluginManifest,
	descriptor: BrowserRuntimeModuleDescriptor,
	policy: BrowserRuntimeDescriptorDistributionPolicy,
): void {
	if (policy !== "external-signed") return;

	if (!descriptor.descriptorIntegrity) {
		throw new Error(
			`[install-plugin] Descriptor distribution policy external-signed requires descriptorIntegrity for ${manifest.id}.`,
		);
	}

	if (!descriptor.provenance?.sourceRepository) {
		throw new Error(
			`[install-plugin] Descriptor distribution policy external-signed requires provenance.sourceRepository for ${manifest.id}.`,
		);
	}
}

async function resolveDescriptorInput(
	manifest: PluginManifest,
	wasmUrl: string,
	input:
		| BrowserRuntimeModuleDescriptor
		| BrowserRuntimeModuleDescriptorReference,
	policy: BrowserRuntimeDescriptorDistributionPolicy,
	trustedOrigins: Set<string>,
	trustMode: BrowserRuntimeDescriptorTrustMode,
): Promise<BrowserRuntimeModuleDescriptor> {
	const verifyDescriptorIntegrity = async (
		descriptor: BrowserRuntimeModuleDescriptor,
	): Promise<void> => {
		if (!descriptor.descriptorIntegrity) return;

		const descriptorWithoutIntegrity = {
			...descriptor,
			descriptorIntegrity: undefined,
		};
		const computed = await computeSha256IntegrityFromText(
			JSON.stringify(stableCanonicalize(descriptorWithoutIntegrity)),
		);

		if (computed !== descriptor.descriptorIntegrity) {
			throw new Error(
				`[install-plugin] Browser runtime descriptor integrity mismatch for ${manifest.id}.`,
			);
		}
	};

	if (isDescriptorReference(input)) {
		const descriptorUrl = assertDescriptorReferencePolicy(
			manifest,
			wasmUrl,
			input.url,
			policy,
			trustedOrigins,
			trustMode,
		);

		const response = await fetch(descriptorUrl.toString());
		if (!response.ok) {
			throw new Error(
				`[install-plugin] Failed to fetch browser runtime descriptor ${descriptorUrl.toString()}: ${response.statusText}`,
			);
		}

		const payload = await response.json();
		const descriptor = isBundleManifestUrl(descriptorUrl)
			? extractDescriptorFromBundleManifest(
					payload,
					manifest,
					wasmUrl,
					descriptorUrl.toString(),
				)
			: (payload as BrowserRuntimeModuleDescriptor);
		assertDescriptorShape(descriptor, manifest, wasmUrl);
		assertDescriptorObjectPolicy(manifest, descriptor, policy);

		if (policy === "external-signed") {
			const wasmParsedUrl = safeParseUrl(wasmUrl);
			const wasmOrigin = wasmParsedUrl?.origin;

			const effectiveTrustedOrigins = new Set(trustedOrigins);
			if (trustMode === "repository-derived") {
				for (const origin of deriveTrustedOriginsFromSourceRepository(
					descriptor.provenance?.sourceRepository,
				)) {
					effectiveTrustedOrigins.add(origin);
				}
			}

			if (
				wasmOrigin &&
				descriptorUrl.origin !== wasmOrigin &&
				!effectiveTrustedOrigins.has(descriptorUrl.origin)
			) {
				throw new Error(
					`[install-plugin] Descriptor origin ${descriptorUrl.origin} is not trusted for policy external-signed in ${manifest.id}.`,
				);
			}
		}

		await verifyDescriptorIntegrity(descriptor);
		return descriptor;
	}

	assertDescriptorShape(input, manifest, wasmUrl);
	assertDescriptorObjectPolicy(manifest, input, policy);
	await verifyDescriptorIntegrity(input);
	return input;
}

async function fetchBrowserRuntimeModule(
	browserRuntimeModule: BrowserRuntimeModuleInstallInput,
	descriptorMetadata: BrowserRuntimeModuleDescriptorMetadata,
	toolchainMetadata?: BrowserRuntimeToolchainMetadata,
	provenanceMetadata?: BrowserRuntimeProvenanceMetadata,
): Promise<ResolvedBrowserRuntimeModule> {
	const response = await fetch(browserRuntimeModule.url);
	if (!response.ok) {
		throw new Error(
			`[install-plugin] Failed to fetch browser runtime module ${browserRuntimeModule.url}: ${response.statusText}`,
		);
	}

	const source = await response.text();
	const bytes = new TextEncoder().encode(source).buffer;
	await verifyBufferIntegrity(bytes, browserRuntimeModule.integrity);

	return {
		source,
		metadata: {
			url: browserRuntimeModule.url,
			integrity: browserRuntimeModule.integrity,
			format: "esm",
		},
		descriptorMetadata,
		toolchainMetadata,
		provenanceMetadata,
	};
}

/**
 * Install a plugin by fetching its WASM and caching it to OPFS.
 *
 * If the plugin is already cached, returns the cached version without re-fetching.
 * Pass force: true to bypass the cache and re-fetch.
 */
export async function installPlugin(
	manifest: PluginManifest,
	wasmUrl: string,
	options: InstallPluginOptions = {},
): Promise<InstallPluginResult> {
	if (
		options.browserRuntimeModule &&
		(options.browserRuntimeModuleDescriptor ||
			options.descriptorSourceRepository)
	) {
		throw new Error(
			`[install-plugin] Provide either browserRuntimeModule or descriptor-based inputs (not both) for ${manifest.id}.`,
		);
	}

	const descriptorDistributionPolicy =
		options.descriptorDistributionPolicy ?? "package-embedded";
	const descriptorTrustedOrigins = normalizeTrustedOrigins(
		options.descriptorTrustedOrigins,
	);
	const descriptorTrustMode =
		options.descriptorTrustMode ?? "repository-derived";

	const descriptorInput =
		options.browserRuntimeModuleDescriptor ??
		(descriptorDistributionPolicy === "external-signed"
			? buildReleaseAssetDescriptorUrl(manifest, options)
			: undefined);

	let runtimeModule: ResolvedBrowserRuntimeModule | null = null;

	if (descriptorInput) {
		const descriptor = await resolveDescriptorInput(
			manifest,
			wasmUrl,
			descriptorInput,
			descriptorDistributionPolicy,
			descriptorTrustedOrigins,
			descriptorTrustMode,
		);

		const descriptorWithoutIntegrity = {
			...descriptor,
			descriptorIntegrity: undefined,
		};
		const descriptorHash =
			descriptor.descriptorIntegrity ??
			(await computeSha256IntegrityFromText(
				JSON.stringify(stableCanonicalize(descriptorWithoutIntegrity)),
			));

		if (descriptorDistributionPolicy === "external-signed") {
			await assertDescriptorNotRevoked(
				manifest,
				descriptorHash,
				descriptor,
				options,
			);
		}

		runtimeModule = await fetchBrowserRuntimeModule(
			descriptor.module,
			{
				schemaVersion: 1,
				descriptorHash,
				componentWasmUrl: descriptor.componentWasmUrl,
				source: "descriptor",
			},
			normalizeToolchainMetadata(descriptor.toolchain),
			normalizeProvenanceMetadata(descriptor.provenance, "descriptor"),
		);
	} else if (options.browserRuntimeModule) {
		runtimeModule = await fetchBrowserRuntimeModule(
			options.browserRuntimeModule,
			{
				schemaVersion: 1,
				descriptorHash: await computeSha256IntegrityFromText(
					JSON.stringify(
						stableCanonicalize({
							pluginId: manifest.id,
							componentWasmUrl: wasmUrl,
							module: {
								url: options.browserRuntimeModule.url,
								integrity: options.browserRuntimeModule.integrity,
								format: "esm",
							},
							schemaVersion: 1,
						}),
					),
				),
				componentWasmUrl: wasmUrl,
				source: "direct",
			},
			{
				name: "manual-sidecar",
				version: "0.1",
			},
			{
				source: "direct",
				commitSha: "manual-direct",
				buildId: "manual-direct",
			},
		);
	}

	const result = await installWasmArtifact(
		{
			pluginId: manifest.id,
			wasmUrl,
			integrity: manifest.integrity ?? "",
			force: options.force,
			metadataExtensions: runtimeModule
				? {
						browserRuntimeModule: runtimeModule.metadata,
						browserRuntimeDescriptor: runtimeModule.descriptorMetadata,
						browserRuntimeToolchain: runtimeModule.toolchainMetadata,
						browserRuntimeProvenance: runtimeModule.provenanceMetadata,
					}
				: undefined,
		},
		{
			cache: OPFS_CACHE_ADAPTER,
			fetchFn: globalThis.fetch.bind(globalThis),
		},
	);

	if (runtimeModule) {
		await cachePluginRuntimeModule(manifest.id, runtimeModule.source);
	}

	return {
		...result,
		cachePath: getPluginCachePath(manifest.id),
		runtimeModuleCachePath: runtimeModule
			? getPluginRuntimeModuleCachePath(manifest.id)
			: undefined,
	};
}
