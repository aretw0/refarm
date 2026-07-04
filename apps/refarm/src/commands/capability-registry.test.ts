import { describe, expect, it } from "vitest";

import {
	capabilityCliCommands,
	capabilityCliCommandsForGroup,
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
});
