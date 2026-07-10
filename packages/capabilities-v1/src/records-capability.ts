import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityGroup,
	CapabilityInput,
} from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import {
	createReferenceEnrichmentProvider,
	type EnrichmentProvider,
	type EnrichmentResult,
} from "@refarm.dev/enrichment-contract-v1";
import {
	computeRecordContentHash,
	createReferenceRecordsProvider,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";

/**
 * `records` — the generic records:v1 operator surface: enrich (and inspect) a
 * records manifest via an injected enrichment provider, then re-validate. A NEUTRAL
 * block: it wraps the records:v1 + enrichment:v1 contracts and carries NO domain
 * vocabulary — a work app injects the manifest to enrich AND the enrichment provider
 * (a real lookup swaps in for the reference one). The block only knows
 * "enrich records via a provider, re-validate, don't break the schema".
 *
 * Declared once → CLI, REPL `/records`, HTTP `POST /records`, and the agent tool
 * `records_enrich`.
 */

type ManifestRecord = RecordsManifest["records"][number];

/** An empty records manifest — the neutral default when no work manifest is
 * injected. This package ships no domain records. */
function emptyRecordsManifest(): RecordsManifest {
	return { manifestVersion: 1, records: [] };
}

/** The dimension a `records analyze` groups by. NEUTRAL — a work app never has to
 * declare a new one; these are the record-shape fields any records:v1 manifest has. */
export type RecordsAnalyzeDimension = "reviewState" | "type" | "sourceRef";

export interface RecordsAnalyzeGroup {
	key: string;
	label: string;
	count: number;
	records: Array<{ id: string; title: string; link: string }>;
}

export interface RecordsAnalyzeEnvelope {
	ok: boolean;
	by: RecordsAnalyzeDimension;
	summary: { total: number; byState: Record<string, number> };
	groups: RecordsAnalyzeGroup[];
}

export interface RecordsViewCapabilityOptions {
	name: string;
	summary: string;
	records: RecordsCommandDeps;
	operation?: string;
	groupBy?: RecordsAnalyzeDimension;
	httpPath?: string;
	tuiSection?: string;
	agentToolName?: string;
	options?: CapabilityDescriptor["options"];
	transports?: CapabilityDescriptor["transports"];
	renderers?: CapabilityDescriptor["renderers"];
	project: (
		analysis: RecordsAnalyzeEnvelope,
		input: CapabilityInput,
	) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/** The group key(s) a record falls under for a given dimension. A record can land in
 * more than one group (multiple sourceRefs/types); reviewState is single-valued. */
function groupKeysFor(record: ManifestRecord, by: RecordsAnalyzeDimension): string[] {
	if (by === "reviewState") return [record.review?.state ?? "unreviewed"];
	if (by === "type") {
		const t = record["@type"];
		const types = Array.isArray(t) ? t : typeof t === "string" ? [t] : [];
		return types.length > 0 ? types : ["untyped"];
	}
	// sourceRef
	const refs = record.sourceRefs ?? [];
	return refs.length > 0 ? refs : ["no-source"];
}

function normalizeAnalyzeDimension(
	raw: unknown,
	fallback: RecordsAnalyzeDimension = "reviewState",
): RecordsAnalyzeDimension {
	return raw === "reviewState" || raw === "type" || raw === "sourceRef"
		? raw
		: fallback;
}

/** Apply an enrichment result back onto a records manifest: for each record with
 * accepted changes, merge the new field values, record provenance, and recompute
 * the content hash. Mirrors the composition script's applyEnrichment (which is not
 * exported), kept small + local. */
function applyEnrichment(
	manifest: RecordsManifest,
	enrichment: EnrichmentResult,
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
	/** ANY enrichment:v1 provider — the reference one, or a WASM plugin adapted via
	 * createWasmEnrichmentProvider. The `enrich` step is where a real lookup (CNPJ, an
	 * external registry) happens, so a WASM extension is a natural fit. */
	enrichmentProvider: EnrichmentProvider;
	recordsProvider: ReturnType<typeof createReferenceRecordsProvider>;
	/** OPTIONAL persistence sink for a correction/review. INJECTED by the host — the
	 * neutral block holds no store (that would bind it to a vault/file layout). Absent
	 * → `correct` runs dry-run (reports the change without writing). A host injects
	 * where a corrected manifest lands (the vault, a file, a store). */
	saveManifest?: (manifest: RecordsManifest) => void | Promise<void>;
}

/** Default deps: an EMPTY manifest + the reference enrichment/records providers.
 * This package ships no domain records — a work app injects its manifest + (for real
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

	const correct: CapabilityDescriptor = {
		name: "correct",
		summary:
			"Apply an analyst's review to a record (set its review state + notes), re-validate",
		args: [
			{ name: "id", required: true },
			{ name: "state", required: true },
		],
		options: [
			{ name: "notes", kind: "string", summary: "Reviewer notes for the correction" },
			{ name: "by", kind: "string", summary: "Who made the correction" },
			{
				name: "apply",
				kind: "boolean",
				summary:
					"Persist the correction (needs an injected save sink; default is dry-run)",
			},
		],
		async run(input): Promise<CapabilityEnvelope> {
			const id = input.args.id as string;
			const state = input.args.state as string;
			const mode = input.options.apply === true ? "apply" : "dry-run";
			try {
				const manifest = deps.loadManifest();
				const target = manifest.records.find((r: ManifestRecord) => r.id === id);
				if (!target) {
					return buildJsonErrorEnvelope({
						command: "records",
						operation: "correct",
						error: "record_not_found",
						message: `No record with id "${id}" in the manifest.`,
						nextAction: "Run `records list` to see record ids.",
					});
				}

				// Apply the review onto a fresh copy: set state (+ optional notes/by), stamp
				// the review, recompute the content hash. Mirrors applyEnrichment's shape.
				const review = {
					state,
					...(typeof input.options.notes === "string"
						? { notes: input.options.notes }
						: {}),
					...(typeof input.options.by === "string" ? { by: input.options.by } : {}),
				};
				const corrected = {
					...target,
					review,
					contentHash: "",
				};
				corrected.contentHash = computeRecordContentHash(corrected);
				const nextManifest = {
					...manifest,
					records: manifest.records.map((r: ManifestRecord) =>
						r.id === id ? corrected : r,
					),
				};
				const validation = deps.recordsProvider.validate(nextManifest);

				let persisted = false;
				if (mode === "apply" && deps.saveManifest && validation.ok) {
					await deps.saveManifest(nextManifest);
					persisted = true;
				}

				return buildJsonSuccessEnvelope({
					command: "records",
					operation: "correct",
					nextCommand: mode === "dry-run" ? `records correct ${id} ${state} --apply` : "records list",
					nextCommands: mode === "dry-run" ? [`records correct ${id} ${state} --apply`] : [],
					extra: {
						mode,
						id,
						review,
						persisted,
						// A dry-run, or an apply with no injected sink, reports the change
						// without writing — honestly flagged.
						writable: deps.saveManifest !== undefined,
						validation: {
							ok: validation.ok,
							failureCount: validation.failures.length,
						},
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return buildJsonErrorEnvelope({
					command: "records",
					operation: "correct",
					error: "records_correct_failed",
					message,
					nextAction: "Check the record id + that the injected save sink is writable.",
				});
			}
		},
	};

	// A NEUTRAL data engine: group the records by a record-shape field and count them,
	// returning an envelope. It presumes no persona and serves many — an analyst can
	// build a requirements-analysis MOC from it, a citizen can inspect their own
	// records the same way — what differs per work is only how PROMINENT that view is,
	// not whether the engine applies. The base ships the engine; each work's surface (an
	// analysis area, a wallet, a dev view) is a level-3 extension that reads this
	// envelope and decides how much to feature it.
	const analyze: CapabilityDescriptor = {
		name: "analyze",
		summary:
			"Group the records by a dimension into a neutral envelope (grouping + counts)",
		options: [
			{
				name: "by",
				kind: "string",
				summary:
					"Dimension to group by: reviewState (default), type, or sourceRef",
			},
		],
		run(input): CapabilityEnvelope {
			const raw = input.options.by;
			const by = normalizeAnalyzeDimension(raw);
			const manifest = deps.loadManifest();

			// Build the groups: a map key → the records that fall under it (id+title+link,
			// the link being the vault-relative markdown file a MOC would point to).
			const groupsByKey = new Map<string, ManifestRecord[]>();
			for (const record of manifest.records) {
				for (const key of groupKeysFor(record, by)) {
					const list = groupsByKey.get(key) ?? [];
					list.push(record);
					groupsByKey.set(key, list);
				}
			}

			const groups = [...groupsByKey.entries()]
				.map(([key, records]) => ({
					key,
					label: key,
					count: records.length,
					records: records.map((r) => ({
						id: r.id,
						title: (r.fields.title as string | undefined) ?? r.id,
						// A vault-relative link a renderer (or a MOC.md writer) can point to.
						link: `${r.id.replace(/[^a-zA-Z0-9._-]+/g, "-")}.md`,
					})),
				}))
				.sort((a, b) => a.key.localeCompare(b.key));

			// A summary any renderer can headline with: total + per-reviewState counts.
			const byState: Record<string, number> = {};
			for (const record of manifest.records) {
				const state = record.review?.state ?? "unreviewed";
				byState[state] = (byState[state] ?? 0) + 1;
			}

			return buildJsonSuccessEnvelope({
				command: "records",
				operation: "analyze",
				extra: {
					by,
					summary: { total: manifest.records.length, byState },
					groups,
				},
			});
		},
	};

	return {
		name: "records",
		summary: "Inspect, enrich, correct, and analyze a records:v1 manifest",
		actions: { list, enrich, correct, analyze },
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

export function defineRecordsViewCapability(
	options: RecordsViewCapabilityOptions,
): CapabilityDescriptor {
	const analyzeAction = createRecordsCapabilityGroup(options.records).actions.analyze;
	return {
		name: options.name,
		summary: options.summary,
		...(options.options ? { options: options.options } : {}),
		transports: options.transports ?? {
			cli: {},
			repl: {},
			http: { method: "GET", path: options.httpPath ?? `/${options.name}` },
			agent: { tool: true, toolName: options.agentToolName ?? options.name },
		},
		renderers: options.renderers ?? {
			tui: { section: options.tuiSection ?? options.name },
		},
		async run(input): Promise<CapabilityEnvelope> {
			if (!analyzeAction) throw new Error("records analyze missing");
			const by = normalizeAnalyzeDimension(input.options.by, options.groupBy);
			const analysis = (await analyzeAction.run({
				args: {},
				options: { by },
				json: true,
			})) as unknown as RecordsAnalyzeEnvelope;
			return buildJsonSuccessEnvelope({
				command: options.name,
				operation: options.operation ?? "render",
				extra: await options.project(analysis, input),
			});
		},
	};
}
