import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";

describe("ide verb — the editor surface of the bench", () => {
	it("projects the bench's verbs as namespaced editor commands + a tree", async () => {
		const verb = buildRegistry().get("ide");
		if (!verb || "actions" in verb) throw new Error("ide verb not mounted");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			namespace: string;
			commandCount: number;
			commands: Array<{ commandId: string; group: string }>;
			tree: Array<{ group: string; commands: string[] }>;
		};
		expect(env.namespace).toBe("dgk");
		expect(env.commandCount).toBeGreaterThan(5);
		// The headline verbs are projected as dgk.* commands.
		const ids = env.commands.map((c) => c.commandId);
		expect(ids).toContain("dgk.agent-run");
		expect(ids).toContain("dgk.governance-poc");
		// Grouped into a tree (governance verbs under their section).
		const governance = env.tree.find((t) => t.group === "governance");
		expect(governance?.commands).toEqual(expect.arrayContaining(["dgk.extension-develop", "dgk.extension-verify"]));
	});

	it("declare once → everywhere: the headline live verbs reach BOTH web and IDE", () => {
		// T1's central claim, as a regression guard: the WASM-recursion + governance verbs
		// each declare renderers.web (a route) AND renderers.ide (a command) — so one
		// declaration lights them up on the web face and the editor, not just the TUI.
		const reg = buildRegistry();
		const headline = ["agent-run", "delegate-run", "code-ops", "governance-poc", "extension-develop", "extension-verify"];
		for (const name of headline) {
			const entry = reg.get(name);
			if (!entry || "actions" in entry) throw new Error(`${name} not mounted`);
			const ide = entry.renderers?.ide as { command?: string } | undefined;
			expect(entry.renderers?.web?.route, `${name} must declare a web route`).toBeTruthy();
			expect(ide?.command, `${name} must declare an IDE command`).toBeTruthy();
			expect(entry.renderers?.tui?.section, `${name} must keep its TUI section`).toBeTruthy();
		}
	});
});
