import { describe, expect, it } from "vitest";

import {
	SOURCE_CAPABILITY,
	createInMemorySourceProvider,
	runSourceV1Conformance,
	type SourceProvider,
} from "./index.js";

describe("source:v1 conformance", () => {
	it("passes for the in-memory reference provider", async () => {
		const provider = createInMemorySourceProvider();
		const result = await runSourceV1Conformance(provider);
		expect(result.pass).toBe(true);
		expect(result.total).toBe(7);
		expect(result.failed).toBe(0);
	});

	it("reports actionable failures for an incompatible provider", async () => {
		const broken: SourceProvider = {
			pluginId: "",
			capability: "source:v0" as typeof SOURCE_CAPABILITY,
			kinds: [],
			resolve: async () => ({ kind: "local", path: "" }),
			materialize: async () => {
				throw new Error("backend unavailable");
			},
			status: async () => ({ kind: "local", materialized: false }),
			refresh: async () => {
				throw new Error("backend unavailable");
			},
		};
		const result = await runSourceV1Conformance(broken, "local:/x");
		expect(result.pass).toBe(false);
		expect(result.failures).toContain("provider.capability must be 'source:v1'");
		expect(result.failures).toContain("provider.pluginId must be a non-empty string");
		expect(result.failures).toContain("provider.kinds must be non-empty");
		expect(result.failures.some((failure) => failure.includes("materialize() threw"))).toBe(
			true,
		);
	});
});
