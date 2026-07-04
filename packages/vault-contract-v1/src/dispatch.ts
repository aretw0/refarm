import type { Task } from "@refarm.dev/effort-contract-v1";

import type { VaultNote, VaultProfile, VaultVerb } from "./types.js";

/**
 * The SUBMIT half of vault:v1: build the effort `Task` that dispatches one vault
 * verb against one note. This is TS-only and does NOT execute — it produces the
 * task shape the host submits to the runtime, whose Rust sidecar deserializes it
 * as an `EffortTask`. The actual `instance.call` on a loaded WASM component is a
 * §8 slice; this proves the wire contract that dispatch will ride on.
 *
 * WIRE CONTRACT (packages/tractor/src/sidecar/mod.rs `EffortTask`):
 *   { id, pluginId, fn, args }
 *     id       → EffortTask.id            (String, required)
 *     pluginId → #[serde(rename="pluginId")] plugin_id (String, required)
 *     fn       → #[serde(rename="fn")]     fn_name: Option<String>
 *     args     → #[serde(default)]         args: serde_json::Value
 * The TS effort-contract-v1 `Task` already serializes to exactly these keys, so a
 * vault task round-trips to the sidecar without a translation layer. `fn` is the
 * VERB (`search`/`extract`/…) — a non-lifecycle verb the sidecar does not yet
 * route (it accepts only `respond` today), which is precisely the §8 gap.
 */

/** The args a vault dispatch carries: the note to analyse + the effective,
 * verb-scoped profile. The host produces the note (reads the file) and resolves
 * the profile BEFORE submitting, so the surface receives flat, ready input. */
export interface VaultTaskArgs {
	note: VaultNote;
	profile: VaultProfile;
}

/**
 * Build the effort `Task` for dispatching `verb` against `note` under `profile`
 * to the plugin `pluginId`. `fn` is the verb; the sidecar reads it as
 * `EffortTask.fn_name`. `taskId` identifies the task within its effort.
 */
export function vaultDispatchTask(options: {
	taskId: string;
	pluginId: string;
	verb: VaultVerb;
	note: VaultNote;
	profile: VaultProfile;
}): Task {
	const args: VaultTaskArgs = {
		note: options.note,
		profile: options.profile,
	};
	return {
		id: options.taskId,
		pluginId: options.pluginId,
		fn: options.verb,
		args,
	};
}

/** The `<pluginKey>:<verb>` provides target a plugin must advertise for a vault
 * dispatch to pass the task-run preflight (mirrors the effort task's fn). */
export function vaultProvidesTarget(pluginKey: string, verb: VaultVerb): string {
	return `${pluginKey}:${verb}`;
}

/**
 * The exact JSON wire shape the Rust sidecar `EffortTask` deserializes — the
 * keys and their serde mapping, as a value the wire-parity test asserts against.
 * Declared here (not just in a comment) so the boundary can't silently drift: if
 * `Task`'s serialized keys change, the assertion in dispatch.test.ts breaks.
 */
export const EFFORT_TASK_WIRE_KEYS = ["id", "pluginId", "fn", "args"] as const;
