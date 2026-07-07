import {
	defaultVaultDeps,
	type RecordsCommandDeps,
	type RefarmCapabilityDeps,
	type VaultDiscoveryResult,
} from "@refarm.dev/capabilities-v1";
import { createLocalRecordsCommandDeps } from "@refarm.dev/capabilities-v1/node";
import {
	createReferenceEnrichmentProvider,
	type ReferenceEnrichmentEntry,
} from "@refarm.dev/enrichment-contract-v1";
import { createReferenceRecordsProvider } from "@refarm.dev/records-contract-v1";
import { createWebSourceProvider } from "@refarm.dev/source-web";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NOTESBOX_SOURCE_FIXTURES, notesboxManifest } from "./fixture.js";

/**
 * The notesbox app's plumbing that turns the neutral capability blocks into a fully
 * wired deps bundle. This is the app's HALF of the two-layer seam: refarm supplies the
 * verbs, the app supplies the source fixture, the records manifest, the enrichment
 * lookup, and (for vault) how it discovers providers + submits efforts.
 *
 * A production deployment swaps these fixtures for a real authenticated source, a real
 * manifest, and a real enrichment lookup — the injection points stay identical.
 */

/** The app's OWN enrichment lookup — adds work-specific fields to records keyed by
 * their `externalKey`. This is the app's domain knowledge, not refarm's. */
const NOTESBOX_ENRICHMENT_FIXTURE: Record<string, ReferenceEnrichmentEntry> = {
	"REQ-1": {
		fields: { "notesbox.tags": ["requisito", "revisao"], "notesbox.priority": "media" },
		sourceRef: "fixture:notesbox/enrichment#REQ-1",
	},
	"REQ-2": {
		fields: { "notesbox.tags": ["requisito", "aceito"], "notesbox.priority": "alta" },
		sourceRef: "fixture:notesbox/enrichment#REQ-2",
	},
};

/** The records deps: load the app's manifest, enrich via the app's lookup, and
 * PERSIST a correction. By default it is process-local; when the CLI provides a
 * statePath, the same neutral `records correct` verb writes through to disk. */
export interface NotesboxStateOptions {
	statePath?: string;
}

export function notesboxRecordsDeps(
	options: NotesboxStateOptions = {},
): RecordsCommandDeps {
	return createLocalRecordsCommandDeps({
		seed: notesboxManifest,
		statePath: options.statePath,
		enrichmentProvider: createReferenceEnrichmentProvider({
			fixture: NOTESBOX_ENRICHMENT_FIXTURE,
			keyField: "externalKey",
		}),
		recordsProvider: createReferenceRecordsProvider(),
	});
}

/** A no-op vault discovery for the example (no installed plugins). A real host injects
 * its own plugin-dir scan here. */
function emptyDiscover(): VaultDiscoveryResult {
	return { providers: [], rejected: [] };
}

/** A no-op effort submit for the example — `vault init`/`list` need no runtime. A real
 * host injects the sidecar submit for `vault dispatch`. */
async function noopSubmit(): Promise<string> {
	return "notesbox-noop";
}

/** The full deps bundle the app hands `refarmBuiltinCapabilities`. Accepts the records
 * deps so the SAME records state (load/save) is shared with a persona extension (e.g.
 * the requirements area) — a correction persisted via `records correct` is then
 * visible in the analyst's MOC. */
export function notesboxCapabilityDeps(
	cacheRoot?: string,
	recordsDeps: RecordsCommandDeps = notesboxRecordsDeps(),
): RefarmCapabilityDeps {
	const root =
		cacheRoot ?? mkdtempSync(path.join(os.tmpdir(), "notesbox-source-"));
	return {
		source: {
			sourceProvider: createWebSourceProvider({
				cacheRoot: root,
				fixtures: NOTESBOX_SOURCE_FIXTURES,
			}),
		},
		vault: defaultVaultDeps({
			discover: emptyDiscover,
			submitEffort: noopSubmit,
			// The app injects its OWN vault seed — refarm ships none. `vault init` renders
			// these records into markdown.
			seed: notesboxManifest,
		}),
		records: recordsDeps,
	};
}
