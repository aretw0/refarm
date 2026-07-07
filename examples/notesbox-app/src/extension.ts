import type {
	SubmitEffort,
	SurfaceableManifest,
} from "@refarm.dev/capabilities-v1";

/**
 * The EXTENSION-PATH layer of notesbox — distinct from the composition layer
 * (fixture/deps/requirements-verb, which is plain software: declare a JS run(), mount
 * a CLI). HERE the app declares a PLUGIN MANIFEST — the way the refarm extension path
 * works — and the bridge (registerPluginCapabilities) surfaces its verbs onto every
 * surface from ONE declaration, WITHOUT the app hand-writing a run() for each.
 *
 * This is what "extend via the refarm path" means: an installed extension's verb
 * appears on the CLI (and REPL/TUI/HTTP) by itself. A production deployment would ship
 * a real WASM plugin whose manifest looks like this and whose verb executes behind the
 * runtime; here the manifest is inline and the submit is a captured fake, so the
 * SURFACE effect is provable without a running daemon.
 */

/** The notesbox extension's plugin manifest — declares a dispatchable verb
 * `annotate` (guarded by subscribing to its own dispatch). This is the SAME shape a
 * real installed plugin.json carries. */
export const NOTESBOX_EXTENSION_MANIFEST: SurfaceableManifest = {
	id: "@notesbox/annotator",
	capabilities: {
		provides: ["annotator:annotate"],
		subscribes: ["annotator:dispatch"],
	},
};

/** A captured submit sink: records the efforts the surfaced verb would dispatch to
 * the plugin's WASM, and returns the effort id (the two-phase receipt). A real host
 * injects its sidecar/runtime submit here. */
export function createCapturingSubmit(): SubmitEffort & {
	readonly submitted: ReadonlyArray<{ id: string; fn: string }>;
} {
	const submitted: Array<{ id: string; fn: string }> = [];
	const submit = (async (effort) => {
		submitted.push({ id: effort.id, fn: effort.tasks[0]?.fn ?? "" });
		return effort.id;
	}) as SubmitEffort & { submitted: typeof submitted };
	Object.defineProperty(submit, "submitted", { value: submitted });
	return submit;
}
