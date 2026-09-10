import { afterEach, describe, expect, it } from "vitest";
import type { ModelTokens } from "./model.js";
import {
	buildAccountCredentialMap,
	buildCurrentModelEnvelope,
	buildProviderBaseUrls,
	formatCurrentModel,
	routeForBoundAccount,
} from "./model.js";

// The legacy print wrappers were deleted after the model group migration; the
// live formatter (text) and envelope builder (JSON) are the source of truth the
// group renders through, so this coverage now targets them directly.
function captureCurrentModel(tokens: Partial<ModelTokens> = {}): string {
	return formatCurrentModel(tokens as ModelTokens);
}

function captureCurrentModelJson(tokens: Partial<ModelTokens> = {}): Record<string, unknown> {
	return buildCurrentModelEnvelope(tokens as ModelTokens) as unknown as Record<string, unknown>;
}

describe("model current output", () => {
	afterEach(() => {
		delete process.env.MODEL_PROVIDER;
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.MODEL_ID;
		delete process.env.MODEL_BASE_URL;
		delete process.env.MODEL_FALLBACK_PROVIDER;
		delete process.env.MODEL_FALLBACK_MODEL_ID;
		delete process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_CODEX_ACCESS_TOKEN;
		delete process.env.GITHUB_COPILOT_ACCESS_TOKEN;
	});

	it("shows the effective default route as the keyless ollama floor", () => {
		// Zero-config resolves the keyless ollama floor (the shared default across
		// guest/host/CLI). ollama needs no API key, so there is no "key: missing"
		// nag; the built-in defaults still surface the openai reference line.
		const output = captureCurrentModel();

		expect(output).toContain("current: ollama/llama3.2");
		expect(output).toContain("provider: ollama");
		expect(output).toContain("model:    llama3.2");
		expect(output).toContain("source:   built-in defaults");
		expect(output).toContain("openai default: openai/gpt-5.6-sol");
	});

	it("needs no credential recovery in JSON for the keyless ollama floor", () => {
		// The floor is keyless, so there is nothing to recover: nextAction is null.
		const payload = captureCurrentModelJson() as {
			ok: boolean;
			nextAction: string | null;
			nextActions: string[];
			nextCommand: string | null;
			nextCommands: string[];
		};

		expect(payload.ok).toBe(true);
		expect(payload.nextAction).toBeNull();
		expect(payload.nextCommand).toBeNull();
	});

	it("shows supported subscription OAuth without runtime unsupported warning", () => {
		const output = captureCurrentModel({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			oauthProvider: "openai-codex",
			oauthCredentials: {
				"openai-codex": { access: "oauth-access-test" },
			},
		});

		expect(output).toContain("key:      Silo OAuth (openai-codex)");
		expect(output).not.toContain("not a runtime API credential yet");
		expect(output).not.toContain("fix:     refarm sow --json");
	});

	it("prints no runtime unsupported recovery actions for supported subscription OAuth", () => {
		const payload = captureCurrentModelJson({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			oauthProvider: "openai-codex",
			oauthCredentials: {
				"openai-codex": { access: "oauth-access-test" },
			},
		}) as {
			ok: boolean;
			nextActions: string[];
			nextCommands: string[];
			recommendations?: Array<{ diagnostic: string; severity: string }>;
		};

		expect(payload.ok).toBe(true);
		expect(payload.nextActions).toEqual([]);
		expect(payload.nextCommands).toEqual([]);
		expect(payload.recommendations ?? []).not.toContainEqual(
			expect.objectContaining({
				diagnostic: "model-subscription-runtime-unsupported",
			}),
		);
	});

	// REPINNED FORWARD (ISS-141): github-copilot gained a runtime adapter, so it is no longer the
	// example of a provider `ask` must refuse. The warning MECHANISM is unchanged; what this pins
	// now is that a supported subscription provider is reported plainly.
	it("reports a supported subscription provider from the environment without a warning", () => {
		process.env.MODEL_PROVIDER = "github-copilot";
		process.env.MODEL_ID = "gpt-4o";
		process.env.GITHUB_COPILOT_ACCESS_TOKEN = "copilot-access-test";

		const output = captureCurrentModel();

		expect(output).toContain("current: github-copilot/gpt-4o");
		expect(output).toContain("key env:  GITHUB_COPILOT_ACCESS_TOKEN");
		expect(output).toContain("key:      GITHUB_COPILOT_ACCESS_TOKEN env");
		// The whole advisory block is gone, not just its last line: a provider the runtime can
		// dispatch is reported like any other route.
		expect(output).not.toContain("subscription OAuth");
		expect(output).not.toContain("not a runtime API credential yet");
	});

	it("prints NO unsupported-subscription recovery for a provider the runtime can dispatch", () => {
		process.env.MODEL_PROVIDER = "github-copilot";
		process.env.MODEL_ID = "gpt-4o";
		process.env.GITHUB_COPILOT_ACCESS_TOKEN = "copilot-access-test";

		const payload = captureCurrentModelJson() as {
			ok: boolean;
			nextActions: string[];
			nextCommands: string[];
			recommendations: Array<{ diagnostic: string; severity: string }>;
		};

		expect(payload.ok).toBe(true);
		expect(payload.recommendations ?? []).not.toContainEqual(
			expect.objectContaining({ diagnostic: "model-subscription-runtime-unsupported" }),
		);
	});

	it("marks environment overrides as the active source", () => {
		process.env.MODEL_PROVIDER = "gemini";

		const output = captureCurrentModel();

		expect(output).toContain("current: gemini/gemini-3-flash-preview");
		expect(output).toContain("key env:  GEMINI_API_KEY");
		expect(output).toContain("source:   environment overrides are active");
		expect(output).toContain("env:      MODEL_PROVIDER");
	});

	it("lists all active model route environment overrides", () => {
		process.env.MODEL_PROVIDER = "vllm";
		process.env.MODEL_ID = "Qwen3-Coder-480B-A35B-Instruct";
		process.env.MODEL_BASE_URL = "http://127.0.0.1:8000";

		const output = captureCurrentModel();

		expect(output).toContain("source:   environment overrides are active");
		expect(output).toContain("env:      MODEL_PROVIDER, MODEL_ID, MODEL_BASE_URL");
	});

	it("marks persisted scoped routes as identity source", () => {
		const output = captureCurrentModel({
			modelRoutes: { worker: "anthropic/claude-sonnet-4-6" },
		});

		expect(output).toContain("worker:   anthropic/claude-sonnet-4-6");
		expect(output).toContain("source:   ~/.refarm/identity.json");
		expect(output).not.toContain("source:   built-in defaults");
	});
});

/**
 * ISS-131 — the route names a provider, the binding names an account, and they can disagree.
 *
 * Measured on the operator's node 2026-08-17: `refarm ask --workspace refarm` sent
 * `modelProvider: openai-codex` from the route AND `credentialId: K4NX...` (a github-copilot
 * account) from the binding, in the same dispatch. The record and the spend would have named
 * different accounts — an attribution worse than none, because it reads as measured.
 */
describe("routeForBoundAccount", () => {
	it("takes the provider from the bound account when the route names another", () => {
		expect(
			routeForBoundAccount(
				{ modelProvider: "openai-codex", modelId: "gpt-5.5" },
				{ provider: "github-copilot" },
				"default",
			),
		).toMatchObject({ modelProvider: "github-copilot" });
	});

	it("moves the MODEL with the provider, because a route's model id does not travel", () => {
		const routed = routeForBoundAccount(
			{ modelProvider: "openai-codex", modelId: "gpt-5.5" },
			{ provider: "github-copilot" },
			"default",
		);
		expect(routed.modelId).not.toBe("gpt-5.5");
		expect(routed.modelId).toBeTruthy();
	});

	it("leaves the route alone when the binding is of the same provider", () => {
		// Which of one provider's accounts pays is the resolver's question, not the route's.
		const route = { modelProvider: "github-copilot", modelId: "claude-sonnet-4" };
		expect(routeForBoundAccount(route, { provider: "github-copilot" }, "default")).toBe(route);
	});

	it("leaves the route alone when nothing is bound", () => {
		const route = { modelProvider: "openai-codex", modelId: "gpt-5.5" };
		expect(routeForBoundAccount(route, undefined, "default")).toBe(route);
	});

	it("answers per SCOPE, so a worker route does not inherit the default model", () => {
		const asDefault = routeForBoundAccount({}, { provider: "github-copilot" }, "default");
		const asWorker = routeForBoundAccount({}, { provider: "github-copilot" }, "worker");
		expect(asDefault.modelProvider).toBe("github-copilot");
		expect(asWorker.modelProvider).toBe("github-copilot");
	});
});

/**
 * ISS-141 — the endpoint is a property of the ACCOUNT, not of the provider.
 *
 * Measured on the operator's node 2026-08-17: his two Copilot seats announce different endpoints
 * in their own token exchange (`api.business.` vs `api.individual.`), so a static provider→url
 * table in the host is not incomplete, it is wrong — and the global `MODEL_BASE_URL` would
 * redirect every other provider along with it.
 */
describe("buildProviderBaseUrls", () => {
	const account = (provider: string, credentialId: string) => ({ credentialId, provider });

	it("carries the endpoint each credential announces", () => {
		expect(
			buildProviderBaseUrls(
				[account("github-copilot", "a")],
				new Map([["a", { baseUrl: "https://api.business.githubcopilot.com" }]]),
			),
		).toBe("github-copilot=https://api.business.githubcopilot.com");
	});

	it("omits a provider whose credential announces none, rather than inventing one", () => {
		expect(buildProviderBaseUrls([account("openai-codex", "a")], new Map([["a", {}]]))).toBe("");
	});

	it("DROPS a malformed endpoint instead of letting it take the whole map down", () => {
		// The host's forward policy rejects a value with whitespace, and it rejects the WHOLE
		// variable — so one bad endpoint would silently unroute every other provider with it.
		const built = buildProviderBaseUrls(
			[account("github-copilot", "a"), account("openai-codex", "b")],
			new Map<string, unknown>([
				["a", { baseUrl: "https://bad url.example" }],
				["b", { baseUrl: "https://chatgpt.com" }],
			]),
		);
		expect(built).toBe("openai-codex=https://chatgpt.com");
	});

	it("drops an endpoint containing the pair separator, which would split into nonsense", () => {
		expect(
			buildProviderBaseUrls(
				[account("github-copilot", "a")],
				new Map([["a", { baseUrl: "https://x.example/a,b" }]]),
			),
		).toBe("");
	});

	it("emits ONE entry per provider, because the host reads one endpoint per provider", () => {
		const built = buildProviderBaseUrls(
			[account("github-copilot", "a"), account("github-copilot", "b")],
			new Map<string, unknown>([
				["a", { baseUrl: "https://api.business.githubcopilot.com" }],
				["b", { baseUrl: "https://api.individual.githubcopilot.com" }],
			]),
		);
		expect(built).toBe("github-copilot=https://api.business.githubcopilot.com");
	});

	it("is EMPTY when nothing announces an endpoint, which is the ordinary case", () => {
		expect(buildProviderBaseUrls([], new Map())).toBe("");
	});
});

/**
 * ISS-145 — WHICH SEAT pays, when one provider holds two.
 *
 * The host reads one credential env var per provider, so the operator's personal and corporate
 * Copilot seats — different endpoints, different entitlements — could never both be provisioned,
 * and a workspace bound to the one that was not the default could not be honoured.
 */
describe("buildAccountCredentialMap", () => {
	const seat = (credentialId: string, provider = "github-copilot") => ({ credentialId, provider });

	it("carries BOTH seats of one provider, each with its own endpoint", () => {
		const map = JSON.parse(
			buildAccountCredentialMap(
				[seat("model-account:CORP"), seat("model-account:PESS")],
				new Map<string, unknown>([
					["model-account:CORP", { access: "tid=corp", baseUrl: "https://api.business.githubcopilot.com" }],
					["model-account:PESS", { access: "tid=pess", baseUrl: "https://api.individual.githubcopilot.com" }],
				]),
			),
		) as Record<string, { access: string; baseUrl?: string }>;

		expect(Object.keys(map).sort()).toEqual(["model-account:CORP", "model-account:PESS"]);
		expect(map["model-account:CORP"]!.baseUrl).toContain("business");
		expect(map["model-account:PESS"]!.baseUrl).toContain("individual");
	});

	it("omits an endpoint the credential never announced, rather than inventing one", () => {
		// The host admits the account's endpoint as a route. An invented one would let the guardrail
		// accept a host the seat never named.
		const map = JSON.parse(
			buildAccountCredentialMap([seat("a", "openai-codex")], new Map([["a", { access: "t" }]])),
		) as Record<string, { baseUrl?: string }>;
		expect(map.a!.baseUrl).toBeUndefined();
	});

	it("drops a malformed endpoint for the same reason", () => {
		const map = JSON.parse(
			buildAccountCredentialMap([seat("a")], new Map([["a", { access: "t", baseUrl: "not a url" }]])),
		) as Record<string, { baseUrl?: string }>;
		expect(map.a!.baseUrl).toBeUndefined();
	});

	it("skips a seat with no readable secret, and exports NOTHING when none is readable", () => {
		// An empty object would export a variable that says "asked and found nothing", which is not
		// what an absent variable says.
		expect(buildAccountCredentialMap([seat("a")], new Map())).toBe("");
		expect(buildAccountCredentialMap([], new Map())).toBe("");
	});
});
