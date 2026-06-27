import { describe, expect, it, vi } from "vitest";
import { createCapabilitiesCommand } from "../../src/commands/capabilities.js";

describe("capabilities command", () => {
	it("prints the compact capability index as JSON", async () => {
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createCapabilitiesCommand().parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			command: "capabilities",
			operation: "index",
			ok: true,
			schemaVersion: 1,
			count: 7,
			filter: { tags: [], states: [] },
			capabilities: expect.arrayContaining([
				expect.objectContaining({
					id: "project-handoff.governed",
					activation: {
						command: "refarm project handoff validate --json",
						sdk: "@refarm.dev/cli/project-handoff",
					},
				}),
			]),
			nextCommands: [],
		});
		logSpy.mockRestore();
	});

	it("filters capabilities by tag", async () => {
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createCapabilitiesCommand().parseAsync([
			"--tag",
			"daily-driver",
			"--json",
		], { from: "user" });

		const payload = JSON.parse(logs.join("\n")) as {
			capabilities: Array<{ id: string }>;
			count: number;
		};
		expect(payload.count).toBe(2);
		expect(payload.capabilities.map((capability) => capability.id)).toEqual([
			"runtime-agent.ask",
			"stream-observation.ui",
		]);
		logSpy.mockRestore();
	});

	it("filters capabilities by policy state", async () => {
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createCapabilitiesCommand().parseAsync([
			"--state",
			"planned",
			"--json",
		], { from: "user" });

		const payload = JSON.parse(logs.join("\n")) as {
			capabilities: Array<{ id: string; policy: { state: string } }>;
			count: number;
			filter: { states: string[] };
		};
		expect(payload.count).toBe(2);
		expect(payload.filter.states).toEqual(["planned"]);
		expect(payload.capabilities.map((capability) => capability.id)).toEqual([
			"runtime-agent.worker-profiles",
			"scheduler.local-jobs",
		]);
		expect(
			payload.capabilities.every(
				(capability) => capability.policy.state === "planned",
			),
		).toBe(true);
		logSpy.mockRestore();
	});
});
