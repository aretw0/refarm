import { buildBaseSurfaceModel } from "@refarm.dev/operator-state";
import { describe, expect, it } from "vitest";

import { formatBaseSurfaceModel } from "../../src/commands/base-surface-output.js";

describe("formatBaseSurfaceModel", () => {
	it("formats a compact human summary for manual exploration", () => {
		const model = buildBaseSurfaceModel(
			{
				runtime: {
					command: "runtime",
					operation: "status",
					ok: true,
					configuredEngine: "auto",
					activeEngine: "rust",
					ready: true,
					sidecarUrl: "http://127.0.0.1:42001",
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				},
				health: {
					command: "health",
					operation: "audit",
					ok: true,
					issueCount: 0,
					recommendations: [],
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				},
			},
			{ owner: "apps/refarm" },
		);

		const output = formatBaseSurfaceModel(model);

		expect(output).toContain("Refarm base: ready");
		expect(output).toContain("runtime  ready");
		expect(output).toContain("health   ready");
	});
});
