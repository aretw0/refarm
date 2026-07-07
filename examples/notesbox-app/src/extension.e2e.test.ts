import { describe, expect, it } from "vitest";

import { buildNotesboxHost } from "./cli.js";
import { createCapturingSubmit } from "./extension.js";
import { createNotesboxRegistry } from "./registry.js";

/**
 * The EXTENSION-PATH proof — the payoff that distinguishes extending VIA the refarm
 * path from plain software composition. The app declares a PLUGIN MANIFEST (not a
 * JS-run() verb); the bridge surfaces its verb onto every surface from that ONE
 * declaration. This test proves the `annotate` verb appears on the CLI by itself, with
 * a host-built dispatch run() the app never wrote.
 */
describe("notesbox extension path (plugin manifest → multi-surface, no app run())", () => {
	it("the plugin's verb surfaces into the composed registry from ONE manifest", () => {
		const registry = createNotesboxRegistry();
		const names = registry.list().map((e) => e.name);
		// `annotate` is NOT declared as a JS CapabilityDescriptor anywhere in the app —
		// it comes purely from the plugin manifest via the bridge.
		expect(names).toContain("annotate");
	});

	it("the surfaced verb projects onto the CLI exactly like a built-in", () => {
		const commandNames = buildNotesboxHost().program().commands.map((c) => c.name());
		// The extension-path verb is a real top-level CLI command — no per-surface wiring.
		expect(commandNames).toContain("annotate");
		// It coexists with the composition-layer verbs on the same surface.
		expect(commandNames).toEqual(
			expect.arrayContaining([
				"source",
				"records",
				"vault",
				"requirements",
				"requirements-moc",
				"status",
				"actions",
				"annotate",
			]),
		);
	});

	it("running the surfaced verb dispatches across the WASM boundary (two-phase receipt)", async () => {
		const submit = createCapturingSubmit();
		const registry = createNotesboxRegistry({ extensionSubmit: submit });
		const annotate = registry.get("annotate");
		if (!annotate || "actions" in annotate) throw new Error("annotate not a verb");

		// The app never wrote this run() — the bridge built it. It parses key=value args
		// and submits a dispatch effort to the plugin's WASM.
		const env = (await annotate.run({
			args: { args: ['note={"path":"n.md"}'] },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; verb: string; effortId: string; replyRef: string };

		expect(env.ok).toBe(true);
		expect(env.verb).toBe("annotate");
		// A two-phase receipt: the verb was dispatched (captured), not run inline.
		expect(env.effortId).toBeTruthy();
		expect(env.replyRef).toBe(env.effortId);
		expect(submit.submitted).toHaveLength(1);
		expect(submit.submitted[0]?.fn).toBe("annotate");
	});
});
