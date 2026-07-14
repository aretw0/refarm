import { describe, expect, it } from "vitest";

import { buildIdeModel } from "./ide-projector.js";
import { createCapabilityRegistry } from "./registry.js";
import type { CapabilityDescriptor } from "./types.js";
import { buildVscodeManifest } from "./vscode-manifest.js";

const agentRun: CapabilityDescriptor = {
	name: "agent-run",
	summary: "Run the coding agent live",
	renderers: { ide: { group: "Agent", title: "Run Coding Agent", icon: "play" } } as never,
	run: () => ({ ok: true }) as never,
};
const inspect: CapabilityDescriptor = {
	name: "extension",
	summary: "Inspect the extension",
	renderers: { tui: { section: "extension" } },
	run: () => ({ ok: true }) as never,
};

function manifest() {
	const model = buildIdeModel(createCapabilityRegistry([agentRun, inspect]), "dgk");
	return buildVscodeManifest(model, { name: "dgk-bench", displayName: "DGK Bench", description: "The bench" });
}

describe("buildVscodeManifest — the extension manifest from the IdeModel", () => {
	it("contributes a command per verb, in the namespace category", () => {
		const m = manifest();
		const ids = m.contributes.commands.map((c) => c.command);
		expect(ids).toEqual(expect.arrayContaining(["dgk.agent-run", "dgk.extension"]));
		expect(m.contributes.commands.every((c) => c.category === "DGK")).toBe(true);
	});

	it("carries a verb's ide icon as a $(codicon)", () => {
		const run = manifest().contributes.commands.find((c) => c.command === "dgk.agent-run")!;
		expect(run.icon).toBe("$(play)");
		expect(run.title).toBe("Run Coding Agent");
	});

	it("activates on every contributed command", () => {
		const m = manifest();
		expect(m.activationEvents).toEqual(expect.arrayContaining(["onCommand:dgk.agent-run", "onCommand:dgk.extension"]));
	});

	it("contributes an activity-bar container + a tree view under it", () => {
		const m = manifest();
		const container = m.contributes.viewsContainers.activitybar[0]!;
		expect(container.id).toBe("dgk-bench");
		expect(m.contributes.views[container.id]).toHaveLength(1);
	});

	it("adds every command to the command palette", () => {
		const m = manifest();
		expect(m.contributes.menus.commandPalette.map((x) => x.command)).toEqual(
			expect.arrayContaining(["dgk.agent-run", "dgk.extension"]),
		);
	});

	it("sets the engine + main entry", () => {
		const m = manifest();
		expect(m.engines.vscode).toMatch(/^\^1\./);
		expect(m.main).toContain("extension.js");
	});
});
