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

	it("treats any explicit slash as provider/model for custom providers", () => {
		expect(
			parseModelRef("vllm/Qwen3-Coder-480B-A35B-Instruct", "openai"),
		).toEqual({
			provider: "vllm",
			modelId: "Qwen3-Coder-480B-A35B-Instruct",
		});
	});
});
