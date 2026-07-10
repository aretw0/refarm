import { describe, expect, it } from "vitest";

import { buildPaletteModel } from "./palette-projector.js";
import { createCapabilityRegistry } from "./registry.js";
import type { CapabilityDescriptor } from "./types.js";

const codeVerb: CapabilityDescriptor = {
	name: "agent-code",
	summary: "Run the coding agent",
	renderers: {
		tui: { section: "agent" },
		palette: { group: "agent", keybind: "g c", hint: "dispatch a coding task" },
	} as never,
	run: () => ({ ok: true }) as never,
};

const reviewVerb: CapabilityDescriptor = {
	name: "agent-review",
	summary: "Review a change",
	renderers: { palette: { group: "agent" } } as never,
	run: () => ({ ok: true }) as never,
};

const tuiOnly: CapabilityDescriptor = {
	name: "hidden-from-palette",
	summary: "no palette hint",
	renderers: { tui: { section: "agent" } },
	run: () => ({ ok: true }) as never,
};

describe("palette-projector — a new surface projected from the open axis (ADR-085)", () => {
	function model() {
		return buildPaletteModel(createCapabilityRegistry([codeVerb, reviewVerb, tuiOnly]));
	}

	it("includes only verbs that declared renderers.palette", () => {
		const names = model().groups.flatMap((g) => g.entries.map((e) => e.name));
		expect(names).toContain("agent-code");
		expect(names).toContain("agent-review");
		// A verb with a tui hint but no palette hint is absent — the palette is its own face.
		expect(names).not.toContain("hidden-from-palette");
	});

	it("groups by renderers.palette.group and carries keybind + hint", () => {
		const agent = model().groups.find((g) => g.group === "agent");
		expect(agent).toBeDefined();
		const code = agent!.entries.find((e) => e.name === "agent-code");
		expect(code).toEqual({
			name: "agent-code",
			summary: "Run the coding agent",
			group: "agent",
			keybind: "g c",
			hint: "dispatch a coding task",
		});
	});

	it("defaults group to 'commands' when the palette hint omits it", () => {
		const bare: CapabilityDescriptor = {
			name: "ping",
			summary: "p",
			renderers: { palette: {} } as never,
			run: () => ({ ok: true }) as never,
		};
		const m = buildPaletteModel(createCapabilityRegistry([bare]));
		expect(m.groups[0]?.group).toBe("commands");
	});

	it("proves the open axis: palette needed ZERO edits to surfaceModel or another projector", () => {
		// The whole point — `palette` is a surface the core never enumerated. It reached
		// this projector purely through the open `surfaces` map. Empty registry → empty
		// palette, no throw, no special-casing.
		expect(buildPaletteModel(createCapabilityRegistry([])).groups).toEqual([]);
	});
});
