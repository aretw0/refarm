import {
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	pluginDescriptorsFrom,
	type PluginDescriptorDeps,
	type RefarmCapabilityDeps,
	type SubmitEffort,
	type SurfaceableManifest,
} from "@refarm.dev/capabilities-v1";
import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
} from "@refarm.dev/cli/capabilities";
import { buildJsonSuccessEnvelope } from "@refarm.dev/cli/json-output";

/**
 * The T1 persona (PROCESS mode). devbench shows the developer's angle: the ACT of
 * declaring an extension and watching it multi-surface. Unlike T2/T3 (which present a
 * finished product), T1 exposes the MACHINE — a coding-agent plugin manifest surfaces
 * its verbs via the bridge, and an inspector verb makes the extension mechanism
 * visible. The focus is technical and general: "declare once → it appears everywhere".
 */

/** The extension under development — a coding-agent plugin. Its manifest declares
 * dispatchable verbs; the bridge surfaces each onto every surface with a host-built
 * dispatch run() the developer never writes. This is the same shape a real installed
 * plugin.json carries. */
export const CODING_AGENT_MANIFEST: SurfaceableManifest = {
	id: "@devbench/coding-agent",
	capabilities: {
		provides: ["agent:code", "agent:review"],
		subscribes: ["agent:dispatch"],
	},
};

/** A capturing submit sink — records the efforts a surfaced agent verb dispatches to
 * the plugin's WASM. A real bench wires the runtime; here it makes the process
 * observable without a daemon. */
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

export function devCapabilityDeps(): RefarmCapabilityDeps {
	return {
		source: defaultSourceDeps(),
		vault: defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async () => "devbench-noop",
		}),
		records: defaultRecordsDeps(),
	};
}

/** The T1 inspector verb: `ext-inspect` — makes the extension MECHANISM visible. It
 * shows what the coding-agent manifest declared and which capability verbs the bridge
 * synthesized from it (the machine, exposed — the developer's view of "declare once").
 */
export function createExtInspectCapability(
	pluginDeps: PluginDescriptorDeps,
): CapabilityDescriptor {
	return {
		name: "ext-inspect",
		summary: "Inspect the coding-agent extension: what it declares, how it surfaces",
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: "/ext/inspect" },
			agent: { tool: true, toolName: "ext_inspect" },
		},
		renderers: { tui: { section: "devbench" } },
		run(): CapabilityEnvelope {
			// Show the mechanism: manifest declaration → synthesized capability verbs.
			const descriptors = pluginDescriptorsFrom(CODING_AGENT_MANIFEST, pluginDeps);
			return buildJsonSuccessEnvelope({
				command: "ext-inspect",
				operation: "inspect",
				extra: {
					pluginId: CODING_AGENT_MANIFEST.id,
					declared: CODING_AGENT_MANIFEST.capabilities?.provides ?? [],
					// The verbs the bridge surfaced onto every surface from the manifest.
					surfaced: descriptors.map((d) => ({ verb: d.name, summary: d.summary })),
					note:
						"Each surfaced verb is a first-class command on CLI/REPL/TUI/HTTP/agent — declared once, no per-surface wiring.",
				},
			});
		},
	};
}
