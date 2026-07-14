import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { createDelegateRunCapability, defaultDelegationArtifacts } from "./live-delegation.js";

describe("delegate-run verb — a plugin orchestrating the agent (mount + guards)", () => {
	it("is mounted in the bench registry with an IDE command hint", () => {
		const verb = buildRegistry().get("delegate-run");
		if (!verb || "actions" in verb) throw new Error("delegate-run verb not mounted");
		expect(verb.summary).toContain("PERSONA");
		expect(verb.renderers?.ide).toMatchObject({ command: "dgk.delegate-run" });
	});

	it("rejects an empty task before touching the runtime", async () => {
		const verb = createDelegateRunCapability();
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			error: string;
		};
		expect(env.ok).toBe(false);
		expect(env.error).toBe("no_task");
	});

	it("points the delegate at the real, tested delegate plugin artifact", () => {
		const artifacts = defaultDelegationArtifacts();
		expect(artifacts.delegateWasm).toContain("packages/delegate/dist/plugin.wasm");
		expect(artifacts.agentWasm).toContain("packages/agent/dist/agent.wasm");
	});
});
