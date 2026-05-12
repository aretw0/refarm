import chalk from "chalk";
import inquirer from "inquirer";
import type { CollectContext, CredentialProvider } from "./types.js";
import { secretInput } from "../prompts/secret-input.js";

export interface LlmCredential {
	provider: string;
	apiKey: string | null;
}

const PROVIDERS = [
	{ name: "Anthropic  (Claude)", value: "anthropic", keyUrl: "https://console.anthropic.com/settings/keys" },
	{ name: "OpenAI     (GPT-4o)", value: "openai", keyUrl: "https://platform.openai.com/api-keys" },
	{ name: "Groq       (fast inference)", value: "groq", keyUrl: "https://console.groq.com/keys" },
	{ name: "Mistral    (Le Chat)", value: "mistral", keyUrl: "https://console.mistral.ai/api-keys" },
	{ name: "Ollama     (local, no key needed)", value: "ollama", keyUrl: null },
];

export const llmCredentialProvider: CredentialProvider & {
	collectLlm(ctx: CollectContext): Promise<LlmCredential>;
} = {
	id: "llm",
	label: "LLM Provider",

	async collectLlm(ctx: CollectContext): Promise<LlmCredential> {
		console.log(chalk.bold("\n  LLM Provider"));
		console.log(chalk.gray("  Choose the model provider for refarm's AI agent.\n"));

		const { provider } = await inquirer.prompt<{ provider: string }>([
			{
				type: "list",
				name: "provider",
				message: "Select a provider:",
				choices: PROVIDERS.map((p) => ({ name: p.name, value: p.value })),
			},
		]);

		if (provider === "ollama") {
			console.log(chalk.green("  ✓ Ollama selected — no API key required"));
			console.log(chalk.gray("  Make sure Ollama is running: ollama serve"));
			return { provider, apiKey: null };
		}

		const found = PROVIDERS.find((p) => p.value === provider)!;
		console.log(chalk.cyan(`  → ${found.keyUrl}\n`));
		ctx.tryOpenUrl(found.keyUrl!);

		const apiKey = await secretInput({ message: "Paste your API key:" });
		const tail = apiKey.slice(-6);
		console.log(chalk.green(`  ✓ ${found.name.trim()} — key saved (...${tail})`));
		return { provider, apiKey };
	},

	async collect(ctx: CollectContext): Promise<string> {
		const { apiKey } = await this.collectLlm(ctx);
		return apiKey ?? "";
	},
};
