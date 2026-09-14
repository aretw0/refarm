import { describe, expect, it } from "vitest";

import { buildScopeDoctorRecommendations, type ScopeComparison } from "./scope-doctor.js";

/** The operator standing in a repository while the node lives in their home — the shape
 *  that produced the evening this file exists for. */
function diverged(overrides: Partial<ScopeComparison> = {}): ScopeComparison {
	return {
		operatorConfigPath: "/repo/.refarm/config.json",
		nodeConfigPath: "/home/op/.refarm/config.json",
		operatorPolicyPath: "/repo/.refarm/auth-policy.json",
		nodePolicyPath: "/home/op/.refarm/auth-policy.json",
		...overrides,
	};
}

const allPresent = () => true;
const nonePresent = () => false;

describe("buildScopeDoctorRecommendations", () => {
	it("says nothing when the operator is standing where the node lives", () => {
		const same: ScopeComparison = {
			operatorConfigPath: "/home/op/.refarm/config.json",
			nodeConfigPath: "/home/op/.refarm/config.json",
			operatorPolicyPath: "/home/op/.refarm/auth-policy.json",
			nodePolicyPath: "/home/op/.refarm/auth-policy.json",
		};
		expect(buildScopeDoctorRecommendations(same, allPresent)).toEqual([]);
	});

	it("says nothing when this directory declares nothing of its own", () => {
		// Standing somewhere without declarations is the normal case. A doctor that warns
		// about it every run teaches the operator to stop reading doctor.
		expect(buildScopeDoctorRecommendations(diverged(), nonePresent)).toEqual([]);
	});

	it("names the auth policy divergence first, because its failure is silent elsewhere", () => {
		const findings = buildScopeDoctorRecommendations(diverged(), allPresent);
		expect(findings.map((finding) => finding.diagnostic)).toEqual([
			"scope:auth-policy-divergence",
			"scope:config-divergence",
		]);
	});

	it("names BOTH files, because a path the operator cannot see is not a diagnosis", () => {
		const [policy] = buildScopeDoctorRecommendations(diverged(), allPresent);
		expect(policy?.summary).toContain("/repo/.refarm/auth-policy.json");
		expect(policy?.summary).toContain("/home/op/.refarm/auth-policy.json");
		expect(policy?.command).toBe("refarm auth list --json");
	});

	it("never fails the host — a directory with its own declarations is legitimate", () => {
		// `refarm doctor`'s failures gate other flows, and standing in a project that
		// declares things is a supported way to work, not a broken node.
		for (const finding of buildScopeDoctorRecommendations(diverged(), allPresent)) {
			expect(finding.severity).toBe("warning");
		}
	});

	it("reports the config divergence on its own when only that file is local", () => {
		const findings = buildScopeDoctorRecommendations(
			diverged(),
			(filePath) => filePath === "/repo/.refarm/config.json",
		);
		expect(findings.map((finding) => finding.diagnostic)).toEqual(["scope:config-divergence"]);
	});
});
