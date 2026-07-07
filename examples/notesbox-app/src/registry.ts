import {
	refarmBuiltinCapabilities,
	type RefarmCapabilityDeps,
} from "@refarm.dev/capabilities-v1";
import {
	capabilityCliCommands,
	createCapabilityRegistry,
	type CapabilityEntry,
	type CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";
import type { Command } from "commander";

import { notesboxCapabilityDeps } from "./deps.js";
import { requirementsCapability } from "./requirements-verb.js";

/**
 * The notesbox app's capability registry — the two-layer composition. The neutral
 * refarm blocks (source/records/vault) come from `@refarm.dev/capabilities-v1`, built
 * from the app's OWN injected deps bundle; the app's work verb (`requirements`) is
 * added alongside them. ONE registry → the CLI, REPL, TUI, and HTTP surfaces all
 * derive from it, exactly as they do in the refarm app itself.
 */
export function createNotesboxRegistry(
	deps: RefarmCapabilityDeps = notesboxCapabilityDeps(),
): CapabilityRegistry {
	const entries: CapabilityEntry[] = [
		...refarmBuiltinCapabilities(deps),
		requirementsCapability,
	];
	return createCapabilityRegistry(entries);
}

/** The CLI commands for the notesbox app, projected from the composed registry via the
 * shared `@refarm.dev/cli` projector — the same seam the refarm app uses. */
export function notesboxCliCommands(registry: CapabilityRegistry): Command[] {
	return capabilityCliCommands(registry.list(), () => ({}));
}
