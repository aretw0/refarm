import { buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import {
	modelCredentialEnvKey,
	modelCredentialStatus as resolveModelCredentialStatus,
} from "@refarm.dev/config";
import {
	credentialSecretLocation,
	readCredentialAt,
	readLegacyCredentials,
} from "@refarm.dev/model-account-contract-v1";
import { isContainer as detectContainerRuntime, fetchWithTimeout } from "@refarm.dev/root";
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import {
	DEFAULT_MODEL_PROVIDER,
	defaultModelForProvider,
	defaultModelForScope,
	effectiveModelRouteForScope,
	formatModelRef,
	isRuntimeSubscriptionModelProvider,
	isSubscriptionModelProvider,
	MODEL_BASE_URL_ENV_VAR,
	MODEL_CONFIGURED_PROVIDERS_ENV_VAR,
	MODEL_DEFAULT_PROVIDER_ENV_VAR,
	MODEL_FALLBACK_MODEL_ID_ENV_VAR,
	MODEL_FALLBACK_PROVIDER_ENV_VAR,
	MODEL_ID_ENV_VAR,
	MODEL_PROVIDER_ENV_VAR,
	MODEL_PROVIDERS,
	MODEL_RUNTIME_ENV_VARS,
	MODEL_SCOPES,
	parseModelRef,
	type ModelScope,
} from "../model-routing.js";
import { resolveNodeContextMetadata, type NodeContextMetadata } from "../utils/context-metadata.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	modelBaseUrlJsonCommand,
	modelRefJsonCommand,
	OLLAMA_DEFAULT_REF,
	OPENAI_DEFAULT_REF,
	OPENAI_MONITOR_REF,
	OPENAI_WORKER_REF,
	OPERATOR_LINKS_CONFIG_COMMAND,
	setScopedModelJsonCommand,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
	sowModelJsonCommand,
} from "./credential-handoffs.js";
import {
	providerDoctorProfile,
	type ProviderDoctorProfile,
	type ProviderProbeReason,
} from "./model-provider-doctor.js";
import { sidecarUrl } from "./sidecar-url.js";
export {
	buildInvalidScopeEnvelope,
	buildResetScopedModelEnvelope,
	buildSetFallbackEnvelope,
	buildSetModelBaseUrlEnvelope,
	buildSetModelEnvelope,
} from "./model-mutators.js";

const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";
const OLLAMA_DOCKER_BASE_URL = "http://host.docker.internal:11434";
const MODEL_PROVIDER_PROBE_TIMEOUT_MS = 2_000;
const REFARM_MANAGED_MODEL_ENV_KEYS = "REFARM_MANAGED_MODEL_ENV_KEYS";

export interface ModelTokens {
	modelProvider?: string;
	modelId?: string;
	modelRoutes?: Partial<Record<ModelScope, string>>;
	modelBaseUrl?: string;
	modelFallbackProvider?: string;
	modelFallbackModelId?: string;
	model?: string;
	modelApiKey?: string;
	oauthProvider?: string;
	oauthCredentials?: Record<string, unknown>;
}

interface RuntimeOAuthCredential {
	access: string;
	accountId?: string;
}

export interface ModelCommandDeps {
	loadTokens(): Promise<ModelTokens>;
	saveTokens(tokens: Record<string, unknown>): Promise<unknown>;
	fetch?: typeof fetch;
	isContainer?: () => boolean;
}

export interface CurrentModelStatus {
	current: {
		provider: string | undefined;
		modelId: string | undefined;
		ref: string;
	};
	routes: Record<ModelScope, string>;
	credential: {
		envKey: string | undefined;
		state: "not-required" | "env" | "silo-api-key" | "silo-oauth" | "missing";
		status: string | null;
	};
	routeCredentials: Record<
		ModelScope,
		{
			provider: string | undefined;
			envKey: string | undefined;
			state: "not-required" | "env" | "silo-api-key" | "silo-oauth" | "missing";
			status: string | null;
		}
	>;
	baseUrl: string | undefined;
	/**
	 * WHERE {@link baseUrl} came from — `undefined` when there is no base URL at all.
	 *
	 * Recorded because the two sources have different remedies and only one of them is reachable
	 * from inside this process (ISS-121). Without this, an operator handed `model base-url off`
	 * for an environment-exported endpoint would watch the command succeed and the fault remain.
	 */
	baseUrlSource: "env" | "silo" | undefined;
	fallback: string | undefined;
	source: {
		kind: "environment" | "identity" | "built-in";
		envOverrides: string[];
	};
	context: NodeContextMetadata;
	recommendations?: {
		diagnostic: string;
		severity: "failure" | "warning" | "info";
		summary: string;
		action: string;
		command?: string;
	}[];
	handoffs?: {
		interactive: string;
		inspectProviders: string;
		localNoKeyModel: string;
		openExternalLinks: string;
		setModel: string;
		setWorkerModel: string;
		setMonitorModel: string;
	};
}

/**
 * What the stored OAuth credential says about its own lifetime — THREE STATES (ISS-081).
 *
 * `unknown` is not a hedge and not "probably fine": it is a credential that carries no `expires`,
 * or a provider that is not OAuth at all. Reporting that as `valid` would be the shape this
 * repository keeps removing — an absence rendered as a reassurance.
 */
export type CredentialLifetime =
	| { state: "valid"; expiresAt: number; remainingMs: number }
	| { state: "expired"; expiresAt: number; expiredForMs: number }
	| { state: "unknown"; reason: "not-oauth" | "no-expiry-recorded" };

export interface ModelDoctorStatus {
	current: CurrentModelStatus["current"];
	/** Carried from {@link CurrentModelStatus} because it decides which remedy the doctor can offer. */
	baseUrlSource: CurrentModelStatus["baseUrlSource"];
	/**
	 * THE CREDENTIAL'S OWN CLOCK, reported beside the reachability probe and never folded into it.
	 *
	 * Measured on the operator's node 2026-08-12: the `openai-codex` token had expired FIVE DAYS
	 * earlier and nothing in this repository said so. `model doctor` probed whether the endpoint
	 * answers, which is a different question — an expired credential and an unreachable host are
	 * two facts with two remedies, and a doctor reporting only the second sends an operator to
	 * debug a network.
	 */
	credential: CredentialLifetime;
	providerProbe: {
		provider: string | undefined;
		baseUrl: string | undefined;
		url: string | undefined;
		ready: boolean | null;
		/** The honest outcome discriminator (see {@link ProviderProbeReason}).
		 * `skipped` is derived from it, kept as a boolean for existing readers. */
		reason: ProviderProbeReason;
		status?: number;
		error?: string;
		timedOut?: boolean;
		skipped?: boolean;
	};
	probeEnvironment: {
		container: boolean;
		localhostTargetsRuntime: boolean;
		dockerHostBaseUrl: string;
	};
	recommendations?: {
		diagnostic: string;
		severity: "failure" | "warning" | "info";
		summary: string;
		action: string;
		command?: string;
	}[];
	handoffs: {
		inspectCurrent: string;
		startOllama: string;
		setDockerOllamaBaseUrl: string;
		/**
		 * Drop the PERSISTED base URL so the provider's built-in endpoint applies again.
		 *
		 * The remedy when the stored configuration is itself the fault. It restores a default
		 * rather than inventing a value — the operator's own endpoint, if they had one, is not
		 * recoverable from here and guessing one would be writing their configuration for them.
		 */
		clearPersistedBaseUrl: string;
		/** Shell, not CLI: an endpoint coming from the environment is outside this process's reach. */
		unsetBaseUrlEnv: string;
	};
}

export interface KnownModelProvider {
	provider: string;
	defaultModel: string | undefined;
	workerModel: string | undefined;
	monitorModel: string | undefined;
	credentialEnv: string | undefined;
}

export function defaultModelDeps(): ModelCommandDeps {
	const silo = new SiloCore();
	return {
		loadTokens: () => silo.loadTokens() as Promise<ModelTokens>,
		saveTokens: (tokens) => silo.saveTokens(tokens),
	};
}

function modelCredentialStatus(provider: string | undefined, tokens: ModelTokens): string | null {
	const status = resolveModelCredentialStatus(provider, tokens, process.env);
	switch (status.state) {
		case "not-required":
			return null;
		case "env":
			return `${status.envKey} env`;
		case "silo-api-key":
			return "Silo API key";
		case "silo-oauth":
			return `Silo OAuth (${status.oauthProvider})`;
		case "missing":
			return "missing (run refarm sow)";
	}
}

function modelCredentialState(
	provider: string | undefined,
	tokens: ModelTokens,
): CurrentModelStatus["credential"]["state"] {
	return resolveModelCredentialStatus(provider, tokens, process.env).state;
}

function modelRouteCredentialStatus(
	provider: string | undefined,
	tokens: ModelTokens,
): CurrentModelStatus["routeCredentials"][ModelScope] {
	const status = resolveModelCredentialStatus(provider, tokens, process.env);
	return {
		provider,
		envKey: "envKey" in status ? status.envKey : undefined,
		state: status.state,
		status: modelCredentialStatus(provider, tokens),
	};
}

function stringToken(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function modelRuntimeCredentialEnv(
	provider: string | undefined,
	tokens: ModelTokens,
): [string, string] | null {
	const envKey = modelCredentialEnvKey(provider);
	if (!envKey || process.env[envKey]) return null;
	const apiKey = stringToken(tokens.modelApiKey);
	return apiKey ? [envKey, apiKey] : null;
}

/**
 * THE DUAL-READ, reached through the account contract rather than by indexing a map.
 *
 * The behaviour is unchanged today: every credential on every existing node is legacy, so the
 * location resolves to the flat token map and this returns exactly what the old two-line lookup
 * returned. What changes is that the knowledge of WHERE a credential lives now lives in one place
 * (`credentialSecretLocation`) instead of being re-derived here, which is the precondition for the
 * writer to move at all. Readers before writers — the other order leaves a credential nothing can
 * read.
 *
 * `unreadable` is deliberately treated the same as absent BY THIS CALLER and not by the contract:
 * `runtimeOAuthCredential` returns a nullable credential to a caller that only decides whether to
 * export an environment variable. The distinction is preserved where it can be acted on, and
 * collapsed only at the boundary that cannot act on it.
 */
function runtimeOAuthCredential(
	provider: string | undefined,
	tokens: ModelTokens,
): RuntimeOAuthCredential | null {
	if (!provider || tokens.oauthProvider !== provider) return null;
	const descriptor = readLegacyCredentials(tokens as Record<string, unknown>).find(
		(account) => account.provider === provider,
	);
	if (!descriptor) return null;
	const read = readCredentialAt(credentialSecretLocation(descriptor), {
		legacyOauthCredentials: tokens.oauthCredentials as Record<string, unknown> | undefined,
	});
	if (read.kind !== "found") return null;
	const candidate = read.credential as { access?: unknown; accountId?: unknown };
	if (typeof candidate.access !== "string" || candidate.access.trim().length === 0) {
		return null;
	}
	return {
		access: candidate.access,
		...(typeof candidate.accountId === "string" && candidate.accountId.trim().length > 0
			? { accountId: candidate.accountId }
			: {}),
	};
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Compute the ordered model runtime env entries (no I/O). Shared by the shell
 * printer and the `env` envelope so both surface the exact same variables. */
function buildModelEnvEntries(
	tokens: ModelTokens,
	options: { includeSecrets?: boolean } = {},
): [string, string][] {
	const status = buildCurrentModelStatus(tokens);
	const entries: [string, string][] = [];
	if (status.current.provider) {
		entries.push([MODEL_PROVIDER_ENV_VAR, status.current.provider]);
	}
	if (status.current.modelId) {
		entries.push([MODEL_ID_ENV_VAR, status.current.modelId]);
	}
	if (status.baseUrl) {
		entries.push([MODEL_BASE_URL_ENV_VAR, status.baseUrl]);
	}
	if (status.fallback) {
		const fallback = parseModelRef(status.fallback, status.current.provider);
		if (fallback?.provider) {
			entries.push([MODEL_FALLBACK_PROVIDER_ENV_VAR, fallback.provider]);
		}
		if (fallback?.modelId) {
			entries.push([MODEL_FALLBACK_MODEL_ID_ENV_VAR, fallback.modelId]);
		}
	}
	const credential = modelRuntimeCredentialEnv(status.current.provider, tokens);
	if (credential) entries.push(credential);
	// ADR-012: advertise WHICH providers are configured (names only, never keys) so the
	// guest agent's routing profiles (cheap/balanced/reliable) can resolve to a provider
	// the operator actually has credentials for. Derived from each known provider's
	// credential state — env / silo key / silo oauth / keyless local floor all count as
	// configured; only "missing" is excluded. The list crosses the host→guest boundary
	// as text (tractor's MODEL_CONFIGURED_PROVIDERS text-content allowlist); the secrets
	// themselves never do.
	const configuredProviders = MODEL_PROVIDERS.filter(
		(provider) => modelCredentialState(provider, tokens) !== "missing",
	);
	if (configuredProviders.length > 0) {
		entries.push([MODEL_CONFIGURED_PROVIDERS_ENV_VAR, configuredProviders.join(",")]);
	}
	if (options.includeSecrets) {
		const oauthCredential = runtimeOAuthCredential(status.current.provider, tokens);
		const oauthEnvKey = modelCredentialEnvKey(status.current.provider);
		if (oauthCredential && oauthEnvKey && !process.env[oauthEnvKey]) {
			entries.push([oauthEnvKey, oauthCredential.access]);
		}
		if (
			status.current.provider === "openai-codex" &&
			oauthCredential?.accountId &&
			!process.env.OPENAI_CODEX_ACCOUNT_ID
		) {
			entries.push(["OPENAI_CODEX_ACCOUNT_ID", oauthCredential.accountId]);
		}
	}
	return entries;
}

/** Build the `model env` envelope (no I/O): the resolved runtime env entries as
 * a success envelope. `env` is read-only (no saveTokens); the shell-export text
 * surface is rendered by the env renderText hook via formatModelEnvFromEnvelope. */
export function buildModelEnvEnvelope(
	tokens: ModelTokens,
	options: { includeSecrets?: boolean } = {},
) {
	const entries = buildModelEnvEntries(tokens, options);
	const env: Record<string, string> = {};
	for (const [key, value] of entries) {
		env[key] = value;
	}
	const managedKeys = entries.map(([key]) => key);
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "env",
		extra: {
			env,
			managedKeys,
			[REFARM_MANAGED_MODEL_ENV_KEYS]: managedKeys.join(","),
		},
		nextCommand: MODEL_CURRENT_JSON_COMMAND,
		nextCommands: [MODEL_CURRENT_JSON_COMMAND],
	});
}

/** Format the ordered env entries as POSIX shell exports (no I/O). The shell
 * printer and the capability `env` renderText hook share this one formatter so
 * `model env --shell` produces byte-identical output on every surface. */
function formatModelEnvShell(entries: [string, string][]): string {
	const lines = entries.map(([key, value]) => `export ${key}=${shellQuote(value)}`);
	if (entries.length > 0) {
		lines.push(
			`export ${REFARM_MANAGED_MODEL_ENV_KEYS}=${shellQuote(entries.map(([key]) => key).join(","))}`,
		);
	}
	return lines.join("\n");
}

/** Render the `model env` text surface from its envelope: the hint line unless
 * `--shell`, else the shell exports reconstructed from the envelope's ordered
 * `managedKeys` + `env` map. Matches the legacy `model env` behavior. */
export function formatModelEnvFromEnvelope(
	envelope: { env?: Record<string, string>; managedKeys?: string[] },
	options: { shell?: boolean } = {},
): string {
	if (!options.shell) {
		return "Use --shell to print model runtime exports.";
	}
	const env = envelope.env ?? {};
	const entries: [string, string][] = (envelope.managedKeys ?? []).map((key) => [
		key,
		env[key] ?? "",
	]);
	return formatModelEnvShell(entries);
}

function hasPersistedModelRoutes(tokens: ModelTokens): boolean {
	return Boolean(
		tokens.modelRoutes &&
		typeof tokens.modelRoutes === "object" &&
		Object.keys(tokens.modelRoutes).length > 0,
	);
}

function activeModelEnvOverrides(): string[] {
	return MODEL_RUNTIME_ENV_VARS.filter((name) => Boolean(process.env[name]));
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function localhostTargetsRuntime(baseUrl: string | undefined): boolean {
	if (!baseUrl) return true;
	const normalized = baseUrl.trim().toLowerCase();
	return normalized.includes("localhost") || normalized.includes("127.0.0.1");
}

function modelDoctorHandoffs(
	profile: ProviderDoctorProfile = providerDoctorProfile("ollama"),
): ModelDoctorStatus["handoffs"] {
	return {
		inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
		// The local-runtime start command comes from the central per-provider
		// table; the field name stays `startOllama` (the wire) until the shape is
		// generalized. For ollama this is "ollama serve", byte-identical to before.
		startOllama: profile.startCommand ?? "ollama serve",
		setDockerOllamaBaseUrl: modelBaseUrlJsonCommand(OLLAMA_DOCKER_BASE_URL),
		clearPersistedBaseUrl: modelBaseUrlJsonCommand("off"),
		unsetBaseUrlEnv: `unset ${MODEL_BASE_URL_ENV_VAR}`,
	};
}

function modelDoctorRecoveryCommands(status: ModelDoctorStatus): string[] {
	if (status.providerProbe.ready !== false) return [];
	// A ROUTE THAT IS NOT A URL IS NOT FIXED BY STARTING A SERVER. Handing back `ollama serve`
	// here would spend the operator's time on a runtime that was never the problem; the fault is
	// in the stored configuration, so the remedy restores it and then shows what it became.
	if (status.providerProbe.reason === "endpoint-malformed") {
		// WHERE the endpoint came from decides which remedy is even available. A value the shell
		// exported cannot be cleared by this process, and `model base-url off` on an env-sourced
		// endpoint would report success while the malformed value survived the next run.
		return status.baseUrlSource === "env"
			? [status.handoffs.unsetBaseUrlEnv, status.handoffs.inspectCurrent]
			: [status.handoffs.clearPersistedBaseUrl, status.handoffs.inspectCurrent];
	}
	const commands: string[] = [];
	if (status.probeEnvironment.container && status.probeEnvironment.localhostTargetsRuntime) {
		commands.push(status.handoffs.setDockerOllamaBaseUrl);
	}
	commands.push(status.handoffs.startOllama);
	if (
		status.probeEnvironment.container &&
		!commands.includes(status.handoffs.setDockerOllamaBaseUrl)
	) {
		commands.push(status.handoffs.setDockerOllamaBaseUrl);
	}
	commands.push(status.handoffs.inspectCurrent);
	return commands;
}

function modelDoctorRecommendations(
	status: ModelDoctorStatus,
): ModelDoctorStatus["recommendations"] | undefined {
	if (status.providerProbe.ready !== false) return undefined;
	// The machine-readable twin of the human verdict, and it has to agree with it. A consumer
	// reading `model-provider-unreachable` for a route that is not a URL would file a network
	// incident; the diagnostic name is what an automated reader dispatches on.
	if (status.providerProbe.reason === "endpoint-malformed") {
		const fromEnv = status.baseUrlSource === "env";
		return [
			{
				diagnostic: "model-endpoint-malformed",
				severity: "failure",
				summary: `The configured model endpoint is not a URL, so no request was made — the ${fromEnv ? "environment" : "stored configuration"} is the fault, not the network.`,
				action: fromEnv
					? `Unset ${MODEL_BASE_URL_ENV_VAR} in the shell that started this process, then re-check the route.`
					: "Clear the persisted base URL so the provider's built-in endpoint applies again, then re-check the route.",
				command: fromEnv
					? modelDoctorHandoffs().unsetBaseUrlEnv
					: modelDoctorHandoffs().clearPersistedBaseUrl,
			},
		];
	}
	const profile = providerDoctorProfile(status.providerProbe.provider);
	return [
		{
			diagnostic: "model-provider-unreachable",
			severity: "failure",
			summary:
				"The current local model provider endpoint is not reachable from the runtime process.",
			action: profile.recoveryAction,
			command: MODEL_DOCTOR_JSON_COMMAND,
		},
	];
}

/**
 * Ping a resolved provider endpoint over HTTP and classify the outcome honestly.
 * UNAUTHENTICATED by design: a liveness probe checks the route, not the
 * credential ("só rotas não segredos"). A 401/403 still proves the endpoint is
 * UP, so it maps to `auth-failed` (a milder, more accurate verdict than "down")
 * without the host ever sending a key. Any other response → `reachable`; a
 * network error/timeout → `unreachable`.
 */
async function probeProviderEndpoint(
	provider: string | undefined,
	baseUrl: string,
	url: string,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<ModelDoctorStatus["providerProbe"]> {
	const fetchImpl = deps.fetch ?? globalThis.fetch;
	try {
		const response = await fetchWithTimeout(
			url,
			{
				method: "GET",
			},
			{
				timeoutMs: MODEL_PROVIDER_PROBE_TIMEOUT_MS,
				fetch: fetchImpl,
			},
		);
		const authFailed = response.status === 401 || response.status === 403;
		return {
			provider,
			baseUrl,
			url,
			// auth-failed means the endpoint answered — it is reachable at the
			// network layer, so `ready` is true; the reason carries the nuance.
			ready: authFailed ? true : response.ok,
			reason: authFailed ? "auth-failed" : response.ok ? "reachable" : "unreachable",
			status: response.status,
		};
	} catch (error) {
		const name = error instanceof Error ? error.name : undefined;
		const cause = error instanceof Error ? error.cause : undefined;
		const causeRecord =
			cause && typeof cause === "object" ? (cause as Record<string, unknown>) : undefined;
		const causeCode = typeof causeRecord?.code === "string" ? causeRecord.code : undefined;
		const message = error instanceof Error ? error.message : String(error);
		return {
			provider,
			baseUrl,
			url,
			ready: false,
			// A ROUTE THAT CANNOT BE PARSED WAS NEVER PINGED. `fetch` throws before any socket is
			// opened when the URL is malformed, so calling that "unreachable" reports a network
			// verdict for a configuration fact and sends the operator to debug a connection that
			// is fine (ISS-121). `ERR_INVALID_URL` is the code Node uses for exactly this.
			reason: causeCode === "ERR_INVALID_URL" || /Failed to parse URL/u.test(message)
				? "endpoint-malformed"
				: "unreachable",
			error: causeCode ? `${message}: ${causeCode}` : message,
			timedOut: name === "AbortError",
		};
	}
}

/** Ollama's reachability probe — hits its own `/api/tags`, keyless. */
async function probeOllamaProvider(
	baseUrl: string,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<ModelDoctorStatus["providerProbe"]> {
	const url = `${trimTrailingSlash(baseUrl)}/api/tags`;
	return probeProviderEndpoint("ollama", baseUrl, url, deps);
}

/**
 * Ask the tractor runtime to probe a provider whose base URL only IT knows (the
 * canonical provider→URL map lives in the Rust host, not TS). The runtime returns
 * the SAME reason vocabulary this file uses, so its verdict maps 1:1 into the
 * providerProbe shape. If the sidecar itself is unreachable, keep
 * `no-endpoint-source` — never invent a reachability answer TS cannot back.
 */
async function probeProviderViaRuntime(
	provider: string | undefined,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<ModelDoctorStatus["providerProbe"]> {
	const noEndpointSource: ModelDoctorStatus["providerProbe"] = {
		provider,
		baseUrl: undefined,
		url: undefined,
		ready: null,
		reason: "no-endpoint-source",
		skipped: true,
	};
	if (!provider) return noEndpointSource;
	const url = sidecarUrl(`/providers/liveness?provider=${encodeURIComponent(provider)}`);
	try {
		const response = await fetchSidecarWithTimeout(
			url,
			{},
			{ timeoutMs: MODEL_PROVIDER_PROBE_TIMEOUT_MS, fetch: deps.fetch },
		);
		if (!response.ok) return noEndpointSource;
		const verdict = (await response.json()) as {
			provider?: string;
			baseUrl?: string;
			reachable?: boolean | null;
			status?: number;
			reason?: ProviderProbeReason;
		};
		return {
			provider: verdict.provider ?? provider,
			baseUrl: verdict.baseUrl,
			url,
			ready: verdict.reachable ?? null,
			reason: verdict.reason ?? "no-endpoint-source",
			...(typeof verdict.status === "number" ? { status: verdict.status } : {}),
		};
	} catch {
		// Sidecar down/unreachable → TS still cannot resolve the endpoint itself.
		return noEndpointSource;
	}
}

/**
 * Resolve the reachability probe for the configured provider, credential-aware.
 * The four honest cases (see {@link ProviderProbeReason}):
 *  1. ollama (keyless floor) — always pinged at its own /api/tags.
 *  2. keyed provider with a MISSING credential — NOT pinged; warn the key is
 *     missing rather than falsely reporting the endpoint "down".
 *  3. any provider whose base URL TS can resolve (only via the MODEL_BASE_URL
 *     override / persisted token) — pinged unauthenticated.
 *  4. non-ollama with no TS-resolvable endpoint — no-endpoint-source; the Rust
 *     runtime, which owns the provider→baseURL map, fills this in a later fatia.
 */
/**
 * PURE. What the stored credential says about its own expiry.
 *
 * `now` is injected because a lifetime check whose clock is ambient cannot be tested without
 * waiting, and the one thing this must get right is the boundary.
 */
export function credentialLifetime(
	provider: string | undefined,
	tokens: ModelTokens,
	now: number,
): CredentialLifetime {
	// Reached through the account contract, so expiry is read from wherever the credential actually
	// lives. `not-oauth` stays the answer for BOTH "no descriptor" and "nothing stored": neither
	// establishes an expiry, and this function's `unknown` is precisely the state that must not be
	// mistaken for `expired` — an API-key provider records no expiry at all, and re-prompting every
	// run for every keyed provider is the defect that reading absence as failure produces.
	const descriptor = provider
		? readLegacyCredentials(tokens as Record<string, unknown>).find((a) => a.provider === provider)
		: undefined;
	if (!descriptor) return { state: "unknown", reason: "not-oauth" };
	const read = readCredentialAt(credentialSecretLocation(descriptor), {
		legacyOauthCredentials: (tokens as { oauthCredentials?: Record<string, unknown> })
			.oauthCredentials,
	});
	if (read.kind !== "found") return { state: "unknown", reason: "not-oauth" };
	const entry = read.credential as { expires?: unknown };
	const expiresAt = typeof entry.expires === "number" ? entry.expires : null;
	if (expiresAt === null) return { state: "unknown", reason: "no-expiry-recorded" };
	return expiresAt <= now
		? { state: "expired", expiresAt, expiredForMs: now - expiresAt }
		: { state: "valid", expiresAt, remainingMs: expiresAt - now };
}

async function resolveProviderProbe(
	provider: string | undefined,
	current: CurrentModelStatus,
	tokens: ModelTokens,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<ModelDoctorStatus["providerProbe"]> {
	// 1. ollama — the keyless local floor.
	if (provider === "ollama") {
		return probeOllamaProvider(current.baseUrl ?? OLLAMA_DEFAULT_BASE_URL, deps);
	}

	// 2. keyed provider, credential absent → do not ping (avoid a false "down").
	if (modelCredentialState(provider, tokens) === "missing") {
		return {
			provider: current.current.provider,
			baseUrl: current.baseUrl,
			url: undefined,
			ready: null,
			reason: "credential-missing",
			skipped: true,
		};
	}

	// 3. TS resolved a base URL (MODEL_BASE_URL override / persisted token) → ping.
	if (current.baseUrl) {
		return probeProviderEndpoint(
			current.current.provider,
			current.baseUrl,
			trimTrailingSlash(current.baseUrl),
			deps,
		);
	}

	// 4. non-ollama, no TS-known endpoint → ask the runtime, which owns the
	// provider→URL map. Falls back to no-endpoint-source if the sidecar is down.
	return probeProviderViaRuntime(current.current.provider, deps);
}

export async function buildModelDoctorStatus(
	tokens: ModelTokens,
	deps: Pick<ModelCommandDeps, "fetch" | "isContainer"> = {},
): Promise<ModelDoctorStatus> {
	const current = buildCurrentModelStatus(tokens);
	const profile = providerDoctorProfile(current.current.provider);
	const handoffs = modelDoctorHandoffs(profile);
	const container = deps.isContainer?.() ?? detectContainerRuntime();
	const probeEnvironment = {
		container,
		localhostTargetsRuntime: localhostTargetsRuntime(current.baseUrl),
		dockerHostBaseUrl: OLLAMA_DOCKER_BASE_URL,
	};
	const provider = current.current.provider?.trim().toLowerCase();
	const probe = await resolveProviderProbe(provider, current, tokens, deps);
	const status: ModelDoctorStatus = {
		current: current.current,
		baseUrlSource: current.baseUrlSource,
		credential: credentialLifetime(provider, tokens, Date.now()),
		providerProbe: probe,
		probeEnvironment,
		handoffs,
	};
	return {
		...status,
		recommendations: modelDoctorRecommendations(status),
	};
}

/** Build the `model doctor` JSON envelope (probes via injected fetch), shared by
 * every surface. */
export async function buildModelDoctorEnvelope(
	tokens: ModelTokens,
	deps: Pick<ModelCommandDeps, "fetch" | "isContainer"> = {},
) {
	const status = await buildModelDoctorStatus(tokens, deps);
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "doctor",
		extra: status,
		nextActions: modelDoctorRecoveryCommands(status),
		nextCommands: modelDoctorRecoveryCommands(status),
	});
}

/** Format the `model doctor` human text as a string (no I/O), so the CLI
 * renderText hook formats from this single source of truth. */
export async function formatModelDoctor(
	tokens: ModelTokens,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<string> {
	return formatModelDoctorFromStatus(await buildModelDoctorStatus(tokens, deps));
}

/** Format `model doctor` text from an already-computed status — so a CLI
 * renderText hook formats straight from the envelope. */
/**
 * The credential's own clock, as one line — or NOTHING when there is nothing to say.
 *
 * `unknown` prints no line on purpose. A doctor that announces "credential: unknown" for every
 * keyless local provider teaches an operator to skim past the line, and the day it says `expired`
 * they skim past that too. Silence where there is no fact, a sentence where there is one.
 */
export function formatCredentialLifetime(lifetime: CredentialLifetime): string | null {
	const days = (ms: number) => Math.floor(ms / 86_400_000);
	if (lifetime.state === "expired") {
		const held = days(lifetime.expiredForMs);
		return chalk.red(
			`  credential: EXPIRED ${held === 0 ? "today" : `${held} day(s) ago`} — this authenticates nothing; re-run the provider login`,
		);
	}
	if (lifetime.state === "valid") {
		const left = days(lifetime.remainingMs);
		return left <= 3
			? chalk.yellow(`  credential: expires in ${left} day(s)`)
			: chalk.dim(`  credential: valid for ${left} more day(s)`);
	}
	return null;
}

export function formatModelDoctorFromStatus(status: ModelDoctorStatus): string {
	const lines: string[] = [];
	lines.push(chalk.bold("Model doctor"));
	lines.push(`  current: ${chalk.cyan(status.current.ref)}`);
	// BEFORE the probe, and before any early return. An expired credential and an unreachable
	// host are two facts with two remedies, and every `return` below this point belongs to the
	// probe — printing the credential after them means the one case where it matters most (a
	// skipped or failed probe) is the one where it never gets said (ISS-081).
	const credentialLine = formatCredentialLifetime(status.credential);
	if (credentialLine) lines.push(credentialLine);
	if (status.providerProbe.skipped) {
		lines.push("  provider probe: skipped");
		lines.push(chalk.dim("  use --json for machine-readable handoffs"));
		return lines.join("\n");
	}
	lines.push(`  probe:   ${status.providerProbe.url}`);
	if (status.providerProbe.ready) {
		lines.push(chalk.green(`  status:  ready (${status.providerProbe.status})`));
		return lines.join("\n");
	}
	// The VERDICT the operator reads, not a constant. Printing "unreachable" for every failure
	// meant a malformed route — a configuration fact — arrived as a network verdict, and the
	// evidence that said otherwise sat one line below, in an error string nobody reads first.
	lines.push(chalk.red(`  status:  ${status.providerProbe.reason}`));
	if (status.providerProbe.reason === "endpoint-malformed") {
		lines.push(
			chalk.red(
				`  meaning: the configured endpoint is not a URL, so nothing was contacted — the fault is in the ${status.baseUrlSource === "env" ? "environment" : "stored configuration"}, not the network`,
			),
		);
	}
	if (status.providerProbe.error) lines.push(`  error:   ${status.providerProbe.error}`);
	for (const command of modelDoctorRecoveryCommands(status)) {
		lines.push(chalk.dim(`  fix:     ${command}`));
	}
	return lines.join("\n");
}

/** Format the `model current` human text as a string (no I/O), so the CLI
 * renderText hook formats from this single source of truth. */
export function formatCurrentModel(tokens: ModelTokens): string {
	return formatCurrentModelFromStatus(buildCurrentModelStatus(tokens));
}

/** Format `model current` text from an already-computed status — so a CLI
 * renderText hook can format straight from the envelope (which carries the
 * status) without re-loading tokens. */
export function formatCurrentModelFromStatus(status: CurrentModelStatus): string {
	const provider = status.current.provider;
	const resolvedModel = status.current.modelId;
	const lines: string[] = [];

	lines.push(chalk.bold("Model routing"));
	lines.push(`  current: ${chalk.cyan(status.current.ref)}`);
	if (provider) lines.push(`  provider: ${provider}`);
	if (resolvedModel) lines.push(`  model:    ${resolvedModel}`);
	if (status.credential.envKey) lines.push(`  key env:  ${status.credential.envKey}`);
	if (status.credential.status) lines.push(`  key:      ${status.credential.status}`);
	lines.push(`  context:  ${status.context.mode}`);
	lines.push(
		`  binding:  ${status.context.binding.kind} (${status.context.binding.origin})`,
	);
	lines.push(`  state:    ${status.context.state.policy}`);
	lines.push(`  creds:    ${status.context.credentials.policy}`);
	lines.push(`  runtime:  ${status.context.runtime.policy}`);
	lines.push(`  home:     ${status.context.sovereignHome}`);
	lines.push(`  store:    ${status.context.credentialStoreHome}`);
	if (!status.context.homesAligned) {
		lines.push(chalk.yellow("  warning: REFARM_HOME and SILO_HOME resolve to different homes"));
	}
	if (status.baseUrl) lines.push(`  base url: ${status.baseUrl}`);
	if (status.fallback) lines.push(`  fallback: ${status.fallback}`);
	if (provider === "ollama") lines.push(chalk.dim(`  doctor:   ${MODEL_DOCTOR_JSON_COMMAND}`));
	if (status.routes.worker) lines.push(`  worker:   ${status.routes.worker}`);
	if (status.routes.monitor) lines.push(`  monitor:  ${status.routes.monitor}`);
	for (const recommendation of status.recommendations ?? []) {
		lines.push(chalk.yellow(`  warning: ${recommendation.summary}`));
		if (recommendation.command) {
			lines.push(chalk.dim(`  fix:     ${recommendation.command}`));
		}
	}
	if (status.source.kind === "environment") {
		lines.push(chalk.dim("  source:   environment overrides are active"));
		lines.push(chalk.dim(`  env:      ${status.source.envOverrides.join(", ")}`));
	} else if (status.source.kind === "identity") {
		lines.push(chalk.dim("  source:   ~/.refarm/identity.json"));
	} else {
		lines.push(chalk.dim("  source:   built-in defaults"));
		lines.push(chalk.dim(`  openai default: ${OPENAI_DEFAULT_REF}`));
		lines.push(chalk.dim(`  openai worker:  ${OPENAI_WORKER_REF}`));
		lines.push(chalk.dim(`  openai monitor: ${OPENAI_MONITOR_REF}`));
		lines.push(chalk.dim(`  set one:        refarm model ${OPENAI_DEFAULT_REF}`));
		lines.push(chalk.dim("  login:          refarm sow"));
	}
	if (provider && !status.credential.envKey && provider !== "ollama") {
		lines.push(chalk.dim("  custom provider: set endpoint with refarm model base-url <url>"));
	}
	return lines.join("\n");
}

/** Build the `model current` JSON envelope (no I/O) so every surface — CLI, the
 * REPL /model capability, an API — returns the identical result. */
export function buildCurrentModelEnvelope(tokens: ModelTokens) {
	const status = buildCurrentModelStatus(tokens);
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "current",
		extra: status,
		nextActions: currentModelNextActions(status),
		nextCommands: currentModelNextCommands(status),
	});
}

function currentModelNextActions(status: CurrentModelStatus): string[] {
	return currentModelRecoveryCommands(status);
}

function currentModelNextCommands(status: CurrentModelStatus): string[] {
	return currentModelRecoveryCommands(status);
}

function currentModelRecoveryCommands(status: CurrentModelStatus): string[] {
	const commands: string[] = [];
	const seenMissingProviders = new Set<string>();
	for (const scope of MODEL_SCOPES) {
		const credential = status.routeCredentials[scope];
		const subscriptionUnsupported =
			isSubscriptionModelProvider(credential.provider) &&
			!isRuntimeSubscriptionModelProvider(credential.provider) &&
			credential.state !== "missing" &&
			credential.state !== "not-required";
		if (credential.state !== "missing" && !subscriptionUnsupported) continue;
		const providerKey = credential.provider?.trim().toLowerCase() ?? scope;
		if (seenMissingProviders.has(providerKey)) continue;
		seenMissingProviders.add(providerKey);
		if (scope === "default") {
			commands.push(
				SOW_JSON_COMMAND,
				MODEL_PROVIDERS_JSON_COMMAND,
				sowModelJsonCommand(status.current.ref),
				LOCAL_MODEL_JSON_COMMAND,
			);
			continue;
		}
		commands.push(
			SOW_JSON_COMMAND,
			MODEL_PROVIDERS_JSON_COMMAND,
			setScopedModelJsonCommand(scope, OLLAMA_DEFAULT_REF),
		);
	}
	return Array.from(new Set(commands));
}

function currentModelMissingRecommendations(
	status: Pick<CurrentModelStatus, "routeCredentials">,
): NonNullable<CurrentModelStatus["recommendations"]> {
	const recommendations: NonNullable<CurrentModelStatus["recommendations"]> = [];
	const seenMissingProviders = new Set<string>();
	const seenSubscriptionProviders = new Set<string>();
	for (const scope of MODEL_SCOPES) {
		const credential = status.routeCredentials[scope];
		const subscriptionUnsupported =
			isSubscriptionModelProvider(credential.provider) &&
			!isRuntimeSubscriptionModelProvider(credential.provider) &&
			credential.state !== "missing" &&
			credential.state !== "not-required";
		if (subscriptionUnsupported) {
			const providerKey = credential.provider?.trim().toLowerCase() ?? scope;
			if (seenSubscriptionProviders.has(providerKey)) continue;
			seenSubscriptionProviders.add(providerKey);
			recommendations.push({
				diagnostic:
					scope === "default"
						? "model-subscription-runtime-unsupported"
						: `model-${scope}-subscription-runtime-unsupported`,
				severity: "warning",
				summary: `${scope === "default" ? "The current" : `The ${scope}`} model route uses subscription OAuth, which is stored for operator login but is not a runtime API credential yet.`,
				action:
					"Configure an API-key provider, use a local model route, or add a runtime adapter for the subscription provider.",
				command:
					scope === "default"
						? SOW_JSON_COMMAND
						: setScopedModelJsonCommand(scope, OLLAMA_DEFAULT_REF),
			});
			continue;
		}
		if (credential.state !== "missing") continue;
		const providerKey = credential.provider?.trim().toLowerCase() ?? scope;
		if (seenMissingProviders.has(providerKey)) continue;
		seenMissingProviders.add(providerKey);
		if (scope === "default") {
			recommendations.push({
				diagnostic: "model-credentials-missing",
				severity: "failure",
				summary: "The current model route requires credentials that are not available.",
				action: "Inspect provider requirements or run the credential handoff.",
				command: SOW_JSON_COMMAND,
			});
			continue;
		}
		recommendations.push({
			diagnostic: `model-${scope}-credentials-missing`,
			severity: "failure",
			summary: `The ${scope} model route requires credentials that are not available.`,
			action: "Configure credentials or switch the scoped route to a no-key local model.",
			command: setScopedModelJsonCommand(scope, OLLAMA_DEFAULT_REF),
		});
	}
	return recommendations;
}

function currentModelHandoffs(
	status: Pick<CurrentModelStatus, "current" | "routes">,
): NonNullable<CurrentModelStatus["handoffs"]> {
	return {
		interactive: SOW_INTERACTIVE_COMMAND,
		inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
		localNoKeyModel: LOCAL_MODEL_JSON_COMMAND,
		openExternalLinks: OPERATOR_LINKS_CONFIG_COMMAND,
		setModel: modelRefJsonCommand(status.current.ref),
		setWorkerModel: setScopedModelJsonCommand("worker", status.routes.worker),
		setMonitorModel: setScopedModelJsonCommand("monitor", status.routes.monitor),
	};
}

function currentModelRecovery(
	status: Pick<CurrentModelStatus, "credential" | "current" | "routes" | "routeCredentials">,
): Pick<CurrentModelStatus, "recommendations" | "handoffs"> {
	const recommendations = currentModelMissingRecommendations(status);
	if (recommendations.length === 0) {
		return { handoffs: currentModelHandoffs(status) };
	}
	return {
		recommendations,
		handoffs: currentModelHandoffs(status),
	};
}

export function resolveRuntimeModelRoute(
	modelStatus: CurrentModelStatus,
	scope: ModelScope,
): { modelProvider?: string; modelId?: string } {
	const selectedRoute = parseModelRef(modelStatus.routes[scope], modelStatus.current.provider);
	return {
		modelProvider: selectedRoute?.provider,
		modelId: selectedRoute?.modelId,
	};
}

export function buildCurrentModelStatus(tokens: ModelTokens): CurrentModelStatus {
	const defaultRoute = effectiveModelRouteForScope(tokens, "default", {
		env: process.env,
	});
	const provider = defaultRoute.provider ?? DEFAULT_MODEL_PROVIDER;
	const resolvedModel = defaultRoute.modelId ?? defaultModelForProvider(provider);
	const ref = formatModelRef(provider, resolvedModel);
	const routeProviderOverridden = Boolean(
		process.env[MODEL_PROVIDER_ENV_VAR] ?? process.env[MODEL_DEFAULT_PROVIDER_ENV_VAR],
	);
	const storedProviderMatchesRoute =
		!routeProviderOverridden || tokens.modelProvider?.toLowerCase() === provider?.toLowerCase();

	const credentialEnv = modelCredentialEnvKey(provider);
	const credentialState = modelCredentialState(provider, tokens);
	const credentialStatus = modelCredentialStatus(provider, tokens);
	const envBaseUrl = process.env[MODEL_BASE_URL_ENV_VAR];
	const siloBaseUrl = storedProviderMatchesRoute ? tokens.modelBaseUrl : undefined;
	const baseUrl = envBaseUrl ?? siloBaseUrl;
	const baseUrlSource: CurrentModelStatus["baseUrlSource"] = envBaseUrl
		? "env"
		: siloBaseUrl
			? "silo"
			: undefined;
	const fallbackProvider =
		process.env[MODEL_FALLBACK_PROVIDER_ENV_VAR] ?? tokens.modelFallbackProvider;
	let fallbackRef: string | undefined;
	if (fallbackProvider) {
		const fallbackModelId =
			process.env[MODEL_FALLBACK_MODEL_ID_ENV_VAR] ??
			(process.env[MODEL_FALLBACK_PROVIDER_ENV_VAR] ? undefined : tokens.modelFallbackModelId) ??
			defaultModelForProvider(fallbackProvider);
		fallbackRef = formatModelRef(fallbackProvider, fallbackModelId);
	}
	const worker = effectiveModelRouteForScope(tokens, "worker", {
		env: process.env,
	});
	const workerRoute = formatModelRef(worker.provider, worker.modelId);
	const monitor = effectiveModelRouteForScope(tokens, "monitor", {
		env: process.env,
	});
	const monitorRoute = formatModelRef(monitor.provider, monitor.modelId);
	const routeCredentials: CurrentModelStatus["routeCredentials"] = {
		default: modelRouteCredentialStatus(provider, tokens),
		worker: modelRouteCredentialStatus(worker.provider, tokens),
		monitor: modelRouteCredentialStatus(monitor.provider, tokens),
	};
	const envOverrides = activeModelEnvOverrides();
	let sourceKind: CurrentModelStatus["source"]["kind"];
	if (envOverrides.length > 0) {
		sourceKind = "environment";
	} else if (
		tokens.modelProvider ||
		tokens.modelId ||
		tokens.model ||
		tokens.modelBaseUrl ||
		tokens.modelFallbackProvider ||
		tokens.modelFallbackModelId ||
		hasPersistedModelRoutes(tokens)
	) {
		sourceKind = "identity";
	} else {
		sourceKind = "built-in";
	}

	const status: CurrentModelStatus = {
		current: { provider, modelId: resolvedModel, ref },
		routes: {
			default: ref,
			worker: workerRoute,
			monitor: monitorRoute,
		},
		credential: {
			envKey: credentialEnv,
			state: credentialState,
			status: credentialStatus,
		},
		routeCredentials,
		baseUrl,
		baseUrlSource,
		fallback: fallbackRef,
		source: {
			kind: sourceKind,
			envOverrides,
		},
		context: resolveNodeContextMetadata(process.env),
	};
	return {
		...status,
		...currentModelRecovery(status),
	};
}

export function buildKnownModelProviders(): KnownModelProvider[] {
	return MODEL_PROVIDERS.map((provider) => ({
		provider,
		defaultModel: defaultModelForProvider(provider),
		workerModel: defaultModelForScope(provider, "worker"),
		monitorModel: defaultModelForScope(provider, "monitor"),
		credentialEnv: modelCredentialEnvKey(provider),
	}));
}

/** Format the `model providers` human text as a string (no I/O), so the CLI
 * renderText hook formats from this single source of truth. */
export function formatKnownModelProviders(): string {
	const lines: string[] = [];
	lines.push(chalk.bold("Known model providers"));
	for (const provider of buildKnownModelProviders()) {
		const { defaultModel, workerModel, monitorModel, credentialEnv } = provider;
		lines.push(`  ${chalk.cyan(provider.provider)}`);
		if (defaultModel) lines.push(`    default: ${defaultModel}`);
		if (workerModel && workerModel !== defaultModel) lines.push(`    worker:  ${workerModel}`);
		if (monitorModel && monitorModel !== defaultModel) lines.push(`    monitor: ${monitorModel}`);
		if (credentialEnv) lines.push(`    key env: ${credentialEnv}`);
	}
	lines.push(chalk.dim(""));
	lines.push(chalk.dim("Custom/self-hosted providers are allowed with provider/model refs."));
	lines.push(
		chalk.dim(
			"Use refarm model base-url <url> when the provider does not have a built-in endpoint.",
		),
	);
	return lines.join("\n");
}

/** Build the `model providers` JSON envelope (no I/O), shared by every surface. */
export function buildKnownModelProvidersEnvelope() {
	return buildJsonSuccessEnvelope({
		command: "model",
		operation: "providers",
		extra: { providers: buildKnownModelProviders() },
		nextCommand: MODEL_CURRENT_JSON_COMMAND,
		nextCommands: [MODEL_CURRENT_JSON_COMMAND],
	});
}
