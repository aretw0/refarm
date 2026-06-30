import {
	ENRICHMENT_CAPABILITY,
	type EnrichmentChange,
	type EnrichmentErrorCode,
	type EnrichmentInput,
	type EnrichmentMode,
	type EnrichmentProvider,
	type EnrichmentProviderDescription,
	type EnrichmentRecordResult,
	type EnrichmentResult,
} from "./types.js";

export interface ReferenceEnrichmentEntry {
	readonly fields: Record<string, unknown>;
	readonly sourceRef?: string;
}

export interface ReferenceEnrichmentProviderOptions {
	pluginId?: string;
	providerId?: string;
	ruleId?: string;
	keyField?: string;
	fixture?: Record<string, ReferenceEnrichmentEntry>;
	now?: () => string;
}

export const DEFAULT_REFERENCE_ENRICHMENT_FIXTURE: Record<string, ReferenceEnrichmentEntry> = {
	"REQ-1": {
		fields: {
			"refarm.tags": ["requirements", "review"],
			"refarm.priority": "medium",
		},
		sourceRef: "fixture:enrichment/reference#REQ-1",
	},
	"REQ-2": {
		fields: {
			"refarm.tags": ["requirements", "accepted"],
			"refarm.priority": "high",
		},
		sourceRef: "fixture:enrichment/reference#REQ-2",
	},
};

const DEFAULT_NOW = "2026-06-30T00:00:00.000Z";

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right),
		);
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
	}

	return JSON.stringify(value);
}

function stableHash(value: unknown): string {
	const text = stableStringify(value);
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function incrementCode(
	byCode: Partial<Record<EnrichmentErrorCode, number>>,
	code: EnrichmentErrorCode,
): void {
	byCode[code] = (byCode[code] ?? 0) + 1;
}

function buildDiagnostics(records: EnrichmentRecordResult[]): EnrichmentResult["diagnostics"] {
	const byCode: Partial<Record<EnrichmentErrorCode, number>> = {};
	let enriched = 0;
	let skipped = 0;

	for (const record of records) {
		if (record.skipped) {
			skipped += 1;
			incrementCode(byCode, record.skipped.code);
			continue;
		}

		if (record.changes.length > 0) {
			enriched += 1;
		}
	}

	return {
		total: records.length,
		enriched,
		skipped,
		byCode,
	};
}

export function createReferenceEnrichmentProvider(
	options: ReferenceEnrichmentProviderOptions = {},
): EnrichmentProvider {
	const pluginId = options.pluginId ?? "@refarm.dev/enrichment-reference";
	const providerId = options.providerId ?? "refarm.reference-enrichment";
	const ruleId = options.ruleId ?? "fixture-map";
	const keyField = options.keyField ?? "externalKey";
	const fixture = options.fixture ?? DEFAULT_REFERENCE_ENRICHMENT_FIXTURE;
	const now = options.now ?? (() => DEFAULT_NOW);

	function describe(): EnrichmentProviderDescription {
		const addsFields = [
			...new Set(
				Object.values(fixture).flatMap((entry) => Object.keys(entry.fields)),
			),
		].sort();

		return {
			providerId,
			needsKeyFrom: [keyField],
			addsFields,
		};
	}

	function select(inputs: EnrichmentInput[]): EnrichmentInput[] {
		return inputs.filter((input) => typeof input.fields[keyField] === "string");
	}

	async function enrich(
		inputs: EnrichmentInput[],
		options?: { mode?: EnrichmentMode; signal?: AbortSignal },
	): Promise<EnrichmentResult> {
		options?.signal?.throwIfAborted();
		const mode = options?.mode ?? "dry-run";
		const records = inputs.map((input): EnrichmentRecordResult => {
			const rawKey = input.fields[keyField];
			if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
				return {
					id: input.id,
					changes: [],
					skipped: {
						code: "NO_KEY",
						message: `Input does not expose a string ${keyField} field.`,
					},
				};
			}

			const entry = fixture[rawKey];
			if (!entry) {
				return {
					id: input.id,
					changes: [],
					skipped: {
						code: "NO_MATCH",
						message: `No enrichment fixture entry for key ${rawKey}.`,
					},
				};
			}

			const changes: EnrichmentChange[] = Object.entries(entry.fields)
				.filter(([field, after]) => !Object.is(input.fields[field], after))
				.map(([field, after]) => ({
					field,
					before: input.fields[field],
					after,
					provenance: {
						providerId,
						ruleId,
						key: rawKey,
						sourceRef: entry.sourceRef,
						hash: stableHash(entry.fields),
						at: now(),
					},
				}));

			return { id: input.id, changes };
		});

		return {
			mode,
			records,
			diagnostics: buildDiagnostics(records),
		};
	}

	return {
		pluginId,
		capability: ENRICHMENT_CAPABILITY,
		describe,
		select,
		enrich,
	};
}
