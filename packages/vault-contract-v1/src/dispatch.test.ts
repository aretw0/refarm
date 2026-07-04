import type { Task } from "@refarm.dev/effort-contract-v1";
import { describe, expect, it } from "vitest";

import {
	EFFORT_TASK_WIRE_KEYS,
	vaultDispatchTask,
	vaultProvidesTarget,
	type VaultTaskArgs,
} from "./dispatch.js";
import type { VaultNote, VaultProfile } from "./types.js";

const NOTE: VaultNote = {
	path: "20-Projects/demanda-42.md",
	text: "---\ntitle: Demanda 42\n---\n\nbody\n",
};

const PROFILE: VaultProfile = {
	name: "p",
	rules: [
		{
			id: "extract-frontmatter",
			verb: "extract",
			match: JSON.stringify({ type: "frontmatter" }),
		},
	],
};

describe("vaultDispatchTask — the SUBMIT half (no execution)", () => {
	it("builds an effort Task whose fn is the verb and args carry note+profile", () => {
		const task = vaultDispatchTask({
			taskId: "t-1",
			pluginId: "@demo/vault-extract",
			verb: "extract",
			note: NOTE,
			profile: PROFILE,
		});
		expect(task.id).toBe("t-1");
		expect(task.pluginId).toBe("@demo/vault-extract");
		expect(task.fn).toBe("extract");
		const args = task.args as VaultTaskArgs;
		expect(args.note).toEqual(NOTE);
		expect(args.profile).toEqual(PROFILE);
	});

	it("the task's fn is the verb for every verb", () => {
		for (const verb of ["search", "extract", "organize", "profile"] as const) {
			const task = vaultDispatchTask({
				taskId: "t",
				pluginId: "@demo/v",
				verb,
				note: NOTE,
				profile: PROFILE,
			});
			expect(task.fn).toBe(verb);
		}
	});
});

describe("wire parity — TS Task ⇄ Rust sidecar EffortTask", () => {
	// The Rust EffortTask (packages/tractor/src/sidecar/mod.rs) deserializes from
	// JSON with these keys: id, pluginId (serde rename), fn (serde rename ->
	// fn_name), args (serde default). A vault Task must serialize to EXACTLY these
	// keys so it round-trips to the sidecar without a translation layer.
	it("serializes to exactly the keys the sidecar EffortTask reads", () => {
		const task = vaultDispatchTask({
			taskId: "t-1",
			pluginId: "@demo/vault-extract",
			verb: "extract",
			note: NOTE,
			profile: PROFILE,
		});
		const wire = JSON.parse(JSON.stringify(task)) as Record<string, unknown>;
		expect(Object.keys(wire).sort()).toEqual([...EFFORT_TASK_WIRE_KEYS].sort());
		// The renamed fields carry the values the Rust struct binds.
		expect(wire.pluginId).toBe("@demo/vault-extract"); // -> plugin_id
		expect(wire.fn).toBe("extract"); // -> fn_name: Option<String>
		expect(wire.args).toBeTypeOf("object"); // -> args: Value
		expect(wire.id).toBe("t-1");
	});

	it("a plain effort Task and a vaultDispatchTask share the same wire shape", () => {
		// Guards against vault-contract drifting from effort-contract's Task.
		const plain: Task = {
			id: "x",
			pluginId: "p",
			fn: "extract",
			args: {},
		};
		const built = vaultDispatchTask({
			taskId: "x",
			pluginId: "p",
			verb: "extract",
			note: NOTE,
			profile: PROFILE,
		});
		expect(Object.keys(JSON.parse(JSON.stringify(plain))).sort()).toEqual(
			Object.keys(JSON.parse(JSON.stringify(built))).sort(),
		);
	});
});

describe("vaultProvidesTarget — the preflight target", () => {
	it("is <pluginKey>:<verb>, matching the task-run provides preflight", () => {
		expect(vaultProvidesTarget("vault", "extract")).toBe("vault:extract");
		expect(vaultProvidesTarget("vault", "search")).toBe("vault:search");
	});
});
