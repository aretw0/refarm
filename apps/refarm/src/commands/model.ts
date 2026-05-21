import { Command } from "commander";
import chalk from "chalk";
import { SiloCore } from "@refarm.dev/silo";
import { modelCredentialEnvKey } from "@refarm.dev/config";
import {
	defaultProviderModelRef,
	defaultModelForProvider,
	defaultModelForScope,
	defaultScopedModelRef,
	formatModelRef,
	isModelScope,
	MODEL_PROVIDERS,
	type ModelScope,
	parseModelRef,
} from "../model-routing.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
const OPENAI_MONITOR_REF = defaultScopedModelRef("monitor", "openai");
const ANTHROPIC_DEFAULT_REF = defaultProviderModelRef("anthropic");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");

export interface ModelTokens {
	modelProvider?: string;
	modelId?: string;
	modelRoutes?: Partial<Record<ModelScope, string>>;
	modelFallbackProvider?: string;
	modelFallbackModelId?: string;
	model?: string;
	oauthProvider?: string;
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

export function printCurrentModel(tokens: ModelTokens): void {
	const provider =
		process.env.MODEL_PROVIDER ?? process.env.MODEL_DEFAULT_PROVIDER ?? tokens.modelProvider;
	const modelId = process.env.MODEL_ID ?? tokens.modelId ?? tokens.model;
	const resolvedModel = modelId ?? defaultModelForProvider(provider);
	const ref = formatModelRef(provider, resolvedModel);

	console.log(chalk.bold("Model routing"));
	console.log(`  current: ${chalk.cyan(ref)}`);
	if (provider) console.log(`  provider: ${provider}`);
	if (resolvedModel) console.log(`  model:    ${resolvedModel}`);
	const credentialEnv = modelCredentialEnvKey(provider);
	if (credentialEnv) console.log(`  key env:  ${credentialEnv}`);
	if (process.env.MODEL_BASE_URL) console.log(`  base url: ${process.env.MODEL_BASE_URL}`);
	const fallbackProvider =
		process.env.MODEL_FALLBACK_PROVIDER ?? tokens.modelFallbackProvider;
	if (fallbackProvider) {
		const fallbackRef = formatModelRef(
			fallbackProvider,
			process.env.MODEL_FALLBACK_MODEL_ID ??
				tokens.modelFallbackModelId ??
				defaultModelForProvider(fallbackProvider),
		);
		console.log(`  fallback: ${fallbackRef}`);
	}
	const workerRoute =
		tokens.modelRoutes?.worker ??
		(provider ? formatModelRef(provider, defaultModelForScope(provider, "worker")) : undefined);
	if (workerRoute) console.log(`  worker:   ${workerRoute}`);
	const monitorRoute =
		tokens.modelRoutes?.monitor ??
		(provider ? formatModelRef(provider, defaultModelForScope(provider, "monitor")) : undefined);
	if (monitorRoute) console.log(`  monitor:  ${monitorRoute}`);
	if (process.env.MODEL_PROVIDER || process.env.MODEL_DEFAULT_PROVIDER || process.env.MODEL_ID) {
		console.log(chalk.dim("  source:   environment overrides are active"));
	} else if (
		tokens.modelProvider ||
		tokens.modelId ||
		tokens.model ||
		tokens.modelFallbackProvider ||
		tokens.modelFallbackModelId
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
		console.log(chalk.dim("  custom provider: set MODEL_BASE_URL for OpenAI-compatible APIs"));
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
	console.log(chalk.dim("Set MODEL_BASE_URL when the provider does not have a built-in endpoint."));
}

function scopedTokenUpdate(
	scope: ModelScope,
	provider: string,
	modelId: string,
	tokens: ModelTokens,
): { modelProvider: string; modelId: string; modelRoutes?: Partial<Record<ModelScope, string>> } {
	if (scope === "default") {
		return { modelProvider: provider, modelId };
	}
	return {
		modelProvider: tokens.modelProvider ?? provider,
		modelId: tokens.modelId ?? defaultModelForProvider(tokens.modelProvider ?? provider) ?? modelId,
		modelRoutes: {
			...(tokens.modelRoutes ?? {}),
			[scope]: `${provider}/${modelId}`,
		},
	};
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

	await deps.saveTokens(scopedTokenUpdate(scope, parsed.provider, parsed.modelId, tokens));
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
  passing provider/model and setting MODEL_BASE_URL for OpenAI-compatible APIs.
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
		.command("set")
		.description("Set the default model route")
		.argument("<ref>", "provider/model, or model for the current provider")
		.option("--scope <scope>", "Route scope: default, worker, or monitor", "default")
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
			if (!isModelScope(opts.scope)) {
				console.error(chalk.red(`✗  Unknown model scope: ${opts.scope ?? ""}`));
				console.error(chalk.dim("   Use: default, worker, or monitor"));
				process.exit(1);
			}
			await setModelRoute(ref, opts.scope, deps);
		});

	return command;
}

export const modelCommand = createModelCommand();
