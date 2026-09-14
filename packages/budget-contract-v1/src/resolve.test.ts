import { describe, expect, it } from "vitest";
import { resolveBudget } from "./resolve.js";

const node = {
	ceiling: { deadlineMs: 600_000, maxTokens: 500_000, maxUsd: 10 },
	default: { deadlineMs: 45_000, maxTokens: 100_000, maxUsd: 1 },
};

describe("resolveBudget", () => {
	it("uses the node default when nobody declares anything", () => {
		const resolved = resolveBudget({ node });
		expect(resolved.deadlineMs).toEqual({
			effective: 45_000,
			declared: null,
			boundBy: "default",
		});
	});

	it("lets the spawner declare above the default and below the ceiling", () => {
		const resolved = resolveBudget({ node, declared: { deadlineMs: 300_000 } });
		expect(resolved.deadlineMs).toEqual({
			effective: 300_000,
			declared: 300_000,
			boundBy: "declared",
		});
	});

	it("clamps to the node ceiling and says the node did it", () => {
		const resolved = resolveBudget({ node, declared: { deadlineMs: 9_000_000 } });
		expect(resolved.deadlineMs).toEqual({
			effective: 600_000,
			declared: 9_000_000,
			boundBy: "node",
		});
	});

	it("clamps to a tighter workspace ceiling and says the workspace did it", () => {
		const resolved = resolveBudget({
			node,
			workspace: { ceiling: { deadlineMs: 120_000 } },
			declared: { deadlineMs: 300_000 },
		});
		expect(resolved.deadlineMs).toEqual({
			effective: 120_000,
			declared: 300_000,
			boundBy: "workspace",
		});
	});

	it("refuses to let a workspace grant capacity the node does not have", () => {
		const resolved = resolveBudget({
			node,
			workspace: { ceiling: { deadlineMs: 9_000_000 } },
			declared: { deadlineMs: 9_000_000 },
		});
		expect(resolved.deadlineMs.effective).toBe(600_000);
		expect(resolved.deadlineMs.boundBy).toBe("node");
	});

	it("prefers a workspace default over the node default", () => {
		const resolved = resolveBudget({
			node,
			workspace: { default: { deadlineMs: 90_000 } },
		});
		expect(resolved.deadlineMs).toEqual({
			effective: 90_000,
			declared: null,
			boundBy: "default",
		});
	});

	it("resolves each axis independently", () => {
		const resolved = resolveBudget({
			node,
			declared: { deadlineMs: 9_000_000, maxTokens: 1_000 },
		});
		expect(resolved.deadlineMs.boundBy).toBe("node");
		expect(resolved.maxTokens).toEqual({
			effective: 1_000,
			declared: 1_000,
			boundBy: "declared",
		});
		expect(resolved.maxUsd.boundBy).toBe("default");
	});
});
