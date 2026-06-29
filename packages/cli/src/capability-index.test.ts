import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildCapabilityIndex,
	buildRefarmCapabilityIndex,
	buildReferenceDriverSupplyMap,
	buildReferenceDriverSupplyPreflight,
	CAPABILITY_INDEX_SCHEMA_VERSION,
	getCapabilityDescriptors,
	getRefarmCapabilityDescriptors,
	REFARM_CAPABILITY_INDEX_SCHEMA_VERSION,
} from "./capability-index.js";

describe("capability index", () => {
	it("documents reference-driver lessons and sources in the CLI README", () => {
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

		expect(readme).toMatch(/primary\s+source references/);
		expect(readme).toContain("adoptionCriteria");
		expect(readme).toContain("referenceLessons");
		expect(readme).toContain("referenceSources");
		expect(readme).toContain("full research note");
	});

	it("builds a compact, stable descriptor index", () => {
		const index = buildCapabilityIndex();
		const ids = index.capabilities.map((capability) => capability.id);

		expect(index.schemaVersion).toBe(CAPABILITY_INDEX_SCHEMA_VERSION);
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
		expect(index.capabilities).toEqual(getCapabilityDescriptors());
		expect(buildRefarmCapabilityIndex).toBe(buildCapabilityIndex);
		expect(getRefarmCapabilityDescriptors).toBe(getCapabilityDescriptors);
		expect(REFARM_CAPABILITY_INDEX_SCHEMA_VERSION).toBe(
			CAPABILITY_INDEX_SCHEMA_VERSION,
		);
	});

	it("keeps descriptors small enough for progressive discovery", () => {
		const index = buildCapabilityIndex();

		for (const capability of index.capabilities) {
			expect(capability.description.length).toBeLessThanOrEqual(140);
			expect(capability.requirements.length).toBeLessThanOrEqual(4);
			expect(capability.policy.evidence.length).toBeLessThanOrEqual(3);
			expect(capability.tags.length).toBeLessThanOrEqual(4);
		}
	});

	it("surfaces runtime-agent reference-driver primitives", () => {
		const index = buildCapabilityIndex();
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
		expect(supplyMap.publicationBoundary).toEqual({
			discoveryPackage: "@refarm.dev/cli",
			discoverySubpath: "@refarm.dev/cli/capability-index",
			publicationState: "boundary-review",
			consumerInstallPolicy: "not-vault-seed-ready",
			runtimeExecutionState: "private",
			note: expect.stringContaining("@refarm.dev/cli is not a vault-seed-ready leaf"),
		});
		expect(supplyMap.adoptionCriteria.map((criterion) => criterion.id)).toEqual([
			"interaction-lifecycle",
			"session-portability",
			"steering-control",
			"worker-isolation",
			"policy-hooks",
			"skill-plugin-compatibility",
			"gateway-parity",
			"budget-observability",
		]);
		expect(supplyMap.adoptionCriteria).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "worker-isolation",
					requirement: expect.stringContaining("explicit context packets"),
					proof: expect.stringContaining("@refarm.dev/cli/worker-profile"),
					consumerBoundary: expect.stringContaining("ambient fanout"),
				}),
				expect.objectContaining({
					id: "gateway-parity",
					requirement: expect.stringContaining("one ask/session/worker contract"),
					consumerBoundary: expect.stringContaining("product routes"),
				}),
			]),
		);
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
						{
							name: "OpenAI Codex non-interactive mode",
							url: "https://developers.openai.com/codex/codex-manual.md",
						},
						{
							name: "Claude Code hooks reference",
							url: "https://docs.anthropic.com/en/docs/claude-code/hooks.md",
						},
					]),
					referenceLessons: [
						"Hermes: one interaction loop can serve CLI and messaging gateways, but the gateway must stay behind one contract.",
						"Pi: steering, follow-up, abort, and session state are part of the embeddable driver protocol.",
						"Codex/Claude: headless asks need machine-readable success and failure events, lifecycle hooks, and durable handoffs, not scraped terminal text.",
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
							name: "@refarm.dev/cli interaction driver",
							export: "@refarm.dev/cli/interaction-driver",
							eventContract: {
								format: "json-events",
								requiredEvents: [
									"accepted",
									"streamed",
									"completed",
									"failed",
								],
								terminalEvents: ["completed", "failed"],
							},
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
					capabilityId: "runtime-agent.worker-profiles",
					referenceSources: expect.arrayContaining([
						{
							name: "OpenAI Codex subagents",
							url: "https://developers.openai.com/codex/codex-manual.md",
						},
						{
							name: "Claude Code subagents",
							url: "https://docs.anthropic.com/en/docs/claude-code/sub-agents.md",
						},
					]),
					referenceLessons: [
						"Codex/Claude: isolate subagent context and return compact summaries.",
						"Hermes: keep delegation bounded; do not make worker fanout ambient.",
						"Pi: expose embeddable SDK/RPC shapes without forcing product labels.",
						"Refarm: provider token use, max turns, max parallelism, and stop condition belong in the worker descriptor before runtime dispatch exists.",
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
							name: "@refarm.dev/cli worker profile SDK",
							export: "@refarm.dev/cli/worker-profile",
							budgetContract: {
								tokenUse: "provider",
								maxTurns: 8,
								maxParallel: 4,
								stopConditionRequired: true,
							},
							status: "exported",
						}),
						expect.objectContaining({
							channel: "npm",
							name: "@refarm.dev/cli worker result envelope",
							export: "@refarm.dev/cli/worker-profile",
							status: "exported",
						}),
						expect.objectContaining({
							channel: "runtime",
							name: "worker tool promotion gate",
							budgetContract: {
								tokenUse: "provider",
								maxTurns: 8,
								maxParallel: 4,
								stopConditionRequired: true,
							},
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
			publicationBoundary: {
				discoveryPackage: "@refarm.dev/cli",
				discoverySubpath: "@refarm.dev/cli/capability-index",
				publicationState: "boundary-review",
				consumerInstallPolicy: "not-vault-seed-ready",
				runtimeExecutionState: "private",
				note: expect.stringContaining("runtime execution stays private"),
			},
			adoptionCriteria: expect.arrayContaining([
				expect.objectContaining({
					id: "worker-isolation",
					requirement: expect.stringContaining("explicit context packets"),
				}),
				expect.objectContaining({
					id: "budget-observability",
					requirement: expect.stringContaining("Model route"),
				}),
			]),
			summary: [
				{ status: "candidate", count: 3 },
				{ status: "internal", count: 3 },
				{ status: "hold", count: 5 },
			],
			proofSummary: {
				blockedTargetCount: 11,
				targetsWithPromotionProofTargets: 4,
				uniquePromotionProofTargetCount: 8,
				targetsWithBudgetContract: 1,
			},
			promotionQueue: expect.arrayContaining([
				{
					rank: 1,
					capabilityId: "runtime-agent.ask",
					status: "candidate",
					channel: "runtime",
					name: "runtime-agent ask command",
					proofTargetCount: 4,
					hasBudgetContract: false,
					nextDecision: expect.stringContaining("Keep ask as the local daily-driver spine"),
				},
				{
					rank: 2,
					capabilityId: "runtime-agent.worker-profiles",
					status: "candidate",
					channel: "runtime",
					name: "worker tool promotion gate",
					proofTargetCount: 4,
					hasBudgetContract: true,
					nextDecision: expect.stringContaining("Keep agents-as-tools plan-only"),
				},
				{
					rank: 4,
					capabilityId: "runtime-agent.structured-io",
					status: "internal",
					channel: "wit",
					name: "refarm:agent-tools@0.1.0",
					proofTargetCount: 0,
					hasBudgetContract: false,
					nextDecision: expect.stringContaining("Promote structured-io through WIT"),
				},
			]),
		});
		expect(preflight.targets.map((target) => target.status)).not.toContain("exported");
		expect(preflight.promotionQueue).toHaveLength(11);
		expect(preflight.promotionQueue.map((item) => item.status)).toEqual([
			"candidate",
			"candidate",
			"candidate",
			"internal",
			"internal",
			"internal",
			"hold",
			"hold",
			"hold",
			"hold",
			"hold",
		]);
		expect(preflight.targets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capabilityId: "runtime-agent.ask",
					channel: "runtime",
					name: "runtime-agent ask command",
					promotionProofTargets: [
						"interaction lifecycle: prompt accepted, streamed, aborted, resumed, and reported through stable JSON events",
						"operator steering: follow-up and redirect queue semantics persist into session/task handoffs",
						"gateway parity: CLI, app, and future RPC/messaging surfaces share the same ask contract",
						"budget visibility: model route, token/cost use, retries, and stop conditions are visible in resume/check handoffs",
					],
					status: "candidate",
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.worker-profiles",
					channel: "runtime",
					name: "worker tool promotion gate",
					promotionProofTargets: [
						"policy bundle: tool allowlist, filesystem root guard, trusted plugin guard, and model route validation",
						"worker lifecycle: cancellable task state, resume policy, and fanout stop propagation",
						"operator visibility: stream chunks, session entries, task status, and resume handoffs",
						"budget ledger: provider token accounting, max turns, max parallel workers, and stop condition",
					],
					status: "candidate",
				}),
				expect.objectContaining({
					capabilityId: "runtime-agent.session-tree",
					channel: "runtime",
					name: "session tree command",
					promotionProofTargets: [],
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
