import chalk from "chalk";
import inquirer from "inquirer";

const { Separator } = inquirer;
import type { CollectContext, CredentialProvider } from "./types.js";
import { secretInput } from "../prompts/secret-input.js";
import { anthropicOAuthProvider, openaiCodexOAuthProvider } from "./oauth/index.js";
import type { OAuthCredentials, OAuthProviderInterface } from "./oauth/index.js";

export interface ModelCredential {
	/** Provider id stored as MODEL_PROVIDER env var value. */
	provider: string;
	/** API key — null for Ollama. For OAuth providers: the access token. */
	apiKey: string | null;
	/** Present when provider used OAuth. Stored in Silo for refresh. */
	oauthCredentials?: OAuthCredentials;
}

// ── Subscription tier (OAuth PKCE, no API credits needed) ─────────────────────
const OAUTH_PROVIDERS: OAuthProviderInterface[] = [
	anthropicOAuthProvider,
	openaiCodexOAuthProvider,
];

// ── API key tier (paste + link) ───────────────────────────────────────────────
const API_KEY_PROVIDERS = [
	{ id: "anthropic",  label: "Anthropic API key",   envKey: "ANTHROPIC_API_KEY",  url: "https://console.anthropic.com/settings/keys" },
	{ id: "openai",     label: "OpenAI API key",       envKey: "OPENAI_API_KEY",     url: "https://platform.openai.com/api-keys" },
	{ id: "groq",       label: "Groq",                 envKey: "GROQ_API_KEY",       url: "https://console.groq.com/keys" },
	{ id: "mistral",    label: "Mistral",              envKey: "MISTRAL_API_KEY",    url: "https://console.mistral.ai/api-keys" },
	{ id: "gemini",     label: "Gemini (Google)",      envKey: "GEMINI_API_KEY",     url: "https://aistudio.google.com/app/apikey" },
	{ id: "xai",        label: "xAI / Grok",           envKey: "XAI_API_KEY",        url: "https://console.x.ai" },
	{ id: "deepseek",   label: "DeepSeek",             envKey: "DEEPSEEK_API_KEY",   url: "https://platform.deepseek.com/api_keys" },
	{ id: "together",   label: "Together AI",          envKey: "TOGETHER_API_KEY",   url: "https://api.together.xyz/settings/api-keys" },
	{ id: "openrouter", label: "OpenRouter",           envKey: "OPENROUTER_API_KEY", url: "https://openrouter.ai/keys" },
] as const;

type ApiKeyProviderId = typeof API_KEY_PROVIDERS[number]["id"];

async function runOAuthFlow(
	ctx: CollectContext,
	provider: OAuthProviderInterface,
): Promise<ModelCredential> {
	const creds = await provider.login({
		onAuth: ({ url, instructions }) => {
			console.log(chalk.dim(`\n  ${instructions ?? "Complete login in your browser."}`));
			console.log(chalk.cyan(`  → ${url}\n`));
			ctx.tryOpenUrl(url);
		},
		onPrompt: async ({ message }) => {
			const { code } = await inquirer.prompt<{ code: string }>([
				{ type: "input", name: "code", message },
			]);
			return code;
		},
		onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
	});
	console.log(chalk.green(`  ✓ ${provider.name} — authenticated`));
	return { provider: provider.id, apiKey: provider.getApiKey(creds), oauthCredentials: creds };
}

async function runApiKeyFlow(ctx: CollectContext, p: typeof API_KEY_PROVIDERS[number]): Promise<ModelCredential> {
	console.log(chalk.cyan(`\n  Get your key at: ${p.url}`));
	ctx.tryOpenUrl(p.url);
	const apiKey = await secretInput({ message: "Paste your API key:" });
	const tail = apiKey.slice(-6);
	console.log(chalk.green(`  ✓ ${p.label} — key saved (...${tail})`));
	return { provider: p.id, apiKey };
}

export const modelCredentialProvider: CredentialProvider & {
	collectModel(ctx: CollectContext): Promise<ModelCredential>;
} = {
	id: "model",
	label: "Model Provider",

	async collectModel(ctx: CollectContext): Promise<ModelCredential> {
		console.log(chalk.bold("\n  Model Provider"));
		console.log(chalk.gray("  Choose how to connect to an AI model.\n"));

		type Choice =
			| { kind: "oauth"; id: string }
			| { kind: "api"; id: ApiKeyProviderId }
			| { kind: "ollama" };

		const choices = [
			new Separator("── Subscription (your existing account) ──"),
			...OAUTH_PROVIDERS.map((p) => ({
				name: `${p.name}  ${chalk.dim("[login — no API credits needed]")}`,
				value: { kind: "oauth" as const, id: p.id },
			})),
			new Separator("── Pay-per-use API key ──"),
			...API_KEY_PROVIDERS.map((p) => ({
				name: p.label,
				value: { kind: "api" as const, id: p.id },
			})),
			new Separator("── Local ──"),
			{ name: "Ollama  (no key required)", value: { kind: "ollama" as const } },
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { choice } = await (inquirer.prompt as any)([
			{ type: "select", name: "choice", message: "Select provider:", choices, pageSize: 16 },
		]) as { choice: Choice };

		if (choice.kind === "ollama") {
			console.log(chalk.green("  ✓ Ollama selected — make sure Ollama is running: ollama serve"));
			return { provider: "ollama", apiKey: null };
		}

		if (choice.kind === "oauth") {
			const provider = OAUTH_PROVIDERS.find((p) => p.id === choice.id)!;
			return runOAuthFlow(ctx, provider);
		}

		const p = API_KEY_PROVIDERS.find((x) => x.id === choice.id)!;
		return runApiKeyFlow(ctx, p);
	},

	async collect(ctx: CollectContext): Promise<string> {
		const { apiKey } = await this.collectModel(ctx);
		return apiKey ?? "";
	},
};

/** Map from OAuth provider id → Silo modelProvider id used by pi-agent/farmhand. */
export const OAUTH_PROVIDER_TO_MODEL_PROVIDER: Record<string, string> = {
	"anthropic": "anthropic",
	"openai-codex": "openai",
};
