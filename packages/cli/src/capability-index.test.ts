import { describe, expect, it } from "vitest";
import {
	buildRefarmCapabilityIndex,
	buildReferenceDriverSupplyMap,
	buildReferenceDriverSupplyPreflight,
	getRefarmCapabilityDescriptors,
	REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
} from "./capability-index.js";

describe("capability index", () => {
	it("builds a compact, stable descriptor index", () => {
		const index = buildRefarmCapabilityIndex();
		const ids = index.capabilities.map((capability) => capability.id);

		expect(index.schemaVersion).toBe(REFARM_CAPABILITY_INDEX_SCHEMA_VERSION);
		expect(ids).toEqual([
			"runtime-agent.ask",
			"project-handoff.governed",
			"project-automations.governed",
			"agent-finish.lanes",
			"policy.shell-audit",
			"stream-observation.ui",
			"runtime-agent.worker-profiles",
			"runtime-agent.session-tree",
			"runtime-agent.structured-io",
			"runtime-agent.code-ops",
			"scheduler.local-jobs",
		]);
		expect(new Set(ids).size).toBe(ids.length);
		expect(index.capabilities).toEqual(getRefarmCapabilityDescriptors());
	});

	it("keeps descriptors small enough for progressive discovery", () => {
		const index = buildRefarmCapabilityIndex();

		for (const capability of index.capabilities) {
			expect(capability.description.length).toBeLessThanOrEqual(140);
			expect(capability.requirements.length).toBeLessThanOrEqual(4);
			expect(capability.policy.evidence.length).toBeLessThanOrEqual(3);
			expect(capability.tags.length).toBeLessThanOrEqual(4);
		}
	});

	it("surfaces runtime-agent reference-driver primitives", () => {
		const index = buildRefarmCapabilityIndex();
		const referenceDriverIds = index.capabilities
			.filter((capability) => capability.tags.includes("reference-driver"))
			.map((capability) => capability.id);

		expect(referenceDriverIds).toEqual([
			"runtime-agent.ask",
			"runtime-agent.worker-profiles",
			"runtime-agent.session-tree",
			"runtime-agent.structured-io",
			"runtime-agent.code-ops",
		]);
	});

	it("maps reference-driver primitives to publication supply channels", () => {
		const supplyMap = buildReferenceDriverSupplyMap();

		expect(supplyMap.schemaVersion).toBe(REFARM_CAPABILITY_INDEX_SCHEMA_VERSION);
		expect(supplyMap.discoverySdk).toBe("@refarm.dev/cli/capability-index");
		expect(supplyMap.smokeCommand).toBe("pnpm run reference-driver:smoke");
		expect(supplyMap.entries.map((entry) => entry.capabilityId)).toEqual([
			"runtime-agent.ask",
			"runtime-agent.worker-profiles",
			"runtime-agent.session-tree",
			"runtime-agent.structured-io",
			"runtime-agent.code-ops",
		]);
		expect(
			supplyMap.entries.every((entry) => entry.referenceLessons.length > 0),
		).toBe(true);
		expect(
			supplyMap.entries.every((entry) => entry.referenceSources.length > 0),
		).toBe(true);
		expect(supplyMap.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capabilityId: "runtime-agent.ask",
					referenceSources: expect.arrayContaining([
						{
							name: "Hermes Agent README",
							url: "https://github.com/NousResearch/hermes-agent",
						},
						{
							name: "Pi coding-agent README",
							url:
								"https://github.com/earendil-works/pi/tree/main/packages/coding-agent",
						},
					]),
					referenceLessons: [
						"Hermes: one interaction loop can serve CLI and messaging gateways, but the gateway must stay behind one contract.",
						"Pi: steering, follow-up, abort, and session state are part of the embeddable driver protocol.",
						"Codex/Claude: headless asks need machine-readable handoffs and lifecycle enforcement, not scraped terminal text.",
					],
					promotionProofTargets: [
						"interaction lifecycle: prompt accepted, streamed, aborted, resumed, and reported through stable JSON events",
						"operator steering: follow-up and redirect queue semantics persist into session/task handoffs",
						"gateway parity: CLI, app, and future RPC/messaging surfaces share the same ask contract",
						"budget visibility: model route, token/cost use, retries, and stop conditions are visible in resume/check handoffs",
					],
					targets: expect.arrayContaining([
						expect.objectContaining({
							channel: "runtime",
							name: "runtime-agent ask command",
							status: "candidate",
						}),
						expect.objectContaining({
							channel: "npm",
							name: "@refarm.dev/pi-agent",
							status: "hold",
						}),
					]),
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.worker-profiles",
					referenceLessons: [
						"Codex/Claude: isolate subagent context and return compact summaries.",
						"Hermes: keep delegation bounded; do not make worker fanout ambient.",
						"Pi: expose embeddable SDK/RPC shapes without forcing product labels.",
					],
					promotionProofTargets: [
						"policy bundle: tool allowlist, filesystem root guard, trusted plugin guard, and model route validation",
						"worker lifecycle: cancellable task state, resume policy, and fanout stop propagation",
						"operator visibility: stream chunks, session entries, task status, and resume handoffs",
						"budget ledger: provider token accounting, max turns, max parallel workers, and stop condition",
					],
					targets: expect.arrayContaining([
						expect.objectContaining({
							channel: "npm",
							name: "@refarm.dev/cli",
							export: "@refarm.dev/cli",
							status: "exported",
						}),
						expect.objectContaining({
							channel: "npm",
							name: "@refarm.dev/cli worker result envelope",
							export: "@refarm.dev/cli",
							status: "exported",
						}),
						expect.objectContaining({
							channel: "runtime",
							name: "worker tool promotion gate",
							status: "candidate",
						}),
						expect.objectContaining({
							channel: "npm",
							name: "@refarm.dev/pi-agent",
							status: "hold",
						}),
					]),
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.session-tree",
					targets: expect.arrayContaining([
						expect.objectContaining({
							channel: "npm",
							name: "@refarm.dev/cli",
							export: "@refarm.dev/cli/capability-index",
							status: "exported",
						}),
						expect.objectContaining({
							channel: "npm",
							name: "@refarm.dev/pi-agent",
							status: "hold",
						}),
					]),
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.structured-io",
					targets: expect.arrayContaining([
						expect.objectContaining({
							channel: "wit",
							name: "refarm:agent-tools@0.1.0",
							status: "internal",
						}),
					]),
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.code-ops",
					targets: expect.arrayContaining([
						expect.objectContaining({
							channel: "wit",
							name: "refarm:plugin@0.1.0",
							status: "internal",
						}),
						expect.objectContaining({
							channel: "crate",
							name: "refarm-plugin-wit",
							status: "internal",
						}),
						expect.objectContaining({
							channel: "crate",
							name: "refarm-tractor",
							status: "hold",
						}),
					]),
				}),
			]),
		);
	});

	it("builds a plan-only supply preflight for release posture checks", () => {
		const preflight = buildReferenceDriverSupplyPreflight();

		expect(preflight).toMatchObject({
			schemaVersion: REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
			source: "@refarm.dev/cli/capability-index",
			mode: "plan-only",
			summary: [
				{ status: "candidate", count: 3 },
				{ status: "internal", count: 3 },
				{ status: "hold", count: 5 },
			],
		});
		expect(preflight.targets.map((target) => target.status)).not.toContain("exported");
		expect(preflight.targets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capabilityId: "runtime-agent.ask",
					channel: "runtime",
					name: "runtime-agent ask command",
					status: "candidate",
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.worker-profiles",
					channel: "runtime",
					name: "worker tool promotion gate",
					status: "candidate",
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.session-tree",
					channel: "runtime",
					name: "session tree command",
					status: "candidate",
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.code-ops",
					channel: "crate",
					name: "refarm-plugin-wit",
					status: "internal",
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.structured-io",
					channel: "npm",
					name: "@refarm.dev/pi-agent",
					status: "hold",
				}),
			]),
		);
		expect(preflight.nextDecisions).toHaveLength(5);
	});
});
