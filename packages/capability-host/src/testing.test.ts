import { describe, expect, it } from "vitest";

import { createCapabilityTestHarness } from "./testing.js";

describe("@refarm.dev/capability-host/testing", () => {
	it("exposes the capability test harness from the host boundary", async () => {
		const harness = createCapabilityTestHarness();
		const registry = {
			list: () => [
				{
					name: "ping",
					summary: "Ping",
					run: () => ({ ok: true, command: "ping", operation: "test", pong: true }),
				},
			],
		};

		await expect(harness.runVerb(registry as never, "ping")).resolves.toMatchObject({
			ok: true,
			pong: true,
		});
	});
});
