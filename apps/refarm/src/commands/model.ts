import { quoteCommandArg, refarmCommand } from "@refarm.dev/cli/command-handoff";
import { buildJsonSuccessEnvelope } from "@refarm.dev/cli/json-output";
import { modelCredentialEnvKey, modelCredentialStatus as resolveModelCredentialStatus, } from "@refarm.dev/config";
import { isContainer as detectContainerRuntime } from "@refarm.dev/root";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import {
	DEFAULT_MODEL_PROVIDER, defaultModelForProvider, defaultModelForScope, defaultProviderModelRef, defaultScopedModelRef, effectiveModelRouteForScope, formatModelRef, isRuntimeSubscriptionModelProvider, isSubscriptionModelProvider, MODEL_BASE_URL_ENV_VAR, MODEL_DEFAULT_PROVIDER_ENV_VAR, MODEL_FALLBACK_MODEL_ID_ENV_VAR, MODEL_FALLBACK_PROVIDER_ENV_VAR, MODEL_ID_ENV_VAR, MODEL_PROVIDER_ENV_VAR, MODEL_PROVIDERS, MODEL_RUNTIME_ENV_VARS, MODEL_SCOPES, parseModelRef, type ModelScope,
} from "../model-routing.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";
import {
	type ProviderDoctorProfile,
	type ProviderProbeReason,
	providerDoctorProfile,
} from "./model-provider-doctor.js";
import { fetchSidecarWithTimeout } from "./sidecar-fetch.js";
import { sidecarUrl } from "./sidecar-url.js";
export {
	buildInvalidScopeEnvelope,
	buildResetScopedModelEnvelope,
	buildSetFallbackEnvelope,
	buildSetModelBaseUrlEnvelope,
	buildSetModelEnvelope,
} from "./model-mutators.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
const OPENAI_MONITOR_REF = defaultScopedModelRef("monitor", "openai");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");
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
	fallback: string | undefined;
	source: {
		kind: "environment" | "identity" | "built-in";
		envOverrides: string[];
	};
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

export interface ModelDoctorStatus {
	current: CurrentModelStatus["current"];
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

function modelCredentialStatus(
	provider: string | undefined,
	tokens: ModelTokens,
): string | null {
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
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
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

function runtimeOAuthCredential(
	provider: string | undefined,
	tokens: ModelTokens,
): RuntimeOAuthCredential | null {
	if (!provider || tokens.oauthProvider !== provider) return null;
	if (!tokens.oauthCredentials || typeof tokens.oauthCredentials !== "object")
		return null;
	const value = tokens.oauthCredentials[provider];
	if (!value || typeof value !== "object") return null;
	const candidate = value as { access?: unknown; accountId?: unknown };
	if (
		typeof candidate.access !== "string" ||
		candidate.access.trim().length === 0
	) {
		return null;
	}
	return {
		access: candidate.access,
		...(typeof candidate.accountId === "string" &&
		candidate.accountId.trim().length > 0
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
	if (options.includeSecrets) {
		const oauthCredential = runtimeOAuthCredential(
			status.current.provider,
			tokens,
		);
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
		setDockerOllamaBaseUrl: refarmCommand([
			"model",
			"base-url",
			OLLAMA_DOCKER_BASE_URL,
			"--json",
		]),
	};
}

function modelDoctorRecoveryCommands(status: ModelDoctorStatus): string[] {
	if (status.providerProbe.ready !== false) return [];
	const commands: string[] = [];
	if (
		status.probeEnvironment.container &&
		status.probeEnvironment.localhostTargetsRuntime
	) {
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
		const response = await fetchWithTimeout(url, {
			method: "GET",
		}, {
			timeoutMs: MODEL_PROVIDER_PROBE_TIMEOUT_MS,
			fetch: fetchImpl,
		});
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
			cause && typeof cause === "object"
				? (cause as Record<string, unknown>)
				: undefined;
		const causeCode =
			typeof causeRecord?.code === "string" ? causeRecord.code : undefined;
		const message = error instanceof Error ? error.message : String(error);
		return {
			provider,
			baseUrl,
			url,
			ready: false,
			reason: "unreachable",
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
	const url = sidecarUrl(
		`/providers/liveness?provider=${encodeURIComponent(provider)}`,
	);
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
	return formatModelDoctorFromStatus(
		await buildModelDoctorStatus(tokens, deps),
	);
}

/** Format `model doctor` text from an already-computed status — so a CLI
 * renderText hook formats straight from the envelope. */
export function formatModelDoctorFromStatus(status: ModelDoctorStatus): string {
	const lines: string[] = [];
	lines.push(chalk.bold("Model doctor"));
	lines.push(`  current: ${chalk.cyan(status.current.ref)}`);
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
	lines.push(chalk.red("  status:  unreachable"));
	if (status.providerProbe.error)
		lines.push(`  error:   ${status.providerProbe.error}`);
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
export function formatCurrentModelFromStatus(
	status: CurrentModelStatus,
): string {
	const provider = status.current.provider;
	const resolvedModel = status.current.modelId;
	const lines: string[] = [];

	lines.push(chalk.bold("Model routing"));
	lines.push(`  current: ${chalk.cyan(status.current.ref)}`);
	if (provider) lines.push(`  provider: ${provider}`);
	if (resolvedModel) lines.push(`  model:    ${resolvedModel}`);
	if (status.credential.envKey)
		lines.push(`  key env:  ${status.credential.envKey}`);
	if (status.credential.status)
		lines.push(`  key:      ${status.credential.status}`);
	if (status.baseUrl) lines.push(`  base url: ${status.baseUrl}`);
	if (status.fallback) lines.push(`  fallback: ${status.fallback}`);
	if (provider === "ollama")
		lines.push(chalk.dim(`  doctor:   ${MODEL_DOCTOR_JSON_COMMAND}`));
	if (status.routes.worker) lines.push(`  worker:   ${status.routes.worker}`);
	if (status.routes.monitor)
		lines.push(`  monitor:  ${status.routes.monitor}`);
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
		lines.push(
			chalk.dim(
				"  custom provider: set endpoint with refarm model base-url <url>",
			),
		);
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
				refarmCommand([
					"sow",
					"--model",
					quoteCommandArg(status.current.ref),
					"--json",
				]),
				LOCAL_MODEL_JSON_COMMAND,
			);
			continue;
		}
		commands.push(
			SOW_JSON_COMMAND,
			MODEL_PROVIDERS_JSON_COMMAND,
			refarmCommand([
				"model",
				"set",
				"--scope",
				scope,
				quoteCommandArg(OLLAMA_DEFAULT_REF),
				"--json",
			]),
		);
	}
	return Array.from(new Set(commands));
}

function currentModelMissingRecommendations(
	status: Pick<CurrentModelStatus, "routeCredentials">,
): NonNullable<CurrentModelStatus["recommendations"]> {
	const recommendations: NonNullable<CurrentModelStatus["recommendations"]> =
		[];
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
						: refarmCommand([
								"model",
								"set",
								"--scope",
								scope,
								quoteCommandArg(OLLAMA_DEFAULT_REF),
								"--json",
							]),
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
				summary:
					"The current model route requires credentials that are not available.",
				action: "Inspect provider requirements or run the credential handoff.",
				command: SOW_JSON_COMMAND,
			});
			continue;
		}
		recommendations.push({
			diagnostic: `model-${scope}-credentials-missing`,
			severity: "failure",
			summary: `The ${scope} model route requires credentials that are not available.`,
			action:
				"Configure credentials or switch the scoped route to a no-key local model.",
			command: refarmCommand([
				"model",
				"set",
				"--scope",
				scope,
				quoteCommandArg(OLLAMA_DEFAULT_REF),
				"--json",
			]),
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
		setModel: refarmCommand([
			"model",
			quoteCommandArg(status.current.ref),
			"--json",
		]),
		setWorkerModel: refarmCommand([
			"model",
			"set",
			"--scope",
			"worker",
			quoteCommandArg(status.routes.worker),
			"--json",
		]),
		setMonitorModel: refarmCommand([
			"model",
			"set",
			"--scope",
			"monitor",
			quoteCommandArg(status.routes.monitor),
			"--json",
		]),
	};
}

function currentModelRecovery(
	status: Pick<
		CurrentModelStatus,
		"credential" | "current" | "routes" | "routeCredentials"
	>,
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
	const selectedRoute = parseModelRef(
		modelStatus.routes[scope],
		modelStatus.current.provider,
	);
	return {
		modelProvider: selectedRoute?.provider,
		modelId: selectedRoute?.modelId,
	};
}

export function buildCurrentModelStatus(
	tokens: ModelTokens,
): CurrentModelStatus {
	const defaultRoute = effectiveModelRouteForScope(tokens, "default", {
		env: process.env,
	});
	const provider = defaultRoute.provider ?? DEFAULT_MODEL_PROVIDER;
	const resolvedModel =
		defaultRoute.modelId ?? defaultModelForProvider(provider);
	const ref = formatModelRef(provider, resolvedModel);
	const routeProviderOverridden = Boolean(
		process.env[MODEL_PROVIDER_ENV_VAR] ??
			process.env[MODEL_DEFAULT_PROVIDER_ENV_VAR],
	);
	const storedProviderMatchesRoute =
		!routeProviderOverridden ||
		tokens.modelProvider?.toLowerCase() === provider?.toLowerCase();

	const credentialEnv = modelCredentialEnvKey(provider);
	const credentialState = modelCredentialState(provider, tokens);
	const credentialStatus = modelCredentialStatus(provider, tokens);
	const baseUrl =
		process.env[MODEL_BASE_URL_ENV_VAR] ??
		(storedProviderMatchesRoute ? tokens.modelBaseUrl : undefined);
	const fallbackProvider =
		process.env[MODEL_FALLBACK_PROVIDER_ENV_VAR] ??
		tokens.modelFallbackProvider;
	let fallbackRef: string | undefined;
	if (fallbackProvider) {
		const fallbackModelId =
			process.env[MODEL_FALLBACK_MODEL_ID_ENV_VAR] ??
			(process.env[MODEL_FALLBACK_PROVIDER_ENV_VAR]
				? undefined
				: tokens.modelFallbackModelId) ??
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
		fallback: fallbackRef,
		source: {
			kind: sourceKind,
			envOverrides,
		},
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
		if (workerModel && workerModel !== defaultModel)
			lines.push(`    worker:  ${workerModel}`);
		if (monitorModel && monitorModel !== defaultModel)
			lines.push(`    monitor: ${monitorModel}`);
		if (credentialEnv) lines.push(`    key env: ${credentialEnv}`);
	}
	lines.push(chalk.dim(""));
	lines.push(
		chalk.dim(
			"Custom/self-hosted providers are allowed with provider/model refs.",
		),
	);
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
