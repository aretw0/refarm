import { Command } from "commander";
import chalk from "chalk";
import { SiloCore } from "@refarm.dev/silo";
import {
	modelCredentialEnvKey,
	modelCredentialStatus as resolveModelCredentialStatus,
} from "@refarm.dev/config";
import {
	DEFAULT_MODEL_PROVIDER,
	defaultProviderModelRef,
	defaultModelForProvider,
	defaultModelForScope,
	defaultScopedModelRef,
	effectiveModelRouteForScope,
	formatModelRef,
	MODEL_SCOPES,
	MODEL_PROVIDERS,
	type ModelScope,
	modelRouteTokenUpdate,
	parseModelScope,
	parseModelRef,
} from "../model-routing.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
const OPENAI_MONITOR_REF = defaultScopedModelRef("monitor", "openai");
const ANTHROPIC_DEFAULT_REF = defaultProviderModelRef("anthropic");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");
const MODEL_SCOPE_HELP = MODEL_SCOPES.join(", ");

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

export function printCurrentModel(tokens: ModelTokens): void {
	const defaultRoute = effectiveModelRouteForScope(tokens, "default", { env: process.env });
	const provider = defaultRoute.provider ?? DEFAULT_MODEL_PROVIDER;
	const resolvedModel = defaultRoute.modelId ?? defaultModelForProvider(provider);
	const ref = formatModelRef(provider, resolvedModel);
	const routeProviderOverridden = Boolean(process.env.MODEL_PROVIDER ?? process.env.MODEL_DEFAULT_PROVIDER);
	const storedProviderMatchesRoute =
		!routeProviderOverridden ||
		tokens.modelProvider?.toLowerCase() === provider?.toLowerCase();

	console.log(chalk.bold("Model routing"));
	console.log(`  current: ${chalk.cyan(ref)}`);
	if (provider) console.log(`  provider: ${provider}`);
	if (resolvedModel) console.log(`  model:    ${resolvedModel}`);
	const credentialEnv = modelCredentialEnvKey(provider);
	if (credentialEnv) console.log(`  key env:  ${credentialEnv}`);
	const credentialStatus = modelCredentialStatus(provider, tokens);
	if (credentialStatus) console.log(`  key:      ${credentialStatus}`);
	const baseUrl = process.env.MODEL_BASE_URL ?? (storedProviderMatchesRoute ? tokens.modelBaseUrl : undefined);
	if (baseUrl) console.log(`  base url: ${baseUrl}`);
	const fallbackProvider =
		process.env.MODEL_FALLBACK_PROVIDER ?? tokens.modelFallbackProvider;
	if (fallbackProvider) {
		const fallbackModelId =
			process.env.MODEL_FALLBACK_MODEL_ID ??
			(process.env.MODEL_FALLBACK_PROVIDER ? undefined : tokens.modelFallbackModelId) ??
			defaultModelForProvider(fallbackProvider);
		const fallbackRef = formatModelRef(
			fallbackProvider,
			fallbackModelId,
		);
		console.log(`  fallback: ${fallbackRef}`);
	}
	const worker = effectiveModelRouteForScope(tokens, "worker", { env: process.env });
	const workerRoute = formatModelRef(worker.provider, worker.modelId);
	if (workerRoute) console.log(`  worker:   ${workerRoute}`);
	const monitor = effectiveModelRouteForScope(tokens, "monitor", { env: process.env });
	const monitorRoute = formatModelRef(monitor.provider, monitor.modelId);
	if (monitorRoute) console.log(`  monitor:  ${monitorRoute}`);
	if (
		process.env.MODEL_PROVIDER ||
		process.env.MODEL_DEFAULT_PROVIDER ||
		process.env.MODEL_ID ||
		process.env.MODEL_BASE_URL ||
		process.env.MODEL_FALLBACK_PROVIDER ||
		process.env.MODEL_FALLBACK_MODEL_ID
	) {
		console.log(chalk.dim("  source:   environment overrides are active"));
	} else if (
		tokens.modelProvider ||
		tokens.modelId ||
		tokens.model ||
		tokens.modelBaseUrl ||
		tokens.modelFallbackProvider ||
		tokens.modelFallbackModelId ||
		hasPersistedModelRoutes(tokens)
	) {
		console.log(chalk.dim("  source:   ~/.refarm/identity.json"));
	} else {
		console.log(chalk.dim("  source:   built-in defaults"));
		console.log(chalk.dim(`  openai default: ${OPENAI_DEFAULT_REF}`));
		console.log(chalk.dim(`  openai worker:  ${OPENAI_WORKER_REF}`));
		console.log(chalk.dim(`  openai monitor: ${OPENAI_MONITOR_REF}`));
		console.log(chalk.dim(`  set one:        refarm model ${OPENAI_DEFAULT_REF}`));
		console.log(chalk.dim("  login:          refarm sow"));
	}
	if (provider && !credentialEnv && provider !== "ollama") {
		console.log(chalk.dim("  custom provider: set endpoint with refarm model base-url <url>"));
	}
}

export function printKnownModelProviders(): void {
	console.log(chalk.bold("Known model providers"));
	for (const provider of MODEL_PROVIDERS) {
		const defaultModel = defaultModelForProvider(provider);
		const workerModel = defaultModelForScope(provider, "worker");
		const monitorModel = defaultModelForScope(provider, "monitor");
		const credentialEnv = modelCredentialEnvKey(provider);
		console.log(`  ${chalk.cyan(provider)}`);
		if (defaultModel) console.log(`    default: ${defaultModel}`);
		if (workerModel && workerModel !== defaultModel) console.log(`    worker:  ${workerModel}`);
		if (monitorModel && monitorModel !== defaultModel) console.log(`    monitor: ${monitorModel}`);
		if (credentialEnv) console.log(`    key env: ${credentialEnv}`);
	}
	console.log(chalk.dim(""));
	console.log(chalk.dim("Custom/self-hosted providers are allowed with provider/model refs."));
	console.log(chalk.dim("Use refarm model base-url <url> when the provider does not have a built-in endpoint."));
}

export async function setModelRoute(
	ref: string,
	scope: ModelScope,
	deps: ModelCommandDeps,
): Promise<void> {
	const tokens = await deps.loadTokens();
	const parsed = parseModelRef(ref, tokens.modelProvider);
	if (!parsed) {
		console.error(chalk.red("✗  model ref cannot be empty."));
		process.exit(1);
	}
	if (!parsed.provider) {
		console.error(chalk.red(`✗  Could not infer provider for model "${parsed.modelId}".`));
		console.error(chalk.dim(`   Use provider/model, for example: refarm model ${OLLAMA_DEFAULT_REF}`));
		process.exit(1);
	}

	const modelRef = { provider: parsed.provider, modelId: parsed.modelId };
	await deps.saveTokens(modelRouteTokenUpdate(scope, modelRef, tokens));
	const label = scope === "default" ? "Default model" : `${scope} model`;
	console.log(chalk.green(`✓  ${label} set: ${parsed.provider}/${parsed.modelId}`));
}

export async function setFallbackModelRoute(
	ref: string,
	deps: ModelCommandDeps,
): Promise<void> {
	const tokens = await deps.loadTokens();
	if (ref.trim().toLowerCase() === "off") {
		await deps.saveTokens({
			modelFallbackProvider: undefined,
			modelFallbackModelId: undefined,
		});
		console.log(chalk.green("✓  Fallback model disabled"));
		return;
	}
	const parsed = parseModelRef(ref, tokens.modelFallbackProvider ?? tokens.modelProvider);
	if (!parsed) {
		console.error(chalk.red("✗  fallback model ref cannot be empty."));
		process.exit(1);
	}
	if (!parsed.provider) {
		console.error(chalk.red(`✗  Could not infer provider for fallback model "${parsed.modelId}".`));
		console.error(chalk.dim(`   Use provider/model, for example: refarm model fallback ${OLLAMA_DEFAULT_REF}`));
		process.exit(1);
	}

	await deps.saveTokens({
		modelFallbackProvider: parsed.provider,
		modelFallbackModelId: parsed.modelId,
	});
	console.log(chalk.green(`✓  Fallback model set: ${parsed.provider}/${parsed.modelId}`));
}

export async function resetScopedModelRoute(
	scope: ModelScope,
	deps: ModelCommandDeps,
): Promise<void> {
	if (scope === "default") {
		console.error(chalk.red("✗  Default route reset is explicit: set the desired provider/model."));
		console.error(chalk.dim(`   Example: refarm model ${OPENAI_DEFAULT_REF}`));
		process.exit(1);
	}

	const tokens = await deps.loadTokens();
	const routes =
		tokens.modelRoutes && typeof tokens.modelRoutes === "object" && !Array.isArray(tokens.modelRoutes)
			? { ...tokens.modelRoutes }
			: {};
	delete routes[scope];
	await deps.saveTokens({ modelRoutes: routes });
	console.log(chalk.green(`✓  ${scope} model reset to built-in default`));
}

export async function setModelBaseUrl(value: string, deps: ModelCommandDeps): Promise<void> {
	const trimmed = value.trim();
	if (trimmed.toLowerCase() === "off") {
		await deps.saveTokens({ modelBaseUrl: undefined });
		console.log(chalk.green("✓  Model base URL disabled"));
		return;
	}
	if (!trimmed) {
		console.error(chalk.red("✗  base URL cannot be empty."));
		process.exit(1);
	}
	await deps.saveTokens({ modelBaseUrl: trimmed });
	console.log(chalk.green(`✓  Model base URL set: ${trimmed}`));
}

export function createModelCommand(deps: ModelCommandDeps = defaultModelDeps()): Command {
	const command = new Command("model")
		.description("Inspect and change the active model route")
		.argument("[ref]", "provider/model, or model for the current provider")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model current
  $ refarm model providers
  $ refarm model ${OPENAI_DEFAULT_REF}
  $ refarm model set ${OPENAI_DEFAULT_REF}
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
  MODEL_FALLBACK_PROVIDER can retry a different provider when the primary fails.
  MODEL_FALLBACK_MODEL_ID can override that fallback provider's default model.
  For OpenAI workers, the default scoped route is ${OPENAI_WORKER_REF}.
  For OpenAI monitors, the default scoped route is ${OPENAI_MONITOR_REF}.
`,
		)
		.action(async (ref: string | undefined) => {
			if (!ref) {
				printCurrentModel(await deps.loadTokens());
				return;
			}
			await setModelRoute(ref, "default", deps);
		});

	command
		.command("current")
		.description("Show the currently configured provider/model")
		.action(async () => {
			printCurrentModel(await deps.loadTokens());
		});

	command
		.command("providers")
		.description("List known provider defaults and credential environment variables")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model providers
  $ refarm sow --model ${OPENAI_DEFAULT_REF}
  $ refarm model set --scope worker ${OPENAI_WORKER_REF}

Notes:
  This lists built-in defaults only. You can still use custom providers by
  passing provider/model and setting refarm model base-url for OpenAI-compatible APIs.
`,
		)
		.action(() => {
			printKnownModelProviders();
		});

	command
		.command("fallback")
		.description("Set or disable the persisted fallback model route")
		.argument("<ref>", "provider/model, model for current fallback provider, or off")
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
		.action(async (ref: string) => {
			await setFallbackModelRoute(ref, deps);
		});

	command
		.command("reset")
		.description("Reset a scoped model route to its built-in default")
		.option("--scope <scope>", `Scoped route to reset: worker, monitor`, "worker")
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
		.action(async (opts: { scope?: string }) => {
			const scope = parseModelScope(opts.scope);
			if (!scope) {
				console.error(chalk.red(`✗  Unknown model scope: ${opts.scope ?? ""}`));
				console.error(chalk.dim("   Use: worker, monitor"));
				process.exit(1);
			}
			await resetScopedModelRoute(scope, deps);
		});

	command
		.command("base-url")
		.description("Set or disable the persisted OpenAI-compatible base URL")
		.argument("<url>", "Base URL for custom/self-hosted model providers, or off")
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
		.action(async (url: string) => {
			await setModelBaseUrl(url, deps);
		});

	command
		.command("set")
		.description("Set the default model route")
		.argument("<ref>", "provider/model, or model for the current provider")
		.option("--scope <scope>", `Route scope: ${MODEL_SCOPE_HELP}`, "default")
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
		.action(async (ref: string, opts: { scope?: string }) => {
			const scope = parseModelScope(opts.scope);
			if (!scope) {
				console.error(chalk.red(`✗  Unknown model scope: ${opts.scope ?? ""}`));
				console.error(chalk.dim(`   Use: ${MODEL_SCOPE_HELP}`));
				process.exit(1);
			}
			await setModelRoute(ref, scope, deps);
		});

	return command;
}

export const modelCommand = createModelCommand();
