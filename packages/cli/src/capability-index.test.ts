import { describe, expect, it } from "vitest";
import {
	buildRefarmCapabilityIndex,
	buildRefarmReferenceDriverSupplyMap,
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
			"runtime-agent.session-tree",
			"runtime-agent.structured-io",
			"runtime-agent.code-ops",
		]);
	});

	it("maps reference-driver primitives to publication supply channels", () => {
		const supplyMap = buildRefarmReferenceDriverSupplyMap();

		expect(supplyMap.schemaVersion).toBe(REFARM_CAPABILITY_INDEX_SCHEMA_VERSION);
		expect(supplyMap.discoverySdk).toBe("@refarm.dev/cli/capability-index");
		expect(supplyMap.smokeCommand).toBe("pnpm run reference-driver:smoke");
		expect(supplyMap.entries.map((entry) => entry.capabilityId)).toEqual([
			"runtime-agent.session-tree",
			"runtime-agent.structured-io",
			"runtime-agent.code-ops",
		]);
		expect(supplyMap.entries).toEqual(
			expect.arrayContaining([
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
});
