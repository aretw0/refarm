import {
	createCapabilityRegistry,
	type CapabilityDescriptor,
	type CapabilityGroup,
} from "@refarm.dev/capabilities";
import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCapabilityTestHarness } from "./testing.js";

const harness = createCapabilityTestHarness({ tempPrefix: "capability-test-" });

afterEach(() => {
	harness.cleanup();
});

const wallet: CapabilityDescriptor = {
	name: "wallet",
	summary: "Show wallet",
	run: () => ({ ok: true, total: 3 }) as never,
};

const records: CapabilityGroup = {
	name: "records",
	summary: "Records",
	actions: {
		correct: {
			name: "correct",
			summary: "Correct a record",
			args: [
				{ name: "ref", required: true },
				{ name: "state", required: true },
			],
			run: (input) =>
				({
					ok: true,
					ref: input.args.ref,
					state: input.args.state,
				}) as never,
		},
	},
};

describe("createCapabilityTestHarness", () => {
	it("runs flat verbs and group actions through the same registry shape as examples", async () => {
		const registry = createCapabilityRegistry([wallet, records]);

		await expect(harness.runVerb(registry, "wallet")).resolves.toMatchObject({
			ok: true,
			total: 3,
		});
		await expect(
			harness.runGroup(registry, "records", [
				"correct",
				"record:1",
				"verified",
			]),
		).resolves.toMatchObject({
			ok: true,
			ref: "record:1",
			state: "verified",
		});
	});

	it("owns temporary state paths and removes them during cleanup", () => {
		const statePath = harness.tempStatePath();
		writeFileSync(statePath, "{}");

		expect(existsSync(statePath)).toBe(true);
		harness.cleanup();
		expect(existsSync(dirname(statePath))).toBe(false);
	});
});
