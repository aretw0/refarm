import { Command } from "commander";
import chalk from "chalk";
import { SiloCore } from "@refarm.dev/silo";
import {
	defaultProviderModelRef,
	defaultModelForProvider,
	defaultModelForScope,
	defaultScopedModelRef,
	formatModelRef,
	isModelScope,
	type ModelScope,
	parseModelRef,
} from "../model-routing.js";

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");
const OPENAI_WORKER_REF = defaultScopedModelRef("worker", "openai");
const ANTHROPIC_DEFAULT_REF = defaultProviderModelRef("anthropic");
const OLLAMA_DEFAULT_REF = defaultProviderModelRef("ollama");

export interface ModelTokens {
	modelProvider?: string;
	modelId?: string;
	modelRoutes?: Partial<Record<ModelScope, string>>;
	model?: string;
	oauthProvider?: string;
}

export interface ModelCommandDeps {
	loadTokens(): Promise<ModelTokens>;
	saveTokens(tokens: {
		modelProvider: string;
		modelId: string;
		modelRoutes?: Partial<Record<ModelScope, string>>;
	}): Promise<unknown>;
}

export function defaultModelDeps(): ModelCommandDeps {
	const silo = new SiloCore();
	return {
		loadTokens: () => silo.loadTokens() as Promise<ModelTokens>,
		saveTokens: (tokens) => silo.saveTokens(tokens),
	};
}

export function printCurrentModel(tokens: ModelTokens): void {
	const provider = process.env.MODEL_PROVIDER ?? tokens.modelProvider;
	const modelId = process.env.MODEL_ID ?? tokens.modelId ?? tokens.model;
	const resolvedModel = modelId ?? defaultModelForProvider(provider);
	const ref = formatModelRef(provider, resolvedModel);

	console.log(chalk.bold("Model routing"));
	console.log(`  current: ${chalk.cyan(ref)}`);
	if (provider) console.log(`  provider: ${provider}`);
	if (resolvedModel) console.log(`  model:    ${resolvedModel}`);
	const workerRoute =
		tokens.modelRoutes?.worker ??
		(provider ? formatModelRef(provider, defaultModelForScope(provider, "worker")) : undefined);
	if (workerRoute) console.log(`  worker:   ${workerRoute}`);
	if (process.env.MODEL_PROVIDER || process.env.MODEL_ID) {
		console.log(chalk.dim("  source:   environment overrides are active"));
	} else if (tokens.modelProvider || tokens.modelId || tokens.model) {
		console.log(chalk.dim("  source:   ~/.refarm/identity.json"));
	} else {
		console.log(chalk.dim("  source:   built-in defaults"));
		console.log(chalk.dim(`  openai default: ${OPENAI_DEFAULT_REF}`));
		console.log(chalk.dim(`  openai worker:  ${OPENAI_WORKER_REF}`));
		console.log(chalk.dim(`  set one:        refarm model ${OPENAI_DEFAULT_REF}`));
		console.log(chalk.dim("  login:          refarm sow"));
	}
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

export function createModelCommand(deps: ModelCommandDeps = defaultModelDeps()): Command {
	const command = new Command("model")
		.description("Inspect and change the active model route")
		.argument("[ref]", "provider/model, or model for the current provider")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm model current
  $ refarm model ${OPENAI_DEFAULT_REF}
  $ refarm model set ${OPENAI_DEFAULT_REF}
  $ refarm model set --scope worker ${OPENAI_WORKER_REF}
  $ refarm model set ${ANTHROPIC_DEFAULT_REF}
  $ refarm model set ${OLLAMA_DEFAULT_REF}

Notes:
  Model routes are saved in ~/.refarm/identity.json. The Refarm runtime reloads
  them before each task, so the next ask/chat turn or worker task uses the new route.
  For OpenAI workers, the default scoped route is ${OPENAI_WORKER_REF}.
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
		.command("set")
		.description("Set the default model route")
		.argument("<ref>", "provider/model, or model for the current provider")
		.option("--scope <scope>", "Route scope: default, worker, or monitor", "default")
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
