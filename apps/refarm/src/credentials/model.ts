import { modelCredentialEnvKey } from "@refarm.dev/config";
import { createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { isContainer } from "@refarm.dev/root";
import chalk from "chalk";
import type { OAuthCredentials, OAuthProviderInterface } from "./oauth/index.js";
import { anthropicOAuthProvider, openaiCodexOAuthProvider } from "./oauth/index.js";
import type { CollectContext, CredentialProvider } from "./types.js";

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
	openaiCodexOAuthProvider,
	anthropicOAuthProvider,
];

const DEVCONTAINER_CALLBACK_TIMEOUT_MS = 120_000;

function credentialEnvKey(provider: string): string {
	const envKey = modelCredentialEnvKey(provider);
	if (!envKey) throw new Error(`No credential env key registered for model provider "${provider}".`);
	return envKey;
}

// ── API key tier (paste + link) ───────────────────────────────────────────────
const API_KEY_PROVIDERS = [
	{ id: "openai",     label: "OpenAI API key",       envKey: credentialEnvKey("openai"),     url: "https://platform.openai.com/api-keys" },
	{ id: "anthropic",  label: "Anthropic API key",   envKey: credentialEnvKey("anthropic"),  url: "https://console.anthropic.com/settings/keys" },
	{ id: "groq",       label: "Groq",                 envKey: credentialEnvKey("groq"),       url: "https://console.groq.com/keys" },
	{ id: "mistral",    label: "Mistral",              envKey: credentialEnvKey("mistral"),    url: "https://console.mistral.ai/api-keys" },
	{ id: "gemini",     label: "Gemini (Google)",      envKey: credentialEnvKey("gemini"),     url: "https://aistudio.google.com/app/apikey" },
	{ id: "xai",        label: "xAI / Grok",           envKey: credentialEnvKey("xai"),        url: "https://console.x.ai" },
	{ id: "deepseek",   label: "DeepSeek",             envKey: credentialEnvKey("deepseek"),   url: "https://platform.deepseek.com/api_keys" },
	{ id: "together",   label: "Together AI",          envKey: credentialEnvKey("together"),   url: "https://api.together.xyz/settings/api-keys" },
	{ id: "openrouter", label: "OpenRouter",           envKey: credentialEnvKey("openrouter"), url: "https://openrouter.ai/keys" },
] as const;

type ApiKeyProviderId = typeof API_KEY_PROVIDERS[number]["id"];

type Choice =
	| { kind: "oauth"; id: string }
	| { kind: "api"; id: ApiKeyProviderId }
	| { kind: "ollama" };

const CHOICE_PREFIX = {
	oauth: "oauth:",
	api: "api:",
	ollama: "local:ollama",
} as const;

function encodeChoice(choice: Choice): string {
	if (choice.kind === "oauth") return `${CHOICE_PREFIX.oauth}${choice.id}`;
	if (choice.kind === "api") return `${CHOICE_PREFIX.api}${choice.id}`;
	return CHOICE_PREFIX.ollama;
}

function decodeChoice(value: string): Choice {
	if (value === CHOICE_PREFIX.ollama) return { kind: "ollama" };
	if (value.startsWith(CHOICE_PREFIX.oauth)) {
		return { kind: "oauth", id: value.slice(CHOICE_PREFIX.oauth.length) };
	}
	if (value.startsWith(CHOICE_PREFIX.api)) {
		return { kind: "api", id: value.slice(CHOICE_PREFIX.api.length) as ApiKeyProviderId };
	}
	throw new Error(`Unknown model provider choice "${value}".`);
}

function operator(ctx: CollectContext) {
	return ctx.operator ?? createStdioOperatorChannel();
}

async function promptCode(ctx: CollectContext, message: string): Promise<string> {
	return operator(ctx).ask({ type: "text", question: message });
}

async function runOAuthFlow(
	ctx: CollectContext,
	provider: OAuthProviderInterface,
): Promise<ModelCredential> {
	const containerEnv = isContainer();
	const hasPortForwarding =
		Boolean(process.env["VSCODE_REMOTE_CONTAINERS_SESSION"]) ||
		Boolean(process.env["REMOTE_CONTAINERS"]) ||
		Boolean(process.env["CODESPACES"]);
	const forceManual = process.env["REFARM_OAUTH_CALLBACK_MODE"] === "manual";
	const callbackCanReachBrowser =
		Boolean(provider.usesCallbackServer) && !forceManual && (!containerEnv || hasPortForwarding);
	const needsManualCode = Boolean(provider.usesCallbackServer) && !callbackCanReachBrowser;

	const creds = await provider.login({
		onAuth: ({ url, instructions }) => {
			console.log(chalk.dim(`\n  ${instructions ?? "Complete login in your browser."}`));
			console.log(chalk.cyan(`  → ${url}\n`));
			if (needsManualCode) {
				console.log(chalk.yellow("  ⚠  Running in a container — the browser redirect cannot reach this environment."));
				console.log(chalk.dim("     After logging in, copy the full redirect URL or authorization code and paste it below.\n"));
			} else if (containerEnv && provider.usesCallbackServer) {
				console.log(chalk.dim("     Devcontainer detected — VS Code should forward the callback port automatically."));
				console.log(chalk.dim("     If the browser does not return here, you will be prompted to paste the redirect URL.\n"));
			}
			ctx.tryOpenUrl(url);
		},
		onPrompt: async ({ message }) => promptCode(ctx, message),
		onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
		...(callbackCanReachBrowser && containerEnv ? {
			callbackTimeoutMs: DEVCONTAINER_CALLBACK_TIMEOUT_MS,
		} : {}),
		// In plain containers without a known port-forwarding bridge, the host
		// browser cannot reach the callback server, so prompt for the code.
		...(needsManualCode ? {
			skipCallbackServer: true,
			onManualCodeInput: () => promptCode(ctx, "Paste the redirect URL or authorization code:"),
		} : {}),
	});
	console.log(chalk.green(`  ✓ ${provider.name} — authenticated`));
	return { provider: provider.id, apiKey: provider.getApiKey(creds), oauthCredentials: creds };
}

async function runApiKeyFlow(ctx: CollectContext, p: typeof API_KEY_PROVIDERS[number]): Promise<ModelCredential> {
	console.log(chalk.cyan(`\n  Get your key at: ${p.url}`));
	ctx.tryOpenUrl(p.url);
	const apiKey = await operator(ctx).ask({
		type: "secret",
		question: "Paste your API key",
		visibleTail: 4,
	});
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

		const selected = await operator(ctx).ask({
			type: "select",
			question: "Select provider:",
			default: encodeChoice({ kind: "oauth", id: "openai-codex" }),
			options: [
				...OAUTH_PROVIDERS.map((p) => ({
					value: encodeChoice({ kind: "oauth" as const, id: p.id }),
					label: `Subscription - ${p.name}`,
					description: "Use a logged-in provider account when supported.",
				})),
				...API_KEY_PROVIDERS.map((p) => ({
					value: encodeChoice({ kind: "api" as const, id: p.id }),
					label: `API key - ${p.label}`,
					description: `Stored in Silo as ${p.envKey}.`,
				})),
				{
					value: encodeChoice({ kind: "ollama" }),
					label: "Local - Ollama  (no key required)",
					description: "Run with local model infrastructure.",
				},
			],
		});
		const choice = decodeChoice(selected);

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

/** Map from OAuth provider id → Silo modelProvider id used by runtime agents and Farmhand. */
export const OAUTH_PROVIDER_TO_MODEL_PROVIDER: Record<string, string> = {
	"anthropic": "anthropic",
	"openai-codex": "openai-codex",
};
