import {
	defineCapabilityHost,
	type CapabilityHost,
	type CapabilityHostCapabilities,
	type RefarmCapabilityDeps,
	type SubmitEffort,
} from "@refarm.dev/capabilities-v1";

import {
	notesboxCapabilityDeps,
	notesboxRecordsDeps,
	type NotesboxStateOptions,
} from "./deps.js";
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
 *      built from the app's own deps, plus the app's own JS-run() work verbs
 *      (`requirements` and `requirements-moc`). The app declares only its extensions.
 *
 *   2. THE REFARM EXTENSION PATH (the interesting one): a PLUGIN MANIFEST declares a
 *      dispatchable verb, and the host bridge SURFACES it onto every surface from
 *      that ONE declaration — the app writes no run() for it.
 *      This is the effect that makes an installed extension appear on the CLI by
 *      itself; it is what distinguishes extending the refarm way from importing a
 *      package.
 */
export interface NotesboxRegistryOptions {
	/** Deps for the neutral blocks. */
	deps?: RefarmCapabilityDeps;
	/** Source cache root for source pull/status flows. */
	sourceCacheRoot?: string;
	/** Optional local records state path so CLI explorations persist between processes. */
	statePath?: string;
	/** How the surfaced plugin verb submits its dispatch effort. A real host injects
	 * its runtime sink; defaults to a captured fake so the surface effect is provable
	 * without a daemon. */
	extensionSubmit?: SubmitEffort;
}

export function createNotesboxRegistry(
	options: NotesboxRegistryOptions = {},
): ReturnType<CapabilityHost["registry"]> {
	return buildNotesboxHost(options).registry();
}

export type NotesboxHostOptions = NotesboxRegistryOptions & NotesboxStateOptions;

export function buildNotesboxHost(
	options: NotesboxHostOptions = {},
): CapabilityHost {
	return defineCapabilityHost({
		id: "examples/notesbox-app",
		command: "notesbox",
		description: "Notesbox - a white-label refarm host for a requirements note box",
		version: "0.0.0",
		capabilities: () => notesboxHostCapabilities(options),
		operatorStatus: {
			summary: "Show notesbox operator status",
			httpPath: "/requirements/status",
			capabilityUnit: {
				subject: "Notesbox",
				action: {
					id: "open-requirements-moc",
					label: "notesbox requirements-moc --json",
					intent: "requirements:open",
					command: "notesbox requirements-moc --json",
					primary: true,
				},
			},
			units: ({ capabilities, reviewQueueUnit }) => {
				const records = capabilities.deps.records ?? notesboxRecordsDeps(options);
				const manifest = records.loadManifest();
				const draftRecords = manifest.records.filter(
					(record) => record.review?.state !== "reviewed",
				);
				return [
					reviewQueueUnit({
						id: "requirements",
						label: "Requirements",
						total: manifest.records.length,
						pending: draftRecords.length,
						totalLabel: "requirements",
						pendingLabel: "needs review",
						pendingSummary: ({ total, pending }) =>
							`Notesbox has ${total} requirements; ${pending} requirement needs review.`,
						readySummary: ({ total }) =>
							`Notesbox has ${total} reviewed requirements.`,
						pendingAction: {
							id: "review-root-requirement",
							label: "Review the root requirement",
							intent: "requirements:review",
							command: "notesbox records correct record:req-root reviewed --apply",
							primary: true,
						},
						details: {
							recordIds: manifest.records.map((record) => record.id),
							draftRecordIds: draftRecords.map((record) => record.id),
						},
					}),
				];
			},
		},
		serve: {
			defaultPort: 4324,
			description: "Serve notesbox verbs over HTTP (their transports.http routes)",
		},
	});
}

export function buildNotesboxBaseModel(options: NotesboxHostOptions = {}) {
	return buildNotesboxHost(options).baseModel();
}

function notesboxHostCapabilities(
	options: NotesboxHostOptions,
): CapabilityHostCapabilities {
	const records = options.deps?.records ?? notesboxRecordsDeps(options);
	const deps = options.deps ?? notesboxCapabilityDeps(options.sourceCacheRoot, records);
	const extensionSubmit = options.extensionSubmit ?? createCapturingSubmit();

	return {
		deps,
		extensions: [
			requirementsCapability,
			createRequirementsAreaCapability(records),
		],
		manifests: [NOTESBOX_EXTENSION_MANIFEST],
		pluginDeps: {
			submitEffort: extensionSubmit,
			newId: () => globalThis.crypto.randomUUID(),
			nowIso: () => new Date().toISOString(),
		},
	};
}
