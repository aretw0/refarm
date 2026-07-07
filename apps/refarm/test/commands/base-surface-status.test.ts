import { describe, expect, it, vi } from "vitest";

import { resolveBaseSurfaceStatus } from "../../src/commands/base-surface-status.js";

describe("resolveBaseSurfaceStatus", () => {
	it("adapts runtime, model, and health payloads into the base model", async () => {
		const model = await resolveBaseSurfaceStatus({
			resolveRuntime: vi.fn().mockResolvedValue({
				command: "runtime",
				operation: "status",
				ok: false,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: false,
				sidecarUrl: "http://127.0.0.1:42001",
				sidecarProbe: {
					url: "http://127.0.0.1:42001/efforts/summary",
					ready: false,
					error: "connect ECONNREFUSED 127.0.0.1:42001",
				},
				nextAction: "refarm runtime ensure --wait --next-command",
				nextActions: ["refarm runtime ensure --wait --next-command"],
				nextCommand: "refarm runtime ensure --wait --next-command",
				nextCommands: ["refarm runtime ensure --wait --next-command"],
			}),
			resolveModel: vi.fn().mockResolvedValue({
				command: "model",
				operation: "current",
				ok: true,
				current: {
					ref: "openai-codex/gpt-5.3-codex-spark",
					provider: "openai-codex",
					modelId: "gpt-5.3-codex-spark",
				},
				credential: {
					state: "silo-oauth",
					status: "Silo OAuth (openai-codex)",
					envKey: "OPENAI_CODEX_ACCESS_TOKEN",
				},
				routes: {},
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
			resolveHealth: vi.fn().mockResolvedValue({
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			}),
		});

		expect(model.ok).toBe(false);
		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
		]);
		expect(model.nextCommand).toBe("refarm runtime ensure --wait --next-command");
	});
});
