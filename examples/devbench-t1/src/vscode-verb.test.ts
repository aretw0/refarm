import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";

describe("vscode-manifest verb — generate the extension package.json from the bench", () => {
	it("emits a VS Code manifest with a command per bench verb + a tree view", async () => {
		const verb = buildRegistry().get("vscode-manifest");
		if (!verb || "actions" in verb) throw new Error("vscode-manifest verb not mounted");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			commandCount: number;
			viewContainer: string;
			written: boolean;
			manifest: {
				name: string;
				contributes: { commands: Array<{ command: string }>; viewsContainers: { activitybar: Array<{ id: string }> } };
				activationEvents: string[];
			};
		};
		expect(env.commandCount).toBeGreaterThan(5);
		expect(env.written).toBe(false); // no writer in the test build → report only
		expect(env.manifest.name).toBe("dgk-extension-bench");
		const ids = env.manifest.contributes.commands.map((c) => c.command);
		expect(ids).toContain("dgk.agent-run");
		expect(ids).toContain("dgk.governance-poc");
		expect(env.manifest.activationEvents).toContain("onCommand:dgk.agent-run");
		expect(env.viewContainer).toBe("dgk-bench");
	});
});
