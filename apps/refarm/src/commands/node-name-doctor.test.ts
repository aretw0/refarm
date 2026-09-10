import { describe, expect, it } from "vitest";

import {
	buildNodeNameDoctorRecommendations,
	suggestNodeName,
	type NodeIdentitySnapshot,
} from "./node-name-doctor.js";

describe("suggestNodeName", () => {
	it("builds a name from a short slice of the node's own opaque id", () => {
		expect(suggestNodeName("f17151b4-35f2-4f46-b43a-0ff03514a874")).toBe("node-f17151");
	});

	it("never reaches outside the id it was given — no hostname, no env probe", () => {
		// Same id, called twice: the result must depend on nothing but the argument. This is
		// what "declared, never detected" means for a SUGGESTION, not just a declaration.
		const first = suggestNodeName("aaaaaaaa-0000-0000-0000-000000000000");
		const second = suggestNodeName("aaaaaaaa-0000-0000-0000-000000000000");
		expect(first).toBe(second);
	});
});

describe("buildNodeNameDoctorRecommendations", () => {
	it("says nothing when no node is running (descriptor is null)", () => {
		expect(buildNodeNameDoctorRecommendations(null)).toEqual([]);
	});

	it("says nothing when the node already declared a name", () => {
		const named: NodeIdentitySnapshot = { nodeName: "sede", nodeId: "f17151b4-…" };
		expect(buildNodeNameDoctorRecommendations(named)).toEqual([]);
	});

	it("says nothing when the node has no opaque id yet — nothing to suggest FROM", () => {
		const noId: NodeIdentitySnapshot = {};
		expect(buildNodeNameDoctorRecommendations(noId)).toEqual([]);
	});

	it("suggests a name when the node has an id but has not declared one", () => {
		const unnamed: NodeIdentitySnapshot = { nodeId: "f17151b4-35f2-4f46-b43a-0ff03514a874" };
		const findings = buildNodeNameDoctorRecommendations(unnamed);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.diagnostic).toBe("node:unnamed");
	});

	it("is never a failure — an unnamed node is not a broken one", () => {
		const findings = buildNodeNameDoctorRecommendations({ nodeId: "f17151b4-…" });
		expect(findings[0]?.severity).toBe("warning");
	});

	it("names the exact config key and shows the suggested value, so the finding is actionable", () => {
		const [finding] = buildNodeNameDoctorRecommendations({
			nodeId: "f17151b4-35f2-4f46-b43a-0ff03514a874",
		});
		expect(finding?.action).toContain("node.name");
		expect(finding?.action).toContain("node-f17151");
		expect(finding?.action).toContain("config.json");
	});

	it("never claims to write anything — the action names it a suggestion the operator applies", () => {
		const [finding] = buildNodeNameDoctorRecommendations({ nodeId: "f17151b4-…" });
		expect(finding?.action.toLowerCase()).toContain("suggestion");
	});
});
