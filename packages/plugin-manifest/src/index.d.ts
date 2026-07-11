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

/** One verb's entry in the `verbs` authoring block: WHERE it goes (list flags) plus its
 * per-verb metadata (doc/schema), all keyed by the SHORT verb name (no `<key>:` prefix —
 * the block's key qualifies it). `provides` defaults true (a listed verb is offered);
 * set `provides: false` for a verb the plugin only subscribes to. */
export interface PluginVerbEntry {
	/** Put `<key>:<verb>` in `provides`. Defaults true — a listed verb is provided. */
	provides?: boolean;
	/** Put `<key>:<verb>` in `subscribes` too (the plugin listens on this verb's event). */
	subscribes?: boolean;
	/** Per-verb usage prose → lowered to `verbDocs["<key>:<verb>"]`. */
	doc?: string;
	/** Per-verb argument JSON-Schema → lowered to `verbSchemas["<key>:<verb>"]`. */
	schema?: Record<string, unknown>;
}

/** The ergonomic authoring block for a plugin's dispatchable verbs — the high-level form
 * that names each thing ONCE, then lowers (via normalizeCapabilities) to the raw
 * `provides`/`subscribes`/`verbDocs`/`verbSchemas` every host consumer reads. It exists to
 * kill the repetition of declaring `<key>:dispatch` in two lists, re-referencing a verb in
 * three fields, and repeating the `<key>:` prefix on every entry.
 *
 * `key` is optional: absent, it is inferred from the manifest `id` (last path segment,
 * `@scope/vault → vault`), so the common plugin declares nothing; an explicit `key`
 * overrides when the key diverges from the id segment (`@devbench/coding-agent → agent`).
 *
 * DISPATCH IS IMPLICIT — no flag. A verbs block IS the declaration "these are my tool
 * actions", and a tool only surfaces via the `<key>:dispatch` guard, so a non-empty block
 * always derives `<key>:dispatch` into provides + subscribes. To declare something that
 * does NOT surface (the agent's `integration:respond` sugar, a raw event), keep it in raw
 * `provides`/`subscribes` OUTSIDE this block.
 *
 * `verbs` COEXISTS with raw `provides`/`subscribes` — those still carry the NON-verb
 * entries a verb map cannot hold (host events like `user:prompt`, sugar strings, apis). */
export interface PluginVerbsBlock {
	/** The routing key prefixed onto every short verb. Optional — inferred from `id`. */
	key?: string;
	/** The verbs, keyed by SHORT name (no prefix) → their list flags + doc/schema. */
	list?: Record<string, PluginVerbEntry>;
}

export interface PluginCapabilities {
	provides: string[];
	requires: string[];
	/** The ergonomic authoring form for dispatchable verbs — lowered to the raw lists
	 * below by normalizeCapabilities at load. Optional; coexists with raw provides/
	 * subscribes (which carry non-verb entries). See {@link PluginVerbsBlock}. */
	verbs?: PluginVerbsBlock;
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
	/** Per-verb argument SCHEMA (JSON-Schema object), keyed by the same `<key>:<verb>`
	 * string in `provides`. When present, the agent leg renders THIS as the model tool's
	 * parameters instead of the generic variadic `{ args: string[] }` — so a plugin verb
	 * reaches the agent as a TYPED tool. The value is the JSON-Schema body (the object
	 * that becomes Anthropic `input_schema` / OpenAI `parameters`); the host wraps it in
	 * the provider envelope. A verb with no entry keeps the variadic shape — that is not a
	 * legacy fallback but the correct schema for a verb whose args are genuinely opaque.
	 * The companion of `verbDocs`: docs teach PROSE, schemas teach FORM. Optional. */
	verbSchemas?: Record<string, Record<string, unknown>>;
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
	/** Non-fatal advisories — e.g. a surface layer outside the known set (a NEW surface per
	 * ADR-085, not a form error). The manifest is still `valid`; a projector must exist for
	 * the surface to render. Optional for back-compat with older result readers. */
	warnings?: string[];
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

/** The canonical routing key inferred from a plugin id (last path segment,
 * `@scope/vault → vault`) — the default `verbs` block key. */
export function pluginKeyFromId(id: string): string;
/** Lower a `capabilities.verbs` authoring block into the raw vocabulary
 * (`provides`/`subscribes`/`verbDocs`/`verbSchemas`), merged with any raw entries and
 * de-duped. `id` supplies the inferred key when `verbs.key` is absent. Returns the
 * capabilities unchanged when there is no `verbs` block. */
export function normalizeCapabilities(
	capabilities: PluginCapabilities,
	id?: string,
): PluginCapabilities;
/** Manifest-level convenience: {@link normalizeCapabilities} using the manifest's own
 * `id`, returning a new manifest (unchanged when there is no `verbs` block). */
export function normalizeManifest(manifest: PluginManifest): PluginManifest;

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
