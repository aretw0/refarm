import {
	isCapabilityGroup,
	type CapabilityEntry,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";

/**
 * The T1 flow through devbench's own CLI registry — PROCESS mode. It proves the
 * developer's angle: a coding-agent EXTENSION declares itself and its verbs surface by
 * themselves (the machine visible), and an inspector shows the mechanism.
 */
async function runVerb(
	reg: ReturnType<typeof buildRegistry>,
	name: string,
): Promise<Record<string, unknown>> {
	const entry = reg.list().find((e) => e.name === name);
	if (!entry || isCapabilityGroup(entry)) throw new Error(`no verb ${name}`);
	return (await entry.run({ args: {}, options: {}, json: true })) as unknown as Record<
		string,
		unknown
	>;
}

describe("devbench T1 — the developer's extension bench (process mode)", () => {
	it("the coding-agent's verbs surface into the CLI from its manifest (no app run())", () => {
		const names = buildRegistry().list().map((e: CapabilityEntry) => e.name);
		// agent:code / agent:review → `code` / `review`, surfaced by the bridge.
		expect(names).toEqual(expect.arrayContaining(["code", "review"]));
		// The neutral blocks are there too — the extension coexists with them.
		expect(names).toEqual(expect.arrayContaining(["source", "records", "vault"]));
	});

	it("ext-inspect exposes the mechanism: declaration → surfaced verbs", async () => {
		const env = await runVerb(buildRegistry(), "ext-inspect");
		expect(env.ok).toBe(true);
		expect(env.declared).toEqual(["agent:code", "agent:review"]);
		const surfaced = (env.surfaced as Array<{ verb: string }>).map((s) => s.verb).sort();
		expect(surfaced).toEqual(["code", "review"]);
	});

	it("a surfaced agent verb dispatches across the bridge (two-phase receipt)", async () => {
		const reg = buildRegistry();
		const code = reg.list().find((e) => e.name === "code");
		if (!code || isCapabilityGroup(code)) throw new Error("no code verb");
		const env = (await code.run({
			args: { args: ['prompt="add a test"'] },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; verb: string; effortId: string; replyRef: string };
		expect(env.ok).toBe(true);
		expect(env.verb).toBe("code");
		expect(env.replyRef).toBe(env.effortId);
	});
});
