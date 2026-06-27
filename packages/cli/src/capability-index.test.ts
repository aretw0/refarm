import { describe, expect, it } from "vitest";
import {
	buildRefarmCapabilityIndex,
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
			"agent-finish.lanes",
			"policy.shell-audit",
			"stream-observation.ui",
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
});
