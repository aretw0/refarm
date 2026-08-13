import { withActivity } from "@refarm.dev/capabilities";
import { modelCredentialEnvKey } from "@refarm.dev/config";
import { createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { isContainer } from "@refarm.dev/root";
import chalk from "chalk";
import {
	formatSelectionRefusal,
	resolveModelProviderSelection,
} from "./model-provider-selection.js";
import type {
	OAuthCallbackWaitStatus,
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthProviderInterface,
} from "./oauth/index.js";
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
	if (!envKey)
		throw new Error(`No credential env key registered for model provider "${provider}".`);
	return envKey;
}

// ── API key tier (paste + link) ───────────────────────────────────────────────
const API_KEY_PROVIDERS = [
	{
		id: "openai",
		label: "OpenAI API key",
		envKey: credentialEnvKey("openai"),
		url: "https://platform.openai.com/api-keys",
	},
	{
		id: "anthropic",
		label: "Anthropic API key",
		envKey: credentialEnvKey("anthropic"),
		url: "https://console.anthropic.com/settings/keys",
	},
	{
		id: "groq",
		label: "Groq",
		envKey: credentialEnvKey("groq"),
		url: "https://console.groq.com/keys",
	},
	{
		id: "mistral",
		label: "Mistral",
		envKey: credentialEnvKey("mistral"),
		url: "https://console.mistral.ai/api-keys",
	},
	{
		id: "gemini",
		label: "Gemini (Google)",
		envKey: credentialEnvKey("gemini"),
		url: "https://aistudio.google.com/app/apikey",
	},
	{ id: "xai", label: "xAI / Grok", envKey: credentialEnvKey("xai"), url: "https://console.x.ai" },
	{
		id: "deepseek",
		label: "DeepSeek",
		envKey: credentialEnvKey("deepseek"),
		url: "https://platform.deepseek.com/api_keys",
	},
	{
		id: "together",
		label: "Together AI",
		envKey: credentialEnvKey("together"),
		url: "https://api.together.xyz/settings/api-keys",
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		envKey: credentialEnvKey("openrouter"),
		url: "https://openrouter.ai/keys",
	},
] as const;

type ApiKeyProviderId = (typeof API_KEY_PROVIDERS)[number]["id"];

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

function formatSeconds(ms: number): string {
	return `${Math.ceil(ms / 1000)}s`;
}

function renderCallbackWaitStatus(
	status: OAuthCallbackWaitStatus,
	options: { containerEnv: boolean; hasPortForwarding: boolean },
): void {
	const callbackHint = status.callbackUrl ? ` ${chalk.dim(`callback: ${status.callbackUrl}`)}` : "";
	if (status.phase === "callback-waiting") {
		console.log(chalk.dim(`  ${status.message}${callbackHint}`));
		if (options.containerEnv && options.hasPortForwarding) {
			console.log(
				chalk.dim("     VS Code/Codespaces must forward that callback port to this container."),
			);
		}
		if (status.timeoutMs) {
			console.log(
				chalk.dim(
					`     If the browser redirects but this terminal does not continue, copy the full redirect URL. Manual fallback starts after ${formatSeconds(status.timeoutMs)}.`,
				),
			);
		}
		return;
	}
	if (status.phase === "callback-heartbeat") {
		console.log(chalk.dim(`  ${status.message}`));
		return;
	}
	if (status.phase === "callback-received") {
		console.log(chalk.green(`  ✓ ${status.message}`));
		return;
	}
	if (status.phase === "callback-timeout" || status.phase === "callback-unavailable") {
		console.log(chalk.yellow(`  ⚠  ${status.message}`));
		return;
	}
	if (status.phase === "callback-cancelled") {
		console.log(chalk.dim(`  ${status.message}`));
	}
}

async function runOAuthFlow(
	ctx: CollectContext,
	provider: OAuthProviderInterface,
): Promise<ModelCredential> {
	// Emit the surface-neutral "working" signal for the OAuth round-trip instead of
	// driving the spinner directly — the CLI's activity subscriber (attached once at
	// process boot in cli-main.ts) renders it, and the SAME event would light up a TUI
	// indicator or a web/mesh pill without this flow knowing the difference. `report`
	// carries the existing "exchanging token" style progress notes onto that signal.
	return withActivity(
		`Signing in to ${provider.name}`,
		async (report) => {
			const containerEnv = isContainer();
			const hasPortForwarding =
				process.env["REFARM_DEVCONTAINER"] === "true" ||
				Boolean(process.env["VSCODE_REMOTE_CONTAINERS_SESSION"]) ||
				Boolean(process.env["REMOTE_CONTAINERS"]) ||
				Boolean(process.env["CODESPACES"]);
			const forceManual = process.env["REFARM_OAUTH_CALLBACK_MODE"] === "manual";
			const callbackCanReachBrowser =
				Boolean(provider.usesCallbackServer) && !forceManual && (!containerEnv || hasPortForwarding);
			const needsManualCode = Boolean(provider.usesCallbackServer) && !callbackCanReachBrowser;

			const loginCallbacks: OAuthLoginCallbacks = {
				onAuth: ({ url, instructions }) => {
					console.log(chalk.dim(`\n  ${instructions ?? "Complete login in your browser."}`));
					console.log(chalk.cyan(`  → ${url}\n`));
					if (needsManualCode) {
						console.log(
							chalk.yellow(
								"  ⚠  Running in a container — the browser redirect cannot reach this environment.",
							),
						);
						console.log(
							chalk.dim(
								"     After logging in, copy the full redirect URL or authorization code and paste it below.\n",
							),
						);
					} else if (containerEnv && provider.usesCallbackServer) {
						console.log(
							chalk.dim(
								"     Devcontainer detected — VS Code should forward the callback port automatically.",
							),
						);
						console.log(
							chalk.dim(
								"     If the browser does not return here, you will be prompted to paste the redirect URL.",
							),
						);
						console.log(
							chalk.dim(
								"     You can paste the full redirect URL into this terminal early; it will be consumed when the fallback prompt appears.\n",
							),
						);
					}
					ctx.tryOpenUrl(url);
				},
				onPrompt: async ({ message }) => promptCode(ctx, message),
				onCallbackWait: (status) =>
					renderCallbackWaitStatus(status, {
						containerEnv,
						hasPortForwarding,
					}),
				onProgress: (msg) => report(msg),
				...(callbackCanReachBrowser && containerEnv
					? {
							callbackTimeoutMs: DEVCONTAINER_CALLBACK_TIMEOUT_MS,
						}
					: {}),
				// In plain containers without a known port-forwarding bridge, the host
				// browser cannot reach the callback server, so prompt for the code.
				...(needsManualCode
					? {
							skipCallbackServer: true,
							onManualCodeInput: () =>
								promptCode(ctx, "Paste the redirect URL or authorization code:"),
						}
					: {}),
			};

			const creds = await provider.login(loginCallbacks);
			console.log(chalk.green(`  ✓ ${provider.name} — authenticated`));
			return { provider: provider.id, apiKey: provider.getApiKey(creds), oauthCredentials: creds };
		},
		{ kind: "auth" },
	);
}

async function runApiKeyFlow(
	ctx: CollectContext,
	p: (typeof API_KEY_PROVIDERS)[number],
): Promise<ModelCredential> {
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

/**
 * The two credential inventories, so a caller can validate a `--model-provider` value WITHOUT
 * re-listing them. One source; a second list would be the `program.ts` defect again.
 */
export function modelProviderInventories(): { oauth: string[]; apiKey: string[] } {
	return {
		oauth: OAUTH_PROVIDERS.map((provider) => provider.id),
		apiKey: API_KEY_PROVIDERS.map((provider) => provider.id),
	};
}

export const modelCredentialProvider: CredentialProvider & {
	collectModel(
		ctx: CollectContext,
		options?: { modelProvider?: string },
	): Promise<ModelCredential>;
} = {
	id: "model",
	label: "Model Provider",
	namespace: "model",

	/**
	 * @param options.modelProvider Skip the picker and go straight to this provider's credential
	 *   flow. THROWS rather than falling back to the picker when the value cannot be honoured: an
	 *   operator who named a provider was being explicit, and quietly showing a menu instead would
	 *   discard that — worse, in a non-interactive shell it would hang on a prompt nobody can answer.
	 */
	async collectModel(
		ctx: CollectContext,
		options: { modelProvider?: string } = {},
	): Promise<ModelCredential> {
		if (options.modelProvider) {
			const selection = resolveModelProviderSelection(options.modelProvider, {
				oauth: OAUTH_PROVIDERS.map((p) => p.id),
				apiKey: API_KEY_PROVIDERS.map((p) => p.id),
			});
			const refusal = formatSelectionRefusal(selection);
			if (refusal) throw new Error(refusal);
			if (selection.kind === "ollama") {
				console.log(chalk.green("  ✓ Ollama selected — make sure Ollama is running: ollama serve"));
				return { provider: "ollama", apiKey: null };
			}
			if (selection.kind === "oauth") {
				return runOAuthFlow(ctx, OAUTH_PROVIDERS.find((p) => p.id === selection.id)!);
			}
			return runApiKeyFlow(ctx, API_KEY_PROVIDERS.find((p) => p.id === selection.id)!);
		}

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
	anthropic: "anthropic",
	"openai-codex": "openai-codex",
};
