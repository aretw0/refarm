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
});
