import {
	modelCredentialEnvKey,
	modelCredentialStatus as resolveModelCredentialStatus,
} from "@refarm.dev/config";
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
	MODEL_PROVIDERS,
	MODEL_SCOPES,
	modelRouteTokenUpdate,
	parseModelRef,
	parseModelScope,
	type ModelScope,
} from "../model-routing.js";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import { buildJsonSuccessEnvelope, printJson } from "./json-output.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
const OPENAI_MONITOR_REF = defaultScopedModelRef("monitor", "openai");
const ANTHROPIC_DEFAULT_REF = defaultProviderModelRef("anthropic");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");
const MODEL_CURRENT_JSON_COMMAND = "refarm model current --json";
const MODEL_SCOPE_HELP = MODEL_SCOPES.join(", ");

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
		status: string | null;
	};
	baseUrl: string | undefined;
	fallback: string | undefined;
	source: {
		kind: "environment" | "identity" | "built-in";
		envOverrides: string[];
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

function hasPersistedModelRoutes(tokens: ModelTokens): boolean {
	return Boolean(
		tokens.modelRoutes &&
		typeof tokens.modelRoutes === "object" &&
		Object.keys(tokens.modelRoutes).length > 0,
	);
}

function activeModelEnvOverrides(): string[] {
	return [
		"MODEL_PROVIDER",
		"MODEL_DEFAULT_PROVIDER",
		"MODEL_ID",
		"MODEL_BASE_URL",
		"MODEL_FALLBACK_PROVIDER",
		"MODEL_FALLBACK_MODEL_ID",
	].filter((name) => Boolean(process.env[name]));
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
			extra: result,
			nextCommand: MODEL_CURRENT_JSON_COMMAND,
			nextCommands: [MODEL_CURRENT_JSON_COMMAND],
		}),
	);
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
	if (status.routes.worker) console.log(`  worker:   ${status.routes.worker}`);
	if (status.routes.monitor) console.log(`  monitor:  ${status.routes.monitor}`);
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
			extra: status,
			nextCommands: currentModelNextCommands(status),
		}),
	);
}

function currentModelNextCommands(status: CurrentModelStatus): string[] {
	if (status.credential.status?.startsWith("missing")) {
		return [
			"refarm sow --json",
			"refarm model providers --json",
			refarmCommand(["sow", "--model", quoteCommandArg(status.current.ref), "--json"]),
		];
	}
	return [];
}

export function buildCurrentModelStatus(tokens: ModelTokens): CurrentModelStatus {
	const defaultRoute = effectiveModelRouteForScope(tokens, "default", { env: process.env });
	const provider = defaultRoute.provider ?? DEFAULT_MODEL_PROVIDER;
	const resolvedModel = defaultRoute.modelId ?? defaultModelForProvider(provider);
	const ref = formatModelRef(provider, resolvedModel);
	const routeProviderOverridden = Boolean(process.env.MODEL_PROVIDER ?? process.env.MODEL_DEFAULT_PROVIDER);
	const storedProviderMatchesRoute =
		!routeProviderOverridden ||
		tokens.modelProvider?.toLowerCase() === provider?.toLowerCase();

	const credentialEnv = modelCredentialEnvKey(provider);
	const credentialStatus = modelCredentialStatus(provider, tokens);
	const baseUrl = process.env.MODEL_BASE_URL ?? (storedProviderMatchesRoute ? tokens.modelBaseUrl : undefined);
	const fallbackProvider =
		process.env.MODEL_FALLBACK_PROVIDER ?? tokens.modelFallbackProvider;
	let fallbackRef: string | undefined;
	if (fallbackProvider) {
		const fallbackModelId =
			process.env.MODEL_FALLBACK_MODEL_ID ??
			(process.env.MODEL_FALLBACK_PROVIDER ? undefined : tokens.modelFallbackModelId) ??
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

	return {
		current: { provider, modelId: resolvedModel, ref },
		routes: {
			default: ref,
			worker: workerRoute,
			monitor: monitorRoute,
		},
		credential: {
			envKey: credentialEnv,
			status: credentialStatus,
		},
		baseUrl,
		fallback: fallbackRef,
		source: {
			kind: sourceKind,
			envOverrides,
		},
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
		console.error(chalk.red("✗  model ref cannot be empty."));
		process.exitCode = 1;
		return null;
	}
	if (!parsed.provider) {
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
		console.error(chalk.red("✗  fallback model ref cannot be empty."));
		process.exitCode = 1;
		return null;
	}
	if (!parsed.provider) {
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
  MODEL_PROVIDER, MODEL_ID, and MODEL_BASE_URL can override the primary route
  for one command without changing persisted config.
  MODEL_FALLBACK_PROVIDER can retry a different provider when the primary fails.
  MODEL_FALLBACK_MODEL_ID can override that fallback provider's default model.
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
  farmhand as MODEL_FALLBACK_PROVIDER and MODEL_FALLBACK_MODEL_ID. Environment
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
