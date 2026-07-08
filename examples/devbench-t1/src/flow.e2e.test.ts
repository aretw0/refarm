import { type CapabilityEntry } from "@refarm.dev/capabilities-v1";
import { createCapabilityTestHarness } from "@refarm.dev/capabilities-v1/testing";
import { describe, expect, it } from "vitest";

import { buildDevbenchHost, buildRegistry } from "./cli.js";

const harness = createCapabilityTestHarness();

/**
 * The T1 flow through devbench's own CLI registry — PROCESS mode. It proves the
 * developer's angle: a coding-agent EXTENSION declares itself and its verbs surface by
 * themselves (the machine visible), and an inspector shows the mechanism.
 */
describe("devbench T1 — the developer's extension bench (process mode)", () => {
	it("the coding-agent's verbs surface into the CLI from its manifest (no app run())", () => {
		const names = buildRegistry().list().map((e: CapabilityEntry) => e.name);
		// agent:code / agent:review → `code` / `review`, surfaced by the bridge.
		expect(names).toEqual(expect.arrayContaining(["code", "review"]));
		// The neutral blocks are there too — the extension coexists with them.
		expect(names).toEqual(
			expect.arrayContaining(["source", "records", "vault", "extension", "status", "actions"]),
		);
	});

	it("declares dgk as the white-label host and exposes surface actions", () => {
		const host = buildDevbenchHost();
		expect(host.program().name()).toBe("dgk");
		expect(host.baseModel()).toMatchObject({
			command: "dgk",
			operation: "base",
			nextCommand: "dgk extension --json",
		});
		expect(host.surfaceActions()).toEqual([
			expect.objectContaining({
				id: "inspect-extension",
				intent: "extension:inspect",
				payload: expect.objectContaining({ command: "dgk extension --json" }),
			}),
		]);
	});

	it("extension exposes the mechanism: declaration → surfaced verbs", async () => {
		const env = await harness.runVerb(buildRegistry(), "extension");
		expect(env.ok).toBe(true);
		expect(env.declared).toEqual(["agent:code", "agent:review"]);
		const surfaced = (env.surfaced as Array<{ verb: string }>).map((s) => s.verb).sort();
		expect(surfaced).toEqual(["code", "review"]);
	});

	it("a surfaced agent verb dispatches across the bridge (two-phase receipt)", async () => {
		const env = await harness.runVerb<{ ok: boolean; verb: string; effortId: string; replyRef: string }>(buildRegistry(), "code", {
			args: { args: ['prompt="add a test"'] },
			options: {},
			json: true,
		});
		expect(env.ok).toBe(true);
		expect(env.verb).toBe("code");
		expect(env.replyRef).toBe(env.effortId);
	});
});
