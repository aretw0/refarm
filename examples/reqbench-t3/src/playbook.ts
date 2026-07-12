import type { CapabilityDescriptor, CapabilityHost } from "@refarm.dev/capability-host";
import {
	createLocalDispatchStep,
	createPlaybookRunCapability,
	type LocalVerb,
} from "@refarm.dev/playbook/capability";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** A registry entry that is a verb GROUP (has `actions`). Checked structurally so this example
 * needs no dependency on @refarm.dev/capabilities just for the type guard. */
interface VerbGroupLike {
	actions: Record<string, LocalVerb>;
}
function isGroupLike(entry: unknown): entry is VerbGroupLike {
	return !!entry && typeof entry === "object" && "actions" in entry;
}
function isFlatVerb(entry: unknown): entry is LocalVerb {
	return !!entry && typeof entry === "object" && "run" in entry && !("actions" in entry);
}

/**
 * Dogfood: the T3 journey as a DECLARATIVE PLAYBOOK. Instead of a hardcoded verb, the analyst's
 * sequence (discover their systems → pull the chosen one's requirements) lives in
 * `.dgk/requirements.playbook.json` and runs through the generic @refarm.dev/playbook engine —
 * one framework verb (`playbook:run`) driving the reqbench's OWN verbs in-process. This proves
 * the engine on a real case and makes `playbook:run` an agent tool for free.
 */

/** Where the analyst's playbooks live (next to sources.json). `<name>` → `<name>.playbook.json`. */
function playbookPath(name: string): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const base = name.endsWith(".playbook.json") ? name : `${name}.playbook.json`;
	return path.resolve(here, "..", ".dgk", base);
}

/** Load a playbook document by name from the `.dgk` ledger. Returns null if not found. */
export function loadRequirementsPlaybook(name: string): unknown | null {
	try {
		return JSON.parse(readFileSync(playbookPath(name), "utf-8"));
	} catch {
		return null;
	}
}

/**
 * Resolve `<pluginId>:<verb>` against the host's registry: a flat verb by name, or a group's
 * sub-action (e.g. `source:discover` → the `source` group's `discover` action, and
 * `requirements:requirements-pull` → the top-level `requirements-pull` verb). The playbook step
 * names `<group-or-anything>:<verb>`; we accept either the group form or a bare verb name.
 */
function reqbenchVerbResolver(host: CapabilityHost) {
	return (pluginId: string, verb: string): LocalVerb | undefined => {
		const registry = host.registry();
		// A group's sub-action: registry.get(group).actions[verb].
		const group = registry.get(pluginId);
		if (isGroupLike(group) && group.actions[verb]) {
			return group.actions[verb];
		}
		// A flat verb: try the verb name directly (the pluginId is just a namespace label).
		const flat = registry.get(verb);
		if (isFlatVerb(flat)) {
			return flat;
		}
		return undefined;
	};
}

/**
 * The `playbook:run` verb for the reqbench, wired to run playbooks against the host's own
 * in-process verbs. Pass the built host so the dispatch resolver reads its registry lazily (at
 * run time — the playbook verb is itself in that registry).
 */
export function createRequirementsPlaybookCapability(host: CapabilityHost): CapabilityDescriptor {
	return createPlaybookRunCapability({
		dispatch: createLocalDispatchStep({ resolve: reqbenchVerbResolver(host) }),
		loadPlaybook: loadRequirementsPlaybook,
		name: "playbook-run",
	});
}
