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
});
