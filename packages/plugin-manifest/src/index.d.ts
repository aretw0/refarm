export type TelemetryHook =
	| "onLoad"
	| "onInit"
	| "onRequest"
	| "onError"
	| "onTeardown";
export type PluginExecutionProfile = "strict" | "trusted-fast";

/**
 * The closed permission vocabulary (effect axis) — mirror of the Rust
 * `Permission` enum. The CI guard fails if these drift.
 */
export type Permission =
	| "fs:read"
	| "fs:write"
	| "shell:spawn"
	| "network:outbound";
export type PermissionRisk = "low" | "medium" | "high";
export interface PermissionSpec {
	id: Permission;
	label: string;
	risk: PermissionRisk;
}
export const PERMISSIONS: readonly PermissionSpec[];
export const KNOWN_PERMISSIONS: ReadonlySet<string>;
export function isKnownPermission(id: string): boolean;
export function unknownPermissions(declared: readonly string[]): string[];
export function describePermission(id: string): PermissionSpec | undefined;
export type ExecutionContextType =
	| "main-thread"
	| "worker"
	| "service-worker"
	| "node"
	| "edge";
export type ExtensionSurfaceLayer =
	| "tractor"
	| "homestead"
	| "pi"
	| "automation"
	| "desktop"
	| "asset";

export interface ExecutionContextConfig {
	preferred: ExecutionContextType;
	fallback?: ExecutionContextType;
	allowed: ExecutionContextType[];
}

export interface PluginTrustMetadata {
	profile: PluginExecutionProfile;
	leaseHours?: number;
}

export interface ExtensionSurfaceDeclaration {
	layer: ExtensionSurfaceLayer;
	kind: string;
	id: string;
	slot?: string;
	capabilities?: string[];
	assets?: string[];
}

export interface SkillExtensionSurfaceDeclaration
	extends ExtensionSurfaceDeclaration {
	layer: "pi";
	kind: "skill";
	assets: string[];
	capabilities: string[];
	slot?: never;
}

export interface PluginExtensions {
	surfaces?: ExtensionSurfaceDeclaration[];
}

export interface PluginCapabilities {
	provides: string[];
	requires: string[];
	/** The runtime event names this plugin subscribes to — what the neutral event
	 * router delivers to it. A plugin declaring `vault:dispatch` here receives that
	 * event; `user:prompt` is the agent's subscription. Optional and permissive:
	 * absent means the plugin is loadable but driven only by lifecycle calls. */
	subscribes?: string[];
	providesApi?: string[];
	requiresApi?: string[];
	/** Per-verb usage prose (promptSnippet Slice 2), keyed by the same
	 * `<key>:<verb>` string in `provides`. When present, the agent leg's
	 * system-prompt guidance for that verb is this prose instead of host boilerplate
	 * — so a plugin author teaches the agent how to use its tool. Optional. */
	verbDocs?: Record<string, string>;
	/** The verbs this plugin serves SYNCHRONOUSLY via `respond` (ADR-084's negotiated
	 * sync flag). A per-verb MODE attribute of what the plugin `provides` — each entry
	 * must be a `<key>:<verb>` string also in `provides`. Verbs not listed are
	 * async-default (driven via `on-event`). The host dispatches `respond` only to
	 * these; an async-only plugin asked for sync gets a clean not-supported. Optional. */
	syncVerbs?: string[];
	allowedOrigins?: string[];
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	entry: string;
	capabilities: PluginCapabilities;
	/**
	 * The effect-axis capabilities the plugin declares it needs. A CLOSED
	 * vocabulary mirrored from the Rust source of truth (see permission-vocab).
	 * Unknown strings are typed as `string` to keep manifests parseable, but
	 * validation rejects any value outside `Permission`.
	 */
	permissions: (Permission | string)[];
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
	extensions?: PluginExtensions;
}

export interface ManifestValidationResult {
	valid: boolean;
	errors: string[];
}

export const EXTENSION_SURFACE_LAYERS: ReadonlySet<ExtensionSurfaceLayer>;
export function isExtensionSurfaceLayer(
	layer: unknown,
): layer is ExtensionSurfaceLayer;
export function extensionSurfaceKey(
	surface: ExtensionSurfaceDeclaration,
): string;
export function getExtensionSurfaces(
	manifest: PluginManifest,
	layer?: ExtensionSurfaceLayer,
): ExtensionSurfaceDeclaration[];

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

export type PluginPolicyMode = "warn+continue" | "fail-fast";
export type PluginPolicyStatus =
	| "completed"
	| "blocked-warn-continue"
	| "blocked-fail-fast"
	| "invalid-manifest";

export interface PluginPolicyDecision {
	pluginId: string;
	status: PluginPolicyStatus;
	policyMode: PluginPolicyMode;
	manifestValid: boolean;
	manifestErrors: string[];
	missingCapabilities: string[];
}

export function evaluateCapabilityGrant(
	requires: string[],
	grantedCapabilities: string[],
): string[];
export function decidePluginPolicy(
	manifest: PluginManifest,
	options: { grantedCapabilities: string[]; policyMode: PluginPolicyMode },
): PluginPolicyDecision;

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
