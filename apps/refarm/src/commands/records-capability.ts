import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import {
	computeRecordContentHash,
	createReferenceRecordsProvider,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import { createReferenceEnrichmentProvider } from "@refarm.dev/enrichment-contract-v1";

/**
 * `records` — the generic records:v1 operator surface: enrich (and inspect) a
 * records manifest via an injected enrichment provider, then re-validate. A NEUTRAL
 * block: it wraps the records:v1 + enrichment:v1 contracts and carries NO domain
 * vocabulary — a work app injects the manifest to enrich AND the enrichment provider
 * (a real lookup swaps in for the reference one). refarm only knows
 * "enrich records via a provider, re-validate, don't break the schema".
 *
 * Declared once → CLI, REPL `/records`, HTTP `POST /records`, and the agent tool
 * `records_enrich`.
 */

type ManifestRecord = RecordsManifest["records"][number];

/** An empty records manifest — the neutral default when no work manifest is
 * injected. refarm ships no domain records. */
function emptyRecordsManifest(): RecordsManifest {
	return { manifestVersion: 1, records: [] };
}

/** Apply an enrichment result back onto a records manifest: for each record with
 * accepted changes, merge the new field values, record provenance, and recompute
 * the content hash. Mirrors the composition script's applyEnrichment (which is not
 * exported), kept small + local. */
function applyEnrichment(
	manifest: RecordsManifest,
	enrichment: Awaited<
		ReturnType<ReturnType<typeof createReferenceEnrichmentProvider>["enrich"]>
	>,
): RecordsManifest {
	const byId = new Map(enrichment.records.map((r) => [r.id, r]));
	return {
		...manifest,
		records: manifest.records.map((record: ManifestRecord) => {
			const enriched = byId.get(record.id);
			if (!enriched || enriched.skipped || enriched.changes.length === 0) {
				return record;
			}
			const next = {
				...record,
				fields: {
					...record.fields,
					...Object.fromEntries(
						enriched.changes.map((c) => [c.field, c.after]),
					),
				},
				enrichmentProvenance: enriched.changes.map((c) => c.provenance),
				contentHash: "",
			};
			next.contentHash = computeRecordContentHash(next);
			return next;
		}),
	};
}

export interface RecordsCommandDeps {
	loadManifest: () => RecordsManifest;
	enrichmentProvider: ReturnType<typeof createReferenceEnrichmentProvider>;
	recordsProvider: ReturnType<typeof createReferenceRecordsProvider>;
}

/** Default deps: an EMPTY manifest + the reference enrichment/records providers.
 * refarm ships no domain records — a work app injects its manifest + (for real
 * enrichment) its own provider. The reference providers are deterministic, so the
 * mechanism is exercisable without a work app. */
export function defaultRecordsDeps(): RecordsCommandDeps {
	return {
		loadManifest: emptyRecordsManifest,
		enrichmentProvider: createReferenceEnrichmentProvider(),
		recordsProvider: createReferenceRecordsProvider(),
	};
}

export function createRecordsCapabilityGroup(
	deps: RecordsCommandDeps = defaultRecordsDeps(),
): CapabilityGroup {
	const enrich: CapabilityDescriptor = {
		name: "enrich",
		summary:
			"Enrich a records manifest via the injected provider (dry-run) and re-validate",
		options: [
			{
				name: "apply",
				kind: "boolean",
				summary:
					"Apply enrichment (default is dry-run: compute changes without writing)",
			},
		],
		async run(input): Promise<CapabilityEnvelope> {
			try {
				const manifest = deps.loadManifest();
				const mode = input.options.apply === true ? "apply" : "dry-run";

				// Build enrichment inputs from the records (id + fields + externalKey).
				const inputs = manifest.records.map((record: ManifestRecord, index: number) => ({
					id: record.id,
					fields: {
						...record.fields,
						externalKey:
							typeof record.fields.externalKey === "string"
								? record.fields.externalKey
								: `rec-${index + 1}`,
					},
					sourceRef: record.sourceRefs?.[0],
				}));
				const selected = deps.enrichmentProvider.select(inputs);
				const enrichment = await deps.enrichmentProvider.enrich(selected, { mode });
				const enrichedManifest = applyEnrichment(manifest, enrichment);
				const validation = deps.recordsProvider.validate(enrichedManifest);

				const changedIds = enrichment.records
					.filter((r) => !r.skipped && r.changes.length > 0)
					.map((r) => r.id);

				return buildJsonSuccessEnvelope({
					command: "records",
					operation: "enrich",
					nextCommand: "records enrich --apply",
					nextCommands: mode === "dry-run" ? ["records enrich --apply"] : [],
					extra: {
						mode,
						provider: deps.enrichmentProvider.describe(),
						selected: selected.length,
						changedRecordIds: changedIds,
						diagnostics: enrichment.diagnostics,
						validation: {
							ok: validation.ok,
							failureCount: validation.failures.length,
						},
						recordCount: enrichedManifest.records.length,
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return buildJsonErrorEnvelope({
					command: "records",
					operation: "enrich",
					error: "records_enrich_failed",
					message,
					nextAction: "Inject a records manifest to enrich, or pull a source first (`source pull`).",
				});
			}
		},
	};

	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List the records and their review states",
		run(): CapabilityEnvelope {
			const manifest = deps.loadManifest();
			return buildJsonSuccessEnvelope({
				command: "records",
				operation: "list",
				extra: {
					count: manifest.records.length,
					records: manifest.records.map((r: ManifestRecord) => ({
						id: r.id,
						title: r.fields.title ?? null,
						reviewState: r.review?.state ?? "unreviewed",
						sourceRefs: r.sourceRefs ?? [],
					})),
				},
			});
		},
	};

	return {
		name: "records",
		summary: "Inspect and enrich a records:v1 manifest",
		actions: { list, enrich },
		defaultAction: "list",
		transports: {
			cli: {},
			repl: {},
			http: { method: "POST", path: "/records" },
			// Enrichment is the model-friendly step: the agent can enrich records as a
			// tool. Read/compute by default (dry-run); --apply is the operator's call.
			agent: { tool: true, toolName: "records_enrich" },
		},
		renderers: { tui: { section: "records" } },
	};
}
