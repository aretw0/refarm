import { describe, expect, it } from "vitest";
import { CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC } from "./context-doctor.js";
import type { Divergence } from "./context.js";
import { buildSovereignDivergenceDoctorRecommendations } from "./sovereign-divergence-doctor.js";

describe("buildSovereignDivergenceDoctorRecommendations", () => {
	it("is silent when nothing diverges — the ordinary case deserves silence", () => {
		expect(buildSovereignDivergenceDoctorRecommendations([])).toEqual([]);
	});

	it("reports a hash mismatch and names both sides", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: "plugin-hash-mismatch",
				summary:
					"Loaded plugin /home/op/.refarm/plugins/agent/plugin.wasm (22dbabbd) does not " +
					"match the built plugin packages/agent/dist/agent.wasm (544ef5b4).",
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:plugin-divergence");
		expect(out[0]?.severity).toBe("warning");
		expect(out[0]?.summary).toContain("22dbabbd");
		expect(out[0]?.summary).toContain("544ef5b4");
	});

	it("never proposes performing a restart on the operator's behalf", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{ kind: "plugin-hash-mismatch", summary: "x" },
		]);
		expect(out[0]?.action).toMatch(/operator|your call|not done for you/i);
	});

	it("reports plugin-hash-unknown as an unverified gap, never as a mismatch", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: "plugin-hash-unknown",
				summary: "The running node (pid 123) does not say which plugin it loaded.",
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:plugin-unknown");
		expect(out[0]?.diagnostic).not.toBe("sovereign:plugin-divergence");
		expect(out[0]?.summary).not.toMatch(/mismatch|diverge/i);
		expect(out[0]?.summary).toMatch(/gap in the checking/);
	});

	it("reports built-plugin-unknown as the same unverified gap, distinct from a mismatch", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: "built-plugin-unknown",
				summary: "No monorepo build of the agent plugin could be located from here.",
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:plugin-unknown");
		expect(out[0]?.summary).not.toMatch(/mismatch/i);
	});

	it("says nothing for a node that is simply not running — not a divergence to warn about", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{ kind: "node-not-running", summary: "No running node was found." },
		]);
		expect(out).toEqual([]);
	});

	it("reports an unloaded sovereign directory — D2 commits doctor to this, not just context", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: "unloaded-sovereign-dir",
				summary: "/home/op/.refarm is a sovereign directory that exists on disk but is not " +
					"the active home (/home/op/.refarm-active) — nothing loads it.",
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:unloaded-dir");
		expect(out[0]?.severity).toBe("warning");
		expect(out[0]?.summary).toContain("/home/op/.refarm");
		// It must read as confusing, not as proof the node is misbehaving.
		expect(out[0]?.summary).not.toMatch(/broken|misbehav|error/i);
	});

	it("never proposes removing the unloaded directory on the operator's behalf", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{ kind: "unloaded-sovereign-dir", summary: "/home/op/.refarm-old is unloaded." },
		]);
		expect(out[0]?.action).toMatch(/decide|operator/i);
		expect(out[0]?.action).not.toMatch(/^(delete|remove|rm )/i);
	});

	it("does not re-report the home divergence context-doctor.ts already covers", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC,
				summary: "Sovereign home and credential store home resolve to different directories.",
			},
		]);
		expect(out).toEqual([]);
	});

	it("reports the plugin mismatch and the unloaded dir, but stays silent on node-not-running, from a mixed list", () => {
		const divergences: Divergence[] = [
			{ kind: "node-not-running", summary: "No running node was found." },
			{
				kind: "plugin-hash-mismatch",
				summary: "Loaded (aaaa1111) does not match built (bbbb2222).",
			},
			{ kind: "unloaded-sovereign-dir", summary: "/home/op/.refarm-old is unloaded." },
		];
		const out = buildSovereignDivergenceDoctorRecommendations(divergences);
		expect(out).toHaveLength(2);
		expect(out.map((r) => r.diagnostic)).toEqual([
			"sovereign:plugin-divergence",
			"sovereign:unloaded-dir",
		]);
	});

	it("reports a base divergence and names the node's side", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: "base-divergence",
				summary:
					"The node declares SOVEREIGN_BASE=/home/s095407044, but this CLI resolves base to " +
					"/home/s095407044/git/rcdc5 (from cwd) — they disagree.",
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:base-divergence");
		expect(out[0]?.severity).toBe("warning");
		expect(out[0]?.summary).toContain("SOVEREIGN_BASE=/home/s095407044");
		expect(out[0]?.summary).toContain("The node declares");
	});

	it("never proposes changing either base value on the operator's behalf", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{ kind: "base-divergence", summary: "The node declares X, but this CLI resolves Y." },
		]);
		expect(out[0]?.action).toMatch(/operator|decide/i);
		expect(out[0]?.action).not.toMatch(/^(set|export|change)/i);
	});

	it("reports a namespace divergence and names the node's side", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: "namespace-divergence",
				summary:
					"The node declares REFARM_NAMESPACE=prod, but this CLI resolves namespace to default — they disagree.",
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:namespace-divergence");
		expect(out[0]?.severity).toBe("warning");
		expect(out[0]?.summary).toContain("REFARM_NAMESPACE=prod");
	});

	it("reports node-environment-unknown as a gap in the checking, never as a divergence", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{
				kind: "node-environment-unknown",
				summary:
					"The running node (pid 123) is up, but its own environment (/proc/123/environ) " +
					"could not be read — its declared base and namespace cannot be compared to this " +
					"CLI's at all. This is a gap in the checking, not agreement.",
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:environment-unknown");
		expect(out[0]?.diagnostic).not.toMatch(/divergence/);
		expect(out[0]?.summary).toMatch(/gap in the checking/);
		expect(out[0]?.summary).not.toMatch(/mismatch|diverge/i);
	});

	it("stays silent on node-not-running even when the sidecar is reachable is unspecified (default false)", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([
			{ kind: "node-not-running", summary: "No running node was found." },
		]);
		expect(out).toEqual([]);
	});

	it("stays silent on node-not-running when the sidecar is explicitly not reachable — the common case runtime:not-ready already names", () => {
		const out = buildSovereignDivergenceDoctorRecommendations(
			[{ kind: "node-not-running", summary: "No running node was found." }],
			false,
		);
		expect(out).toEqual([]);
	});

	it("reports the stale-descriptor/reachable-sidecar combination that neither signal alone covers", () => {
		const out = buildSovereignDivergenceDoctorRecommendations(
			[{ kind: "node-not-running", summary: "No running node was found." }],
			true,
		);
		expect(out).toHaveLength(1);
		expect(out[0]?.diagnostic).toBe("sovereign:stale-descriptor");
		expect(out[0]?.severity).toBe("warning");
		expect(out[0]?.summary).toMatch(/disagree/i);
	});

	it("never proposes restarting or deleting the descriptor on the operator's behalf for the stale-descriptor finding", () => {
		const out = buildSovereignDivergenceDoctorRecommendations(
			[{ kind: "node-not-running", summary: "No running node was found." }],
			true,
		);
		expect(out[0]?.action).toMatch(/operator|decide/i);
		expect(out[0]?.action).not.toMatch(/^(restart|delete|remove|rm )/i);
	});

	it("does not report the stale-descriptor combination when nothing diverged (sidecar reachable but node genuinely running)", () => {
		const out = buildSovereignDivergenceDoctorRecommendations([], true);
		expect(out).toEqual([]);
	});
});
