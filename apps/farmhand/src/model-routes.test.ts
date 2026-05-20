import { afterEach, describe, expect, it } from "vitest";
import { routeForScope, withModelRouteEnv } from "./model-routes.js";

describe("model routes", () => {
	afterEach(() => {
		delete process.env.MODEL_PROVIDER;
		delete process.env.MODEL_ID;
	});

	it("uses gpt-5.5 as OpenAI default route", () => {
		expect(routeForScope({ modelProvider: "openai" }, "default")).toEqual({
			provider: "openai",
			modelId: "gpt-5.5",
		});
	});

	it("uses codex spark for OpenAI worker route by default", () => {
		expect(routeForScope({ modelProvider: "openai" }, "worker")).toEqual({
			provider: "openai",
			modelId: "gpt-5.3-codex-spark",
		});
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
});
