import { describe, expect, it } from "vitest";

import {
	capabilityCliCommands,
	capabilityCliCommandsForGroup,
	capabilityTuiSections,
} from "./capability-registry.js";

/**
 * The CLI half of the declare-once projection: `program.ts` mounts
 * `capabilityCliCommands()` (top-level verbs) and a parent command self-populates
 * from `capabilityCliCommandsForGroup(<parent>)`. These assert the
 * `transports.cli.group` routing that break #2 taught the projector, over the
 * real app registry (model + skill top-level; extension-review under `extension`).
 */
describe("capability CLI projection (cli.group routing)", () => {
	it("projects the group-less capabilities as top-level commands", () => {
		const names = capabilityCliCommands().map((c) => c.name());
		// model + skill declare `transports.cli: {}` (no group) → top-level.
		expect(names).toContain("model");
		expect(names).toContain("skill");
		// review declares `cli.group: "extension"` with no directAlias → NOT top-level.
		expect(names).not.toContain("review");
	});

	it("projects a grouped capability under its declared parent, not top-level", () => {
		const grouped = capabilityCliCommandsForGroup("extension").map((c) => c.name());
		expect(grouped).toContain("review");
	});

	it("returns nothing for a parent no capability targets", () => {
		expect(capabilityCliCommandsForGroup("no-such-parent")).toEqual([]);
	});

	it("projects groups with their sub-actions intact (model keeps its verbs)", () => {
		const model = capabilityCliCommands().find((c) => c.name() === "model");
		expect(model).toBeDefined();
		const subs = model!.commands.map((c) => c.name());
		// The group projector mounted the model sub-actions from one declaration.
		expect(subs).toEqual(expect.arrayContaining(["current", "set", "providers"]));
	});

	it("mounts `review` as a sub-verb of the canonical `plugin` group (ADR-086)", () => {
		// The authoring gate moved onto the canonical CapabilityGroup: `plugin review`
		// is now an internal verb of `plugin`, alongside install/bundle/reload — not a
		// standalone descriptor tagged into a hand-written `extension` command.
		const plugin = capabilityCliCommands().find((c) => c.name() === "plugin");
		expect(plugin).toBeDefined();
		const subs = plugin!.commands.map((c) => c.name());
		// Both authoring verbs (new = scaffold, review = gate) mounted on the group.
		expect(subs).toContain("new");
		expect(subs).toContain("review");
		// It keeps the lifecycle verbs it always had.
		expect(subs).toEqual(expect.arrayContaining(["install", "bundle", "reload"]));
	});
});

describe("capability TUI projection (renderers.tui bucket)", () => {
	it("groups the verbs that declare renderers.tui by their section", () => {
		const sections = capabilityTuiSections();
		const bySection = new Map(sections.map((s) => [s.section, s]));
		// model → section "settings" with its ctrl+m shortcut; skill → "extensions".
		const settings = bySection.get("settings");
		expect(settings?.entries.map((e) => e.name)).toContain("model");
		expect(settings?.entries.find((e) => e.name === "model")?.shortcut).toBe(
			"ctrl+m",
		);
		expect(bySection.get("extensions")?.entries.map((e) => e.name)).toContain(
			"skill",
		);
	});

	it("omits verbs that declare no renderers.tui (a hint is inert data)", () => {
		// review declares no renderers.tui → it appears on no TUI section.
		const named = capabilityTuiSections().flatMap((s) =>
			s.entries.map((e) => e.name),
		);
		expect(named).not.toContain("review");
	});

	it("sorts sections and entries for a stable menu", () => {
		const sections = capabilityTuiSections();
		const sectionNames = sections.map((s) => s.section);
		expect(sectionNames).toEqual([...sectionNames].sort());
	});
});
