import {
	refarmBuiltinCapabilities,
	registerPluginCapabilities,
	type RefarmCapabilityDeps,
	type SubmitEffort,
} from "@refarm.dev/capabilities-v1";
import {
	capabilityCliCommands,
	createCapabilityRegistry,
	type CapabilityEntry,
	type CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";
import type { Command } from "commander";

import { notesboxCapabilityDeps, notesboxRecordsDeps } from "./deps.js";
import {
	createCapturingSubmit,
	NOTESBOX_EXTENSION_MANIFEST,
} from "./extension.js";
import { createRequirementsAreaCapability } from "./requirements-area.js";
import { requirementsCapability } from "./requirements-verb.js";

/**
 * The notesbox app's capability registry — TWO ways of extending, both landing on the
 * same composed registry that every surface reads:
 *
 *   1. COMPOSITION (plain software): the neutral refarm blocks (source/records/vault)
 *      built from the app's own deps, plus the app's own JS-run() work verb
 *      (`requirements`). The app hand-wires each.
 *
 *   2. THE REFARM EXTENSION PATH (the interesting one): a PLUGIN MANIFEST declares a
 *      dispatchable verb, and `registerPluginCapabilities` (the bridge) SURFACES it
 *      onto every surface from that ONE declaration — the app writes no run() for it.
 *      This is the effect that makes an installed extension appear on the CLI by
 *      itself; it is what distinguishes extending the refarm way from importing a
 *      package.
 */
export interface NotesboxRegistryOptions {
	/** Deps for the neutral blocks. */
	deps?: RefarmCapabilityDeps;
	/** How the surfaced plugin verb submits its dispatch effort. A real host injects
	 * its runtime sink; defaults to a captured fake so the surface effect is provable
	 * without a daemon. */
	extensionSubmit?: SubmitEffort;
}

export function createNotesboxRegistry(
	options: NotesboxRegistryOptions = {},
): CapabilityRegistry {
	const deps = options.deps ?? notesboxCapabilityDeps();
	const extensionSubmit = options.extensionSubmit ?? createCapturingSubmit();

	// 1. Composition layer — neutral blocks + the app's JS work verbs. The T3 PERSONA
	// extension (`requirements-moc`) reads the SAME records deps as the neutral group,
	// so a correction persisted via `records correct` shows up in the analyst's MOC —
	// it EXPOSES the generic engine as a finished product (result mode).
	const entries: CapabilityEntry[] = [
		...refarmBuiltinCapabilities(deps),
		requirementsCapability,
		createRequirementsAreaCapability(deps.records ?? notesboxRecordsDeps()),
	];
	const registry = createCapabilityRegistry(entries);

	// 2. Extension-path layer — the plugin manifest's verb surfaces itself via the
	// bridge. From ONE manifest declaration, `annotate` becomes a first-class verb on
	// every surface, with a host-built dispatch run() (no app-authored run()).
	registerPluginCapabilities(registry, [NOTESBOX_EXTENSION_MANIFEST], {
		submitEffort: extensionSubmit,
		newId: () => globalThis.crypto.randomUUID(),
		nowIso: () => new Date().toISOString(),
	});

	return registry;
}

/** The CLI commands for the notesbox app, projected from the composed registry via the
 * shared `@refarm.dev/cli` projector — the same seam the refarm app uses. Both the
 * composed verbs AND the extension-path verb project identically. */
export function notesboxCliCommands(registry: CapabilityRegistry): Command[] {
	return capabilityCliCommands(registry.list(), () => ({}));
}
