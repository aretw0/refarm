export type TelemetryHook =
	| "onLoad"
	| "onInit"
	| "onRequest"
	| "onError"
	| "onTeardown";
export type PluginExecutionProfile = "strict" | "trusted-fast";
export type ExecutionContextType =
	| "main-thread"
	| "worker"
	| "service-worker"
	| "node"
	| "edge";

export interface ExecutionContextConfig {
	preferred: ExecutionContextType;
	fallback?: ExecutionContextType;
	allowed: ExecutionContextType[];
}

export interface PluginTrustMetadata {
	profile: PluginExecutionProfile;
	leaseHours?: number;
}

export interface PluginCapabilities {
	provides: string[];
	requires: string[];
	providesApi?: string[];
	requiresApi?: string[];
	allowedOrigins?: string[];
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	entry: string;
	capabilities: PluginCapabilities;
	permissions: string[];
	observability: {
		hooks: TelemetryHook[];
	};
	targets: ("browser" | "server" | "remote")[];
	ui?: {
		icon?: string;
		slots?: string[];
		color?: string;
	};
	certification: {
		license: string;
		a11yLevel: number;
		languages: string[];
	};
	i18n?: Record<string, any> | string;
	executionContext?: ExecutionContextConfig;
	trust?: PluginTrustMetadata;
	integrity?: string;
}

export interface ManifestValidationResult {
	valid: boolean;
	errors: string[];
}

export type EntryFormat = "js" | "mjs" | "cjs" | "wasm" | "unknown";
export type RuntimeSupportTarget = "node" | "browser";
export interface RuntimeCompatibilityOptions {
	allowBrowserWasmFromCache?: boolean;
}

export const REQUIRED_TELEMETRY_HOOKS: readonly TelemetryHook[];
export const SUPPORTED_ENTRY_FORMATS: readonly ["js", "mjs", "cjs", "wasm"];
export const RUNTIME_ENTRY_SUPPORT: Readonly<{
	node: readonly ["js", "mjs", "cjs", "wasm"];
	browser: readonly ["js", "mjs"];
}>;

export function detectEntryFormat(entry: string): EntryFormat;
export function evaluateEntryRuntimeCompatibility(
	entry: string,
	runtime: RuntimeSupportTarget,
	options?: RuntimeCompatibilityOptions,
): { runtime: RuntimeSupportTarget; format: EntryFormat; supported: boolean };
export function assertEntryRuntimeCompatibility(
	entry: string,
	runtime: RuntimeSupportTarget,
	options?: RuntimeCompatibilityOptions,
): void;

export function createMockManifest(
	overrides?: Partial<PluginManifest>,
): PluginManifest;
export function validatePluginManifest(manifest: any): ManifestValidationResult;
export function assertValidPluginManifest(manifest: any): void;

export interface ParsedIntegrity {
	algorithm: "sha256";
	encoding: "hex" | "base64";
	value: string;
}

export interface Sha256Digest {
	base64: string;
	hex: string;
}

export interface BrowserRuntimeModuleMetadata {
	url: string;
	integrity: string;
	format: "esm";
}

export interface BrowserRuntimeModuleDescriptorMetadata {
	schemaVersion: 1;
	descriptorHash: string;
	componentWasmUrl: string;
	source: "descriptor" | "direct";
}

export interface BrowserRuntimeToolchainMetadata {
	name: string;
	version: string;
	generatedAt?: string;
}

export interface BrowserRuntimeProvenanceMetadata {
	source: "descriptor" | "direct";
	commitSha: string;
	buildId: string;
	sourceRepository?: string;
}

export interface PluginArtifactMetadata {
	pluginId: string;
	wasmUrl: string;
	integrity: string;
	wasmHash: string;
	cachedAt: number;
	artifactKind: WasmBinaryKind;
	browserRuntimeModule?: BrowserRuntimeModuleMetadata;
	browserRuntimeDescriptor?: BrowserRuntimeModuleDescriptorMetadata;
	browserRuntimeToolchain?: BrowserRuntimeToolchainMetadata;
	browserRuntimeProvenance?: BrowserRuntimeProvenanceMetadata;
}

export interface PluginBinaryCacheAdapter {
	get(pluginId: string): Promise<ArrayBuffer | null>;
	set(
		pluginId: string,
		bytes: ArrayBuffer,
		metadata?: PluginArtifactMetadata,
	): Promise<void>;
	evict(pluginId: string): Promise<void>;
}

export interface InstallWasmArtifactRequest {
	pluginId: string;
	wasmUrl: string;
	integrity: string;
	force?: boolean;
	metadataExtensions?: Record<string, unknown>;
}

export interface InstallWasmArtifactResult {
	pluginId: string;
	wasmUrl: string;
	cached: boolean;
	byteLength: number;
	wasmHash: string;
	artifactKind: WasmBinaryKind;
}

export type WasmBinaryKind = "module" | "component" | "unknown";
export const WASM_BINARY_KINDS: readonly ["module", "component", "unknown"];
export function detectWasmBinaryKind(bytes: ArrayBuffer): WasmBinaryKind;

export const SHA256_HEX_VALUE_RE: RegExp;
export const SHA256_BASE64_VALUE_RE: RegExp;

export function parseSha256Integrity(integrity: string): ParsedIntegrity;
export function computeSha256Digest(bytes: ArrayBuffer): Promise<Sha256Digest>;
export function isSha256DigestMatch(
	expected: ParsedIntegrity,
	actual: Sha256Digest,
): boolean;
export function verifyBufferIntegrity(
	bytes: ArrayBuffer,
	integrity: string,
): Promise<Sha256Digest>;

export function installWasmArtifact(
	request: InstallWasmArtifactRequest,
	deps: { cache: PluginBinaryCacheAdapter; fetchFn?: typeof fetch },
): Promise<InstallWasmArtifactResult>;
