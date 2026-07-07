import {
	buildJsonSuccessEnvelope,
	CapabilityDescriptor,
	CapabilityEnvelope,
} from "@refarm.dev/capabilities-v1";

import { NOTESBOX_SOURCE_REF, notesboxManifest } from "./fixture.js";

/**
 * `requirements` — the notesbox app's OWN work verb. This is the WORK layer (level 3):
 * it carries the deployment's vocabulary and composes the neutral verbs into a single
 * branded step. refarm never declares this; the app does, and it lights up on the same
 * surfaces (CLI, REPL, TUI, HTTP, agent) as the built-ins via the shared projector.
 *
 * Here it just reports the app's requirements source ref + record count — a real
 * deployment would drive `source pull` then `records enrich` and register the result.
 */
export const requirementsCapability: CapabilityDescriptor = {
	name: "requirements",
	summary: "Show the notesbox requirements source + record count (work-specific verb)",
	transports: {
		cli: {},
		repl: {},
		http: { method: "GET", path: "/requirements" },
		agent: { tool: true, toolName: "requirements_show" },
	},
	renderers: { tui: { section: "notesbox" } },
	run(): CapabilityEnvelope {
		const manifest = notesboxManifest();
		return buildJsonSuccessEnvelope({
			command: "requirements",
			operation: "show",
			nextCommand: "source pull " + NOTESBOX_SOURCE_REF,
			nextCommands: [`source pull ${NOTESBOX_SOURCE_REF}`, "records enrich"],
			extra: {
				sourceRef: NOTESBOX_SOURCE_REF,
				recordCount: manifest.records.length,
				records: manifest.records.map((r) => ({
					id: r.id,
					title: r.fields.title ?? null,
					externalKey: r.fields.externalKey ?? null,
				})),
			},
		});
	},
};
