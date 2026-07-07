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
	createReferenceRecordsFixture,
	createReferenceRecordsProvider,
} from "@refarm.dev/records-contract-v1";
import { createReferenceEnrichmentProvider } from "@refarm.dev/enrichment-contract-v1";

/**
 * `records` — the T3 operator surface for the record layer: enrich (and later
 * correct) the KnowledgeRecords in the notes box. This wraps the ALREADY-PROVEN
 * records:v1 + enrichment:v1 composition (scripts/ci/requirements-supply-
 * composition.mjs) as a runnable verb: select the enrichable records, run the
 * reference enrichment (CNPJ-shaped, dry-run), apply the changes back, and
 * re-validate. The reference providers are deterministic (the demo artifact exists
 * before the run); the real CNPJ lookup is a downstream provider swap.
 *
 * Declared once → CLI, REPL `/records`, HTTP `POST /records`, and the agent tool
 * `records_enrich`.
 */

// Loosely-typed views of the contract shapes — this host coordinates them, it does
// not own their schemas (the contracts do).
type RecordsManifest = ReturnType<typeof createReferenceRecordsFixture>;
type ManifestRecord = RecordsManifest["records"][number];

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

/** Default deps: the reference records fixture + the reference (CNPJ-shaped)
 * enrichment provider. Injected so a real source manifest + a real CNPJ provider
 * swap in downstream without touching this host code. */
export function defaultRecordsDeps(): RecordsCommandDeps {
	return {
		loadManifest: createReferenceRecordsFixture,
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
			"Enrich the notes-box records (CNPJ-shaped, dry-run) and re-validate",
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
								: `REQ-${index + 1}`,
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
					nextAction: "Ensure records are pulled first (`requirements pull`).",
				});
			}
		},
	};

	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List the notes-box records and their review states",
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
		summary: "Inspect and enrich the notes-box records (T3)",
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
		renderers: { tui: { section: "notes-box" } },
	};
}
