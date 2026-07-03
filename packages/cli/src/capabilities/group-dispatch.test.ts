import { describe, expect, it } from "vitest";

import type { SurfaceActionAffordanceRow } from "../action-affordances.js";
import { buildJsonSuccessEnvelope } from "../json-output.js";
import { resolveGroupAction } from "./group-dispatch.js";
import { CapabilityRegistry } from "./registry.js";
import type { CapabilityDescriptor, CapabilityGroup } from "./types.js";
import { isCapabilityGroup } from "./types.js";

/**
 * A tiny 2-action fixture group proving the CapabilityGroup dispatch + that a
 * selectable sub-action carries affordance rows (the SAME menu contract the
 * host/status surfaces use — reused, not duplicated).
 */
function fixtureGroup(): CapabilityGroup {
	const current: CapabilityDescriptor = {
		name: "current",
		summary: "Show the current selection",
		run: () =>
			buildJsonSuccessEnvelope({ command: "demo", operation: "current" }),
	};

	// A selectable sub-action returns affordance rows in its envelope — the TUI
	// renders them as an interactive menu; CLI/API render them flat. run() stays
	// pure and never prompts.
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List options to choose from",
		run: () => {
			const actionRows: SurfaceActionAffordanceRow[] = [
				{ index: 0, id: "a", label: "Option A", display: "Option A" },
				{ index: 1, id: "b", label: "Option B", display: "Option B" },
			];
			return buildJsonSuccessEnvelope<{
				actionRows: SurfaceActionAffordanceRow[];
			}>({ command: "demo", operation: "list", extra: { actionRows } });
		},
	};

	return {
		name: "demo",
		summary: "A demo verb group",
		actions: { current, list },
		defaultAction: "current",
	};
}

describe("CapabilityGroup dispatch", () => {
	it("resolves an explicit sub-action", () => {
		const resolved = resolveGroupAction(fixtureGroup(), ["list"]);
		expect(resolved?.key).toBe("list");
		expect(resolved?.action.name).toBe("list");
	});

	it("resolves the default action when no sub-verb is given", () => {
		const resolved = resolveGroupAction(fixtureGroup(), []);
		expect(resolved?.key).toBe("current");
	});

	it("routes an unknown-first-token to the default action with the full args", () => {
		// group-default-with-args form: `demo <ref>` → default action gets <ref>.
		const withArg: CapabilityGroup = {
			...fixtureGroup(),
			actions: {
				...fixtureGroup().actions,
				current: {
					name: "current",
					summary: "current",
					args: [{ name: "ref" }],
					run: () =>
						buildJsonSuccessEnvelope({ command: "demo", operation: "current" }),
				},
			},
		};
		const resolved = resolveGroupAction(withArg, ["some-ref"]);
		expect(resolved?.key).toBe("current");
		expect(resolved?.input.args.ref).toBe("some-ref");
	});

	it("is case-insensitive on the sub-verb", () => {
		const resolved = resolveGroupAction(fixtureGroup(), ["LIST"]);
		expect(resolved?.key).toBe("list");
	});

	it("a selectable sub-action's envelope carries affordance rows (reused menu contract)", async () => {
		const resolved = resolveGroupAction(fixtureGroup(), ["list"]);
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			actionRows: SurfaceActionAffordanceRow[];
		};
		expect(envelope.actionRows.map((r) => r.id)).toEqual(["a", "b"]);
	});
});

describe("CapabilityGroup custom token grammar (group.resolve)", () => {
	// A group whose form is richer than sub-verb dispatch declares `resolve`. It's
	// surface-neutral — the same grammar runs for a slash, an argv, or a path.
	function withResolver(): CapabilityGroup {
		const base = fixtureGroup();
		return {
			...base,
			actions: {
				...base.actions,
				// A sub-action with a positional so the grammar can route a bare token.
				pick: {
					name: "pick",
					summary: "pick one",
					args: [{ name: "which", required: true }],
					run: () =>
						buildJsonSuccessEnvelope({ command: "demo", operation: "pick" }),
				},
			},
			// Bare unknown token → the `pick` action (a shape the generic dispatcher
			// can't express: its default-with-args only reaches `defaultAction`).
			resolve: (tokens) => {
				if (tokens.length === 1 && tokens[0] === "special") {
					return { key: "pick", tokens: ["chosen"] };
				}
				return null; // defer to the generic rules
			},
		};
	}

	it("the resolver takes precedence and maps tokens → {key, tokens}", () => {
		const resolved = resolveGroupAction(withResolver(), ["special"]);
		expect(resolved?.key).toBe("pick");
		expect(resolved?.input.args.which).toBe("chosen");
	});

	it("a null resolution falls back to the generic dispatch", () => {
		// "list" is a real sub-verb; the resolver returns null for it, so the
		// generic explicit-sub-action rule resolves it.
		const resolved = resolveGroupAction(withResolver(), ["list"]);
		expect(resolved?.key).toBe("list");
	});

	it("a resolution naming no real action is ignored (falls back)", () => {
		const bad: CapabilityGroup = {
			...fixtureGroup(),
			resolve: () => ({ key: "does-not-exist", tokens: [] }),
		};
		// Falls through to the default action rather than dispatching nowhere.
		const resolved = resolveGroupAction(bad, []);
		expect(resolved?.key).toBe("current");
	});
});

describe("CapabilityRegistry with groups", () => {
	it("registers a group under its verb and narrows it back", () => {
		const registry = new CapabilityRegistry();
		const group = fixtureGroup();
		registry.register(group);
		const entry = registry.get("demo");
		expect(entry).toBeDefined();
		expect(isCapabilityGroup(entry!)).toBe(true);
	});

	it("a flat verb and a group coexist and collide by name", () => {
		const registry = new CapabilityRegistry();
		registry.register(fixtureGroup());
		const flat: CapabilityDescriptor = {
			name: "demo",
			summary: "flat clash",
			run: () => buildJsonSuccessEnvelope({ command: "demo", operation: "x" }),
		};
		expect(() => registry.register(flat)).toThrow("already registered");
	});
});
