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

	it("DRIFT GUARD: every verb declaring renderers.ide reaches the manifest (declare once → IDE)", async () => {
		// The projection must never SILENTLY DROP a verb that opted into the editor. This
		// catches the exact class of bug where a new verb declares renderers.ide but the
		// generated manifest (or a stale checked-out one) lacks its command.
		const reg = buildRegistry();
		const idIde = reg
			.list()
			.filter((e): e is typeof e & { renderers: { ide: { command: string } } } => {
				const ide = (e as { renderers?: { ide?: { command?: string } } }).renderers?.ide;
				return typeof ide?.command === "string";
			})
			.map((e) => e.renderers.ide.command);
		// The bench declares IDE commands for its live verbs — the set must be non-empty.
		expect(idIde.length).toBeGreaterThanOrEqual(3);

		const verb = reg.get("vscode-manifest");
		if (!verb || "actions" in verb) throw new Error("vscode-manifest verb not mounted");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			manifest: { contributes: { commands: Array<{ command: string }> } };
		};
		const emitted = new Set(env.manifest.contributes.commands.map((c) => c.command));
		for (const command of idIde) {
			expect(emitted.has(command), `IDE-declared verb ${command} must reach the vscode manifest`).toBe(true);
		}
	});
});
