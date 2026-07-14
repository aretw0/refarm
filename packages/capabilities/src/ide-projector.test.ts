import { describe, expect, it } from "vitest";

import { buildIdeModel } from "./ide-projector.js";
import { createCapabilityRegistry } from "./registry.js";
import type { CapabilityDescriptor } from "./types.js";

const agentRun: CapabilityDescriptor = {
	name: "agent-run",
	summary: "Run the coding agent live",
	renderers: {
		tui: { section: "agent" },
		ide: { group: "Agent", title: "Run Coding Agent", command: "dgk.agentRun", icon: "play" },
	} as never,
	run: () => ({ ok: true }) as never,
};

const inspect: CapabilityDescriptor = {
	name: "extension",
	summary: "Inspect the extension",
	// No `ide` hint → falls back to the tui.section group + the verb name command id.
	renderers: { tui: { section: "extension" } },
	run: () => ({ ok: true }) as never,
};

describe("ide-projector — the editor face projected from the open axis", () => {
	function model(ns?: string) {
		return buildIdeModel(createCapabilityRegistry([agentRun, inspect]), ns);
	}

	it("projects EVERY verb as an editor command (the full command set)", () => {
		const names = model().commands.map((c) => c.name).sort();
		expect(names).toEqual(["agent-run", "extension"]);
	});

	it("refines a verb via its renderers.ide hint (group, title, command id, icon)", () => {
		const run = model().commands.find((c) => c.name === "agent-run")!;
		expect(run.group).toBe("Agent");
		expect(run.title).toBe("Run Coding Agent");
		expect(run.commandId).toBe("dgk.agentRun");
		expect(run.icon).toBe("play");
	});

	it("falls back to the tui.section group + a namespaced command id when no ide hint", () => {
		const insp = buildIdeModel(createCapabilityRegistry([inspect]), "dgk").commands[0]!;
		expect(insp.group).toBe("extension"); // from tui.section
		expect(insp.commandId).toBe("dgk.extension"); // namespace + name
		expect(insp.title).toBe("Inspect the extension"); // the summary
	});

	it("groups commands into a tree, group- and name-sorted", () => {
		const tree = model().tree;
		expect(tree.map((t) => t.group)).toEqual(["Agent", "extension"]);
		expect(tree.find((t) => t.group === "Agent")!.commands.map((c) => c.name)).toEqual(["agent-run"]);
	});

	it("uses the given namespace for command ids", () => {
		expect(buildIdeModel(createCapabilityRegistry([inspect]), "wallet").commands[0]!.commandId).toBe("wallet.extension");
	});
});
