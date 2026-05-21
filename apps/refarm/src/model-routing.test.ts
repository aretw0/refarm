import { describe, expect, it } from "vitest";
import { parseModelRef } from "./model-routing.js";

describe("model routing", () => {
	it("parses known provider/model refs with nested model ids", () => {
		expect(
			parseModelRef("together/meta-llama/Llama-3.3-70B-Instruct-Turbo", undefined),
		).toEqual({
			provider: "together",
			modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
		});
		expect(
			parseModelRef("openrouter/anthropic/claude-sonnet-4.6", undefined),
		).toEqual({
			provider: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
		});
	});

	it("preserves slash-bearing model ids for the stored provider", () => {
		expect(
			parseModelRef("meta-llama/Llama-3.3-70B-Instruct-Turbo", "together"),
		).toEqual({
			provider: "together",
			modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
		});
	});
});
