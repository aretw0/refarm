import { describe, expect, it } from "vitest";

import { createExtensionDevelopCapability } from "./maturity-verb.js";

describe("extension-develop verb — the governed maturity trail", () => {
	it("reports the extension climbing experiment → productive → sensitive → catalog", async () => {
		const verb = createExtensionDevelopCapability();
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			trail: Array<{ level: string }>;
			progression: Array<{ stage: string; level: string; blockedBy: string[] }>;
			reached: string;
		};
		expect(env.trail.map((t) => t.level)).toEqual(["experiment", "productive", "sensitive", "catalog"]);
		expect(env.progression.map((p) => p.level)).toEqual(["experiment", "productive", "sensitive", "catalog"]);
		expect(env.reached).toBe("catalog");
	});

	it("surfaces the objective promotion gate at each stage (what blocks the next level)", async () => {
		const verb = createExtensionDevelopCapability();
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			progression: Array<{ level: string; blockedBy: string[] }>;
		};
		// The experiment stage is blocked from productive by the conformance/integrity/telemetry gate.
		const experiment = env.progression.find((p) => p.level === "experiment")!;
		expect(experiment.blockedBy.length).toBeGreaterThan(0);
		// The catalog stage (top) is blocked by nothing.
		const catalog = env.progression.find((p) => p.level === "catalog")!;
		expect(catalog.blockedBy).toEqual([]);
	});
});
