import {
	modelCredentialEnvKey,
	modelCredentialStatus as resolveModelCredentialStatus,
} from "@refarm.dev/config";
import { isContainer as detectContainerRuntime } from "@refarm.dev/root";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import {
	DEFAULT_MODEL_PROVIDER,
	defaultModelForProvider,
	defaultModelForScope,
	defaultProviderModelRef,
	defaultScopedModelRef,
	effectiveModelRouteForScope,
	formatModelRef,
	MODEL_BASE_URL_ENV_VAR,
	MODEL_DEFAULT_PROVIDER_ENV_VAR,
	MODEL_FALLBACK_MODEL_ID_ENV_VAR,
	MODEL_FALLBACK_PROVIDER_ENV_VAR,
	MODEL_ID_ENV_VAR,
	MODEL_PROVIDER_ENV_VAR,
	MODEL_PROVIDERS,
	MODEL_RUNTIME_ENV_VARS,
	MODEL_SCOPES,
	modelRouteTokenUpdate,
	parseModelRef,
	parseModelScope,
	type ModelScope,
} from "../model-routing.js";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_DOCTOR_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPENAI_MODEL_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "./json-output.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
const OPENAI_MONITOR_REF = defaultScopedModelRef("monitor", "openai");
const ANTHROPIC_DEFAULT_REF = defaultProviderModelRef("anthropic");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");
const MODEL_SCOPE_HELP = MODEL_SCOPES.join(", ");
const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";
const OLLAMA_DOCKER_BASE_URL = "http://host.docker.internal:11434";
const MODEL_PROVIDER_PROBE_TIMEOUT_MS = 2_000;

interface JsonOptionCarrier {
	json?: boolean;
	opts?: () => { json?: boolean };
	parent?: {
		opts?: () => { json?: boolean };
	};
}

interface ModelRouteMutationResult {
	action: "set-route";
	scope: ModelScope;
	provider: string;
	modelId: string;
	ref: string;
}

interface ModelFallbackMutationResult {
	action: "set-fallback" | "disable-fallback";
	provider?: string;
	modelId?: string;
	ref?: string;
}

interface ModelBaseUrlMutationResult {
	action: "set-base-url" | "disable-base-url";
	baseUrl?: string;
}

interface ModelResetMutationResult {
	action: "reset-route";
	scope: ModelScope;
}

type ModelMutationResult =
	| ModelRouteMutationResult
	| ModelFallbackMutationResult
	| ModelBaseUrlMutationResult
	| ModelResetMutationResult;

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
	routeCredentials: Record<ModelScope, {
		provider: string | undefined;
		envKey: string | undefined;
		state: "not-required" | "env" | "silo-api-key" | "silo-oauth" | "missing";
		status: string | null;
	}>;
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

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function printModelEnvShell(tokens: ModelTokens): void {
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

	for (const [key, value] of entries) {
		console.log(`export ${key}=${shellQuote(value)}`);
	}
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

function hasJsonOption(
	options: JsonOptionCarrier,
	command?: JsonOptionCarrier,
): boolean {
	return (
		options.json === true ||
		options.opts?.().json === true ||
		options.parent?.opts?.().json === true ||
		command?.opts?.().json === true ||
		command?.parent?.opts?.().json === true
	);
}

function printModelMutationResult(result: ModelMutationResult): void {
	printJson(
		buildJsonSuccessEnvelope({
			command: "model",
			operation: "mutate",
			extra: result,
			nextCommand: MODEL_CURRENT_JSON_COMMAND,
			nextCommands: [MODEL_CURRENT_JSON_COMMAND],
		}),
	);
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function localhostTargetsRuntime(baseUrl: string | undefined): boolean {
	if (!baseUrl) return true;
	const normalized = baseUrl.trim().toLowerCase();
	return normalized.includes("localhost") || normalized.includes("127.0.0.1");
}

function modelDoctorHandoffs(): ModelDoctorStatus["handoffs"] {
	return {
		inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
		startOllama: "ollama serve",
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
	return [
		{
			diagnostic: "model-provider-unreachable",
			severity: "failure",
			summary: "The current local model provider endpoint is not reachable from the runtime process.",
			action: "Start Ollama where Refarm can reach it, or set a base URL that matches the runtime network.",
			command: MODEL_DOCTOR_JSON_COMMAND,
		},
	];
}

async function probeOllamaProvider(
	baseUrl: string,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<ModelDoctorStatus["providerProbe"]> {
	const fetchImpl = deps.fetch ?? globalThis.fetch;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), MODEL_PROVIDER_PROBE_TIMEOUT_MS);
	const url = `${trimTrailingSlash(baseUrl)}/api/tags`;
	try {
		const response = await fetchImpl(url, {
			method: "GET",
			signal: controller.signal,
		});
		return {
			provider: "ollama",
			baseUrl,
			url,
			ready: response.ok,
			status: response.status,
		};
	} catch (error) {
		const name = error instanceof Error ? error.name : undefined;
		const cause = error instanceof Error ? error.cause : undefined;
		const causeRecord = cause && typeof cause === "object"
			? cause as Record<string, unknown>
			: undefined;
		const causeCode = typeof causeRecord?.code === "string" ? causeRecord.code : undefined;
		const message = error instanceof Error ? error.message : String(error);
		return {
			provider: "ollama",
			baseUrl,
			url,
			ready: false,
			error: causeCode ? `${message}: ${causeCode}` : message,
			timedOut: name === "AbortError",
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function buildModelDoctorStatus(
	tokens: ModelTokens,
	deps: Pick<ModelCommandDeps, "fetch" | "isContainer"> = {},
): Promise<ModelDoctorStatus> {
	const current = buildCurrentModelStatus(tokens);
	const handoffs = modelDoctorHandoffs();
	const container = deps.isContainer?.() ?? detectContainerRuntime();
	const probeEnvironment = {
		container,
		localhostTargetsRuntime: localhostTargetsRuntime(current.baseUrl),
		dockerHostBaseUrl: OLLAMA_DOCKER_BASE_URL,
	};
	const provider = current.current.provider?.trim().toLowerCase();
	if (provider !== "ollama") {
		return {
			current: current.current,
			providerProbe: {
				provider: current.current.provider,
				baseUrl: current.baseUrl,
				url: undefined,
				ready: null,
				skipped: true,
			},
			probeEnvironment,
			handoffs,
		};
	}

	const baseUrl = current.baseUrl ?? OLLAMA_DEFAULT_BASE_URL;
	const probe = await probeOllamaProvider(baseUrl, deps);
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

async function printModelDoctorJson(
	tokens: ModelTokens,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<void> {
	const status = await buildModelDoctorStatus(tokens, deps);
	printJson(
		buildJsonSuccessEnvelope({
			command: "model",
			operation: "doctor",
			extra: status,
			nextActions: modelDoctorRecoveryCommands(status),
			nextCommands: modelDoctorRecoveryCommands(status),
		}),
	);
}

async function printModelDoctor(
	tokens: ModelTokens,
	deps: Pick<ModelCommandDeps, "fetch">,
): Promise<void> {
	const status = await buildModelDoctorStatus(tokens, deps);
	console.log(chalk.bold("Model doctor"));
	console.log(`  current: ${chalk.cyan(status.current.ref)}`);
	if (status.providerProbe.skipped) {
		console.log("  provider probe: skipped");
		console.log(chalk.dim("  use --json for machine-readable handoffs"));
		return;
	}
	console.log(`  probe:   ${status.providerProbe.url}`);
	if (status.providerProbe.ready) {
		console.log(chalk.green(`  status:  ready (${status.providerProbe.status})`));
		return;
	}
	console.log(chalk.red("  status:  unreachable"));
	if (status.providerProbe.error) console.log(`  error:   ${status.providerProbe.error}`);
	for (const command of modelDoctorRecoveryCommands(status)) {
		console.log(chalk.dim(`  fix:     ${command}`));
	}
}

export function printCurrentModel(tokens: ModelTokens): void {
	const status = buildCurrentModelStatus(tokens);
	const provider = status.current.provider;
	const resolvedModel = status.current.modelId;

	console.log(chalk.bold("Model routing"));
	console.log(`  current: ${chalk.cyan(status.current.ref)}`);
	if (provider) console.log(`  provider: ${provider}`);
	if (resolvedModel) console.log(`  model:    ${resolvedModel}`);
	if (status.credential.envKey) console.log(`  key env:  ${status.credential.envKey}`);
	if (status.credential.status) console.log(`  key:      ${status.credential.status}`);
	if (status.baseUrl) console.log(`  base url: ${status.baseUrl}`);
	if (status.fallback) console.log(`  fallback: ${status.fallback}`);
	if (provider === "ollama") console.log(chalk.dim(`  doctor:   ${MODEL_DOCTOR_JSON_COMMAND}`));
	if (status.routes.worker) console.log(`  worker:   ${status.routes.worker}`);
	if (status.routes.monitor) console.log(`  monitor:  ${status.routes.monitor}`);
	for (const recommendation of status.recommendations ?? []) {
		console.log(chalk.yellow(`  warning: ${recommendation.summary}`));
		if (recommendation.command) {
			console.log(chalk.dim(`  fix:     ${recommendation.command}`));
		}
	}
	if (status.source.kind === "environment") {
		console.log(chalk.dim("  source:   environment overrides are active"));
		console.log(chalk.dim(`  env:      ${status.source.envOverrides.join(", ")}`));
	} else if (status.source.kind === "identity") {
		console.log(chalk.dim("  source:   ~/.refarm/identity.json"));
	} else {
		console.log(chalk.dim("  source:   built-in defaults"));
		console.log(chalk.dim(`  openai default: ${OPENAI_DEFAULT_REF}`));
		console.log(chalk.dim(`  openai worker:  ${OPENAI_WORKER_REF}`));
		console.log(chalk.dim(`  openai monitor: ${OPENAI_MONITOR_REF}`));
		console.log(chalk.dim(`  set one:        refarm model ${OPENAI_DEFAULT_REF}`));
		console.log(chalk.dim("  login:          refarm sow"));
	}
	if (provider && !status.credential.envKey && provider !== "ollama") {
		console.log(chalk.dim("  custom provider: set endpoint with refarm model base-url <url>"));
	}
}

export function printCurrentModelJson(tokens: ModelTokens): void {
	const status = buildCurrentModelStatus(tokens);
	printJson(
		buildJsonSuccessEnvelope({
			command: "model",
			operation: "current",
			extra: status,
			nextActions: currentModelNextActions(status),
			nextCommands: currentModelNextCommands(status),
		}),
	);
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
		if (credential.state !== "missing" && credential.state !== "silo-oauth") continue;
		const providerKey = credential.provider?.trim().toLowerCase() ?? scope;
		if (seenMissingProviders.has(providerKey)) continue;
		seenMissingProviders.add(providerKey);
		if (scope === "default") {
			commands.push(
				SOW_JSON_COMMAND,
				MODEL_PROVIDERS_JSON_COMMAND,
				refarmCommand(["sow", "--model", quoteCommandArg(status.current.ref), "--json"]),
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
	const recommendations: NonNullable<CurrentModelStatus["recommendations"]> = [];
	const seenMissingProviders = new Set<string>();
	const seenSubscriptionProviders = new Set<string>();
	for (const scope of MODEL_SCOPES) {
		const credential = status.routeCredentials[scope];
		if (credential.state === "silo-oauth") {
			const providerKey = credential.provider?.trim().toLowerCase() ?? scope;
			if (seenSubscriptionProviders.has(providerKey)) continue;
			seenSubscriptionProviders.add(providerKey);
			recommendations.push({
				diagnostic: scope === "default"
					? "model-subscription-runtime-unsupported"
					: `model-${scope}-subscription-runtime-unsupported`,
				severity: "warning",
				summary: `${scope === "default" ? "The current" : `The ${scope}`} model route uses subscription OAuth, which is stored for operator login but is not a runtime API credential yet.`,
				action: "Configure an API-key provider, use a local model route, or add a runtime adapter for the subscription provider.",
				command: scope === "default"
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
		setModel: refarmCommand(["model", quoteCommandArg(status.current.ref), "--json"]),
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

export function buildCurrentModelStatus(tokens: ModelTokens): CurrentModelStatus {
	const defaultRoute = effectiveModelRouteForScope(tokens, "default", { env: process.env });
	const provider = defaultRoute.provider ?? DEFAULT_MODEL_PROVIDER;
	const resolvedModel = defaultRoute.modelId ?? defaultModelForProvider(provider);
	const ref = formatModelRef(provider, resolvedModel);
	const routeProviderOverridden = Boolean(
		process.env[MODEL_PROVIDER_ENV_VAR] ?? process.env[MODEL_DEFAULT_PROVIDER_ENV_VAR],
	);
	const storedProviderMatchesRoute =
		!routeProviderOverridden ||
		tokens.modelProvider?.toLowerCase() === provider?.toLowerCase();

	const credentialEnv = modelCredentialEnvKey(provider);
	const credentialState = modelCredentialState(provider, tokens);
	const credentialStatus = modelCredentialStatus(provider, tokens);
	const baseUrl = process.env[MODEL_BASE_URL_ENV_VAR] ?? (storedProviderMatchesRoute ? tokens.modelBaseUrl : undefined);
	const fallbackProvider =
		process.env[MODEL_FALLBACK_PROVIDER_ENV_VAR] ?? tokens.modelFallbackProvider;
	let fallbackRef: string | undefined;
	if (fallbackProvider) {
		const fallbackModelId =
			process.env[MODEL_FALLBACK_MODEL_ID_ENV_VAR] ??
			(process.env[MODEL_FALLBACK_PROVIDER_ENV_VAR] ? undefined : tokens.modelFallbackModelId) ??
			defaultModelForProvider(fallbackProvider);
		fallbackRef = formatModelRef(
			fallbackProvider,
			fallbackModelId,
		);
	}
	const worker = effectiveModelRouteForScope(tokens, "worker", { env: process.env });
	const workerRoute = formatModelRef(worker.provider, worker.modelId);
	const monitor = effectiveModelRouteForScope(tokens, "monitor", { env: process.env });
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

function printModelValidationErrorJson(input: {
	error: string;
	message: string;
	nextCommand?: string;
	extra?: Record<string, unknown>;
}): void {
	const nextCommand = input.nextCommand ?? MODEL_CURRENT_JSON_COMMAND;
	printJson(
		buildJsonErrorEnvelope({
			command: "model",
			operation: "mutate",
			error: input.error,
			message: input.message,
			nextAction: nextCommand,
			nextCommand,
			nextCommands: [nextCommand, MODEL_PROVIDERS_JSON_COMMAND, LOCAL_MODEL_JSON_COMMAND],
			extra: input.extra,
		}),
	);
}

export function printKnownModelProviders(): void {
	console.log(chalk.bold("Known model providers"));
	for (const provider of buildKnownModelProviders()) {
		const { defaultModel, workerModel, monitorModel, credentialEnv } = provider;
		console.log(`  ${chalk.cyan(provider.provider)}`);
		if (defaultModel) console.log(`    default: ${defaultModel}`);
		if (workerModel && workerModel !== defaultModel) console.log(`    worker:  ${workerModel}`);
		if (monitorModel && monitorModel !== defaultModel) console.log(`    monitor: ${monitorModel}`);
		if (credentialEnv) console.log(`    key env: ${credentialEnv}`);
	}
	console.log(chalk.dim(""));
	console.log(chalk.dim("Custom/self-hosted providers are allowed with provider/model refs."));
	console.log(chalk.dim("Use refarm model base-url <url> when the provider does not have a built-in endpoint."));
}

export function printKnownModelProvidersJson(): void {
	printJson(
		buildJsonSuccessEnvelope({
			command: "model",
			operation: "providers",
			extra: { providers: buildKnownModelProviders() },
			nextCommand: MODEL_CURRENT_JSON_COMMAND,
			nextCommands: [MODEL_CURRENT_JSON_COMMAND],
		}),
	);
}

export async function setModelRoute(
	ref: string,
	scope: ModelScope,
	deps: ModelCommandDeps,
	options: { json?: boolean } = {},
): Promise<ModelRouteMutationResult | null> {
	const tokens = await deps.loadTokens();
	const parsed = parseModelRef(ref, tokens.modelProvider);
	if (!parsed) {
		if (options.json) {
			printModelValidationErrorJson({
				error: "empty-model-ref",
				message: "model ref cannot be empty.",
				nextCommand: LOCAL_MODEL_JSON_COMMAND,
				extra: { scope },
			});
			process.exitCode = 1;
			return null;
		}
		console.error(chalk.red("✗  model ref cannot be empty."));
		process.exitCode = 1;
		return null;
	}
	if (!parsed.provider) {
		if (options.json) {
			printModelValidationErrorJson({
				error: "model-provider-required",
				message: `Could not infer provider for model "${parsed.modelId}".`,
				nextCommand: LOCAL_MODEL_JSON_COMMAND,
				extra: { scope, modelId: parsed.modelId },
			});
			process.exitCode = 1;
			return null;
		}
		console.error(chalk.red(`✗  Could not infer provider for model "${parsed.modelId}".`));
		console.error(chalk.dim(`   Use provider/model, for example: refarm model ${OLLAMA_DEFAULT_REF}`));
		process.exitCode = 1;
		return null;
	}

	const modelRef = { provider: parsed.provider, modelId: parsed.modelId };
	await deps.saveTokens(modelRouteTokenUpdate(scope, modelRef, tokens));
	const result: ModelRouteMutationResult = {
		action: "set-route",
		scope,
		provider: parsed.provider,
		modelId: parsed.modelId,
		ref: formatModelRef(parsed.provider, parsed.modelId),
	};
	if (options.json) {
		printModelMutationResult(result);
	} else {
		const label = scope === "default" ? "Default model" : `${scope} model`;
		console.log(chalk.green(`✓  ${label} set: ${result.ref}`));
	}
	return result;
}

export async function setFallbackModelRoute(
	ref: string,
	deps: ModelCommandDeps,
	options: { json?: boolean } = {},
): Promise<ModelFallbackMutationResult | null> {
	const tokens = await deps.loadTokens();
	if (ref.trim().toLowerCase() === "off") {
		await deps.saveTokens({
			modelFallbackProvider: undefined,
			modelFallbackModelId: undefined,
		});
		const result: ModelFallbackMutationResult = { action: "disable-fallback" };
		if (options.json) {
			printModelMutationResult(result);
		} else {
			console.log(chalk.green("✓  Fallback model disabled"));
		}
		return result;
	}
	const parsed = parseModelRef(ref, tokens.modelFallbackProvider ?? tokens.modelProvider);
	if (!parsed) {
		if (options.json) {
			printModelValidationErrorJson({
				error: "empty-fallback-model-ref",
				message: "fallback model ref cannot be empty.",
				nextCommand: LOCAL_MODEL_JSON_COMMAND,
			});
			process.exitCode = 1;
			return null;
		}
		console.error(chalk.red("✗  fallback model ref cannot be empty."));
		process.exitCode = 1;
		return null;
	}
	if (!parsed.provider) {
		if (options.json) {
			printModelValidationErrorJson({
				error: "fallback-model-provider-required",
				message: `Could not infer provider for fallback model "${parsed.modelId}".`,
				nextCommand: LOCAL_MODEL_JSON_COMMAND,
				extra: { modelId: parsed.modelId },
			});
			process.exitCode = 1;
			return null;
		}
		console.error(chalk.red(`✗  Could not infer provider for fallback model "${parsed.modelId}".`));
		console.error(chalk.dim(`   Use provider/model, for example: refarm model fallback ${OLLAMA_DEFAULT_REF}`));
		process.exitCode = 1;
		return null;
	}

	await deps.saveTokens({
		modelFallbackProvider: parsed.provider,
		modelFallbackModelId: parsed.modelId,
	});
	const result: ModelFallbackMutationResult = {
		action: "set-fallback",
		provider: parsed.provider,
		modelId: parsed.modelId,
		ref: formatModelRef(parsed.provider, parsed.modelId),
	};
	if (options.json) {
		printModelMutationResult(result);
	} else {
		console.log(chalk.green(`✓  Fallback model set: ${result.ref}`));
	}
	return result;
}

export async function resetScopedModelRoute(
	scope: ModelScope,
	deps: ModelCommandDeps,
	options: { json?: boolean } = {},
): Promise<ModelResetMutationResult | null> {
	if (scope === "default") {
		if (options.json) {
			printModelValidationErrorJson({
				error: "default-route-reset-not-supported",
				message: "Default route reset is explicit: set the desired provider/model.",
				nextCommand: OPENAI_MODEL_JSON_COMMAND,
			});
			process.exitCode = 1;
			return null;
		}
		console.error(chalk.red("✗  Default route reset is explicit: set the desired provider/model."));
		console.error(chalk.dim(`   Example: refarm model ${OPENAI_DEFAULT_REF}`));
		process.exitCode = 1;
		return null;
	}

	const tokens = await deps.loadTokens();
	const routes =
		tokens.modelRoutes && typeof tokens.modelRoutes === "object" && !Array.isArray(tokens.modelRoutes)
			? { ...tokens.modelRoutes }
			: {};
	delete routes[scope];
	await deps.saveTokens({ modelRoutes: routes });
	const result: ModelResetMutationResult = { action: "reset-route", scope };
	if (options.json) {
		printModelMutationResult(result);
	} else {
		console.log(chalk.green(`✓  ${scope} model reset to built-in default`));
	}
	return result;
}

export async function setModelBaseUrl(
	value: string,
	deps: ModelCommandDeps,
	options: { json?: boolean } = {},
): Promise<ModelBaseUrlMutationResult | null> {
	const trimmed = value.trim();
	if (trimmed.toLowerCase() === "off") {
		await deps.saveTokens({ modelBaseUrl: undefined });
		const result: ModelBaseUrlMutationResult = { action: "disable-base-url" };
		if (options.json) {
			printModelMutationResult(result);
		} else {
			console.log(chalk.green("✓  Model base URL disabled"));
		}
		return result;
	}
	if (!trimmed) {
		if (options.json) {
			printModelValidationErrorJson({
				error: "empty-model-base-url",
				message: "base URL cannot be empty.",
				nextCommand: MODEL_CURRENT_JSON_COMMAND,
			});
			process.exitCode = 1;
			return null;
		}
		console.error(chalk.red("✗  base URL cannot be empty."));
		process.exitCode = 1;
		return null;
	}
	await deps.saveTokens({ modelBaseUrl: trimmed });
	const result: ModelBaseUrlMutationResult = {
		action: "set-base-url",
		baseUrl: trimmed,
	};
	if (options.json) {
		printModelMutationResult(result);
	} else {
		console.log(chalk.green(`✓  Model base URL set: ${trimmed}`));
	}
	return result;
}

export function createModelCommand(deps: ModelCommandDeps = defaultModelDeps()): Command {
	const command = new Command("model")
		.description("Inspect and change the active model route")
		.argument("[ref]", "provider/model, or model for the current provider")
		.option("--json", "Output machine-readable current route or mutation result")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model current
  $ refarm model current --json
  $ refarm model doctor --json
  $ refarm model ${OPENAI_DEFAULT_REF} --json
  $ refarm model providers
  $ refarm model providers --json
  $ refarm model ${OPENAI_DEFAULT_REF}
  $ refarm model set ${OPENAI_DEFAULT_REF}
  $ refarm model set ${OPENAI_DEFAULT_REF} --json
  $ refarm model set --scope worker ${OPENAI_WORKER_REF}
  $ refarm model set --scope monitor ${OPENAI_MONITOR_REF}
  $ refarm model reset --scope worker
  $ refarm model base-url http://127.0.0.1:8000
  $ refarm model fallback ${OLLAMA_DEFAULT_REF}
  $ refarm model set ${ANTHROPIC_DEFAULT_REF}
  $ refarm model set ${OLLAMA_DEFAULT_REF}

Notes:
  Model routes are saved in ~/.refarm/identity.json. The Refarm runtime reloads
  them before each task, so the next ask/chat turn or worker task uses the new route.
  ${MODEL_PROVIDER_ENV_VAR}, ${MODEL_ID_ENV_VAR}, and ${MODEL_BASE_URL_ENV_VAR} can override the primary route
  for one command without changing persisted config.
  ${MODEL_FALLBACK_PROVIDER_ENV_VAR} can retry a different provider when the primary fails.
  ${MODEL_FALLBACK_MODEL_ID_ENV_VAR} can override that fallback provider's default model.
  For OpenAI workers, the default scoped route is ${OPENAI_WORKER_REF}.
  For OpenAI monitors, the default scoped route is ${OPENAI_MONITOR_REF}.
`,
		)
		.action(
			async (
				ref: string | undefined,
				opts: JsonOptionCarrier,
				command: JsonOptionCarrier,
			) => {
				if (!ref) {
					const tokens = await deps.loadTokens();
					if (hasJsonOption(opts, command)) {
						printCurrentModelJson(tokens);
						return;
					}
					printCurrentModel(tokens);
					return;
				}
				await setModelRoute(ref, "default", deps, {
					json: hasJsonOption(opts, command),
				});
			},
		);

	command
		.command("current")
		.description("Show the currently configured provider/model")
		.option("--json", "Output machine-readable route metadata")
		.action(async (opts: JsonOptionCarrier, command: JsonOptionCarrier) => {
			const tokens = await deps.loadTokens();
			if (hasJsonOption(opts, command)) {
				printCurrentModelJson(tokens);
				return;
			}
			printCurrentModel(tokens);
		});

	command
		.command("doctor")
		.description("Probe the active local model provider endpoint")
		.option("--json", "Output machine-readable provider readiness")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model doctor
  $ refarm model doctor --json

Notes:
  The doctor only performs a live endpoint probe for local providers such as
  Ollama. Remote provider credentials remain covered by refarm model current.
`,
		)
		.action(async (opts: JsonOptionCarrier, command: JsonOptionCarrier) => {
			const tokens = await deps.loadTokens();
			if (hasJsonOption(opts, command)) {
				await printModelDoctorJson(tokens, deps);
				return;
			}
			await printModelDoctor(tokens, deps);
		});

	command
		.command("providers")
		.description("List known provider defaults and credential environment variables")
		.option("--json", "Output machine-readable provider defaults")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model providers
  $ refarm model providers --json
  $ refarm sow --model ${OPENAI_DEFAULT_REF}
  $ refarm model set --scope worker ${OPENAI_WORKER_REF}

Notes:
  This lists built-in defaults only. You can still use custom providers by
  passing provider/model and setting refarm model base-url for OpenAI-compatible APIs.
`,
		)
		.action((opts: JsonOptionCarrier, command: JsonOptionCarrier) => {
			if (hasJsonOption(opts, command)) {
				printKnownModelProvidersJson();
				return;
			}
			printKnownModelProviders();
		});

	command
		.command("env")
		.description("Print shell exports for the current model runtime")
		.option("--shell", "Output POSIX shell export statements")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model env --shell
  $ eval "$(refarm model env --shell)"

Notes:
  This command is intended for runtime launch scripts. It prints only model
  routing variables and the current provider credential when available from
  Silo. It does not call the model provider.
`,
		)
		.action(async (opts: { shell?: boolean }) => {
			const tokens = await deps.loadTokens();
			if (!opts.shell) {
				console.log("Use --shell to print model runtime exports.");
				return;
			}
			printModelEnvShell(tokens);
		});

	command
		.command("fallback")
		.description("Set or disable the persisted fallback model route")
		.argument("<ref>", "provider/model, model for current fallback provider, or off")
		.option("--json", "Output machine-readable fallback update")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model fallback ${OLLAMA_DEFAULT_REF}
  $ refarm model fallback ollama/qwen2.5-coder
  $ refarm model fallback off

Notes:
  The fallback route is saved in ~/.refarm/identity.json and injected by
  farmhand as ${MODEL_FALLBACK_PROVIDER_ENV_VAR} and ${MODEL_FALLBACK_MODEL_ID_ENV_VAR}. Environment
  variables still take precedence for one-off operator overrides.
`,
		)
		.action(
			async (
				ref: string,
				opts: JsonOptionCarrier,
				command: JsonOptionCarrier,
			) => {
				await setFallbackModelRoute(ref, deps, {
					json: hasJsonOption(opts, command),
				});
			},
		);

	command
		.command("reset")
		.description("Reset a scoped model route to its built-in default")
		.option("--scope <scope>", `Scoped route to reset: worker, monitor`, "worker")
		.option("--json", "Output machine-readable reset result")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model reset --scope worker
  $ refarm model reset --scope monitor

Notes:
  This removes the persisted scoped route from ~/.refarm/identity.json. The next
  ask/chat turn or worker task falls back to the provider's built-in scoped
  default. To change the default route, run refarm model <provider/model>.
`,
		)
		.action(
			async (
				opts: { scope?: string } & JsonOptionCarrier,
				command: JsonOptionCarrier,
			) => {
				const scope = parseModelScope(opts.scope);
				if (!scope) {
					if (hasJsonOption(opts, command)) {
						printModelValidationErrorJson({
							error: "unknown-model-scope",
							message: `Unknown model scope: ${opts.scope ?? ""}`,
							nextCommand: MODEL_CURRENT_JSON_COMMAND,
							extra: {
								scope: opts.scope ?? "",
								allowedScopes: MODEL_SCOPES,
							},
						});
						process.exitCode = 1;
						return;
					}
					console.error(chalk.red(`✗  Unknown model scope: ${opts.scope ?? ""}`));
					console.error(chalk.dim("   Use: worker, monitor"));
					process.exitCode = 1;
					return;
				}
				await resetScopedModelRoute(scope, deps, {
					json: hasJsonOption(opts, command),
				});
			},
		);

	command
		.command("base-url")
		.description("Set or disable the persisted OpenAI-compatible base URL")
		.argument("<url>", "Base URL for custom/self-hosted model providers, or off")
		.option("--json", "Output machine-readable base URL update")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model base-url http://127.0.0.1:8000
  $ refarm model base-url https://models.example.com
  $ refarm model base-url off

Notes:
  The base URL is saved in ~/.refarm/identity.json and injected by farmhand as
  MODEL_BASE_URL. Environment variables still take precedence for one-off
  operator overrides.
`,
		)
		.action(
			async (
				url: string,
				opts: JsonOptionCarrier,
				command: JsonOptionCarrier,
			) => {
				await setModelBaseUrl(url, deps, {
					json: hasJsonOption(opts, command),
				});
			},
		);

	command
		.command("set")
		.description("Set the default model route")
		.argument("<ref>", "provider/model, or model for the current provider")
		.option("--scope <scope>", `Route scope: ${MODEL_SCOPE_HELP}`, "default")
		.option("--json", "Output machine-readable route update")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model set ${OPENAI_DEFAULT_REF}
  $ refarm model set --scope worker ${OPENAI_WORKER_REF}
  $ refarm model set --scope monitor ${OPENAI_MONITOR_REF}
  $ refarm model set ${ANTHROPIC_DEFAULT_REF}
  $ refarm model set ${OLLAMA_DEFAULT_REF}

Notes:
  Use provider/model for portable routes, including self-hosted or compat
  providers. If a default provider is already saved, you may pass only the
  provider-specific model id when it has no slash. Slash-bearing model ids
  should include their provider prefix, for example together/meta-llama/...
`,
		)
		.action(
			async (
				ref: string,
				opts: { scope?: string } & JsonOptionCarrier,
				command: JsonOptionCarrier,
			) => {
				const scope = parseModelScope(opts.scope);
				if (!scope) {
					if (hasJsonOption(opts, command)) {
						printModelValidationErrorJson({
							error: "unknown-model-scope",
							message: `Unknown model scope: ${opts.scope ?? ""}`,
							nextCommand: MODEL_CURRENT_JSON_COMMAND,
							extra: {
								scope: opts.scope ?? "",
								allowedScopes: MODEL_SCOPES,
							},
						});
						process.exitCode = 1;
						return;
					}
					console.error(chalk.red(`✗  Unknown model scope: ${opts.scope ?? ""}`));
					console.error(chalk.dim(`   Use: ${MODEL_SCOPE_HELP}`));
					process.exitCode = 1;
					return;
				}
				await setModelRoute(ref, scope, deps, {
					json: hasJsonOption(opts, command),
				});
			},
		);

	return command;
}

export const modelCommand = createModelCommand();
