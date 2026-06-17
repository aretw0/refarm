import { afterEach, describe, expect, it } from "vitest";
import {
	createModelRouteResolver,
	routeResolutionEnv,
	routeForScope,
	scopeForEffortSource,
	withModelRouteEnv,
} from "./model-routes.js";

describe("model routes", () => {
	afterEach(() => {
		delete process.env.MODEL_PROVIDER;
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.MODEL_ID;
		delete process.env.MODEL_BASE_URL;
	});

	it("uses gpt-5.5 as OpenAI default route", () => {
		expect(routeForScope({ modelProvider: "openai" }, "default")).toEqual({
			provider: "openai",
			modelId: "gpt-5.5",
		});
	});

	it("keeps provider defaults aligned with refarm CLI routing", () => {
		expect(routeForScope({ modelProvider: "anthropic" }, "default")).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
		});
		expect(routeForScope({ modelProvider: "groq" }, "default")).toEqual({
			provider: "groq",
			modelId: "llama-3.3-70b-versatile",
		});
		expect(routeForScope({ modelProvider: "mistral" }, "default")).toEqual({
			provider: "mistral",
			modelId: "mistral-medium-3-5",
		});
		expect(routeForScope({ modelProvider: "gemini" }, "default")).toEqual({
			provider: "gemini",
			modelId: "gemini-3-flash-preview",
		});
		expect(routeForScope({ modelProvider: "xai" }, "default")).toEqual({
			provider: "xai",
			modelId: "grok-4.3",
		});
		expect(routeForScope({ modelProvider: "deepseek" }, "default")).toEqual({
			provider: "deepseek",
			modelId: "deepseek-v4-flash",
		});
		expect(routeForScope({ modelProvider: "together" }, "default")).toEqual({
			provider: "together",
			modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
		});
		expect(routeForScope({ modelProvider: "openrouter" }, "default")).toEqual({
			provider: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
		});
	});

	it("uses codex spark for OpenAI worker route by default", () => {
		expect(routeForScope({ modelProvider: "openai" }, "worker")).toEqual({
			provider: "openai",
			modelId: "gpt-5.3-codex-spark",
		});
	});

	it("maps effort sources to model route scopes", () => {
		expect(scopeForEffortSource("refarm-ask")).toBe("default");
		expect(scopeForEffortSource("refarm-chat")).toBe("default");
		expect(scopeForEffortSource("refarm-monitor")).toBe("monitor");
		expect(scopeForEffortSource("refarm-task")).toBe("worker");
		expect(scopeForEffortSource("channel:telegram")).toBe("worker");
		expect(scopeForEffortSource("channel:matrix")).toBe("worker");
		expect(scopeForEffortSource(undefined)).toBe("worker");
	});

	it("respects an explicit scoped worker route", () => {
		expect(
			routeForScope(
				{
					modelProvider: "openai",
					modelId: "gpt-5.5",
					modelRoutes: { worker: "anthropic/claude-sonnet-4-6" },
				},
				"worker",
			),
		).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
		});
	});

	it("infers providers for scoped model-only routes", () => {
		expect(
			routeForScope(
				{
					modelProvider: "openai",
					modelId: "gpt-5.5",
					modelRoutes: { worker: "claude-sonnet-4-6" },
				},
				"worker",
			),
		).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
		});
	});

	it("prefers operator environment overrides over stored scoped routes", () => {
		expect(
			routeForScope(
				{
					modelProvider: "openai",
					modelId: "gpt-5.5",
					modelRoutes: { worker: "openai/gpt-5.3-codex-spark" },
				},
				"worker",
				{
					env: {
						MODEL_PROVIDER: "anthropic",
						MODEL_ID: "claude-sonnet-4-6",
					},
				},
			),
		).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
		});
	});

	it("ignores Silo-managed default route env while preserving operator env for scoped routes", () => {
		const tokens = {
			modelProvider: "openai",
			modelId: "gpt-5.5",
			modelRoutes: { worker: "anthropic/claude-sonnet-4-6" },
		};

		expect(
			routeForScope(tokens, "worker", {
				env: routeResolutionEnv(
					{
						MODEL_PROVIDER: "openai",
						MODEL_ID: "gpt-5.5",
						OPENAI_API_KEY: "sk-managed",
					},
					["MODEL_PROVIDER", "MODEL_ID", "OPENAI_API_KEY"],
				),
			}),
		).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
		});

		expect(
			routeForScope(tokens, "worker", {
				env: routeResolutionEnv(
					{
						MODEL_PROVIDER: "gemini",
					},
					[],
				),
			}),
		).toEqual({
			provider: "gemini",
			modelId: "gemini-3-flash-preview",
		});
	});

	it("resolves provider defaults from operator environment overrides", () => {
		expect(
			routeForScope({ modelProvider: "openai" }, "worker", {
				env: { MODEL_PROVIDER: "gemini" },
			}),
		).toEqual({
			provider: "gemini",
			modelId: "gemini-3-flash-preview",
		});
	});

	it("does not pair an env provider override with a stored model from another provider", () => {
		expect(
			routeForScope(
				{ modelProvider: "openai", modelId: "gpt-5.5" },
				"default",
				{
					env: { MODEL_PROVIDER: "gemini" },
				},
			),
		).toEqual({
			provider: "gemini",
			modelId: "gemini-3-flash-preview",
		});
	});

	it("resolves provider defaults from the default provider environment", () => {
		expect(
			routeForScope({ modelProvider: "openai" }, "worker", {
				env: { MODEL_DEFAULT_PROVIDER: "gemini" },
			}),
		).toEqual({
			provider: "gemini",
			modelId: "gemini-3-flash-preview",
		});
	});

	it("restores process env after a scoped route", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.MODEL_ID = "gpt-5.5";

		await withModelRouteEnv(
			{ provider: "openai", modelId: "gpt-5.3-codex-spark" },
			async () => {
				expect(process.env.MODEL_PROVIDER).toBe("openai");
				expect(process.env.MODEL_ID).toBe("gpt-5.3-codex-spark");
			},
		);

		expect(process.env.MODEL_PROVIDER).toBe("openai");
		expect(process.env.MODEL_ID).toBe("gpt-5.5");
	});

	it("does not leak a previous model id into a route without one", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.MODEL_ID = "gpt-5.5";

		await withModelRouteEnv(
			{ provider: "vllm", modelId: undefined },
			async () => {
				expect(process.env.MODEL_PROVIDER).toBe("vllm");
				expect(process.env.MODEL_ID).toBeUndefined();
			},
		);

		expect(process.env.MODEL_PROVIDER).toBe("openai");
		expect(process.env.MODEL_ID).toBe("gpt-5.5");
	});

	it("clears Silo-managed base URL when a scoped route changes provider", async () => {
		process.env.MODEL_PROVIDER = "vllm";
		process.env.MODEL_ID = "Qwen3-Coder-480B-A35B-Instruct";
		process.env.MODEL_BASE_URL = "http://127.0.0.1:8000";

		await withModelRouteEnv(
			{ provider: "openai", modelId: "gpt-5.3-codex-spark" },
			async () => {
				expect(process.env.MODEL_PROVIDER).toBe("openai");
				expect(process.env.MODEL_ID).toBe("gpt-5.3-codex-spark");
				expect(process.env.MODEL_BASE_URL).toBeUndefined();
			},
			{ managedEnvKeys: ["MODEL_PROVIDER", "MODEL_ID", "MODEL_BASE_URL"] },
		);

		expect(process.env.MODEL_PROVIDER).toBe("vllm");
		expect(process.env.MODEL_ID).toBe("Qwen3-Coder-480B-A35B-Instruct");
		expect(process.env.MODEL_BASE_URL).toBe("http://127.0.0.1:8000");
	});

	it("preserves operator base URL while applying a scoped route", async () => {
		process.env.MODEL_PROVIDER = "vllm";
		process.env.MODEL_ID = "Qwen3-Coder-480B-A35B-Instruct";
		process.env.MODEL_BASE_URL = "http://operator.local";

		await withModelRouteEnv(
			{ provider: "openai", modelId: "gpt-5.3-codex-spark" },
			async () => {
				expect(process.env.MODEL_PROVIDER).toBe("openai");
				expect(process.env.MODEL_ID).toBe("gpt-5.3-codex-spark");
				expect(process.env.MODEL_BASE_URL).toBe("http://operator.local");
			},
			{ managedEnvKeys: [] },
		);

		expect(process.env.MODEL_PROVIDER).toBe("vllm");
		expect(process.env.MODEL_ID).toBe("Qwen3-Coder-480B-A35B-Instruct");
		expect(process.env.MODEL_BASE_URL).toBe("http://operator.local");
	});

	it("keeps Silo-managed base URL when the scoped route stays on the same provider", async () => {
		process.env.MODEL_PROVIDER = "vllm";
		process.env.MODEL_ID = "Qwen3-Coder-480B-A35B-Instruct";
		process.env.MODEL_BASE_URL = "http://127.0.0.1:8000";

		await withModelRouteEnv(
			{ provider: "vllm", modelId: "Qwen3-Coder-480B-A35B-Instruct" },
			async () => {
				expect(process.env.MODEL_PROVIDER).toBe("vllm");
				expect(process.env.MODEL_BASE_URL).toBe("http://127.0.0.1:8000");
			},
			{ managedEnvKeys: ["MODEL_PROVIDER", "MODEL_ID", "MODEL_BASE_URL"] },
		);
	});

	it("refreshes route tokens and keeps last known value on load failure", async () => {
		let fail = false;
		const resolver = createModelRouteResolver({
			async loadTokens() {
				if (fail) throw new Error("silo unavailable");
				return { modelProvider: "openai", modelId: "gpt-5.5" };
			},
		});

		await expect(resolver.refreshTokens()).resolves.toEqual({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
		fail = true;
		await expect(resolver.refreshTokens()).resolves.toEqual({
			modelProvider: "openai",
			modelId: "gpt-5.5",
		});
	});
});
