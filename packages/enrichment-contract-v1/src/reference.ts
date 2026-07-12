import { buildDiagnostics, DEFAULT_NOW, stableHash } from "./internal.js";
import {
	ENRICHMENT_CAPABILITY,
	type EnrichmentChange,
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
			"sovereign.tags": ["requirements", "review"],
			"sovereign.priority": "medium",
		},
		sourceRef: "fixture:enrichment/reference#REQ-1",
	},
	"REQ-2": {
		fields: {
			"sovereign.tags": ["requirements", "accepted"],
			"sovereign.priority": "high",
		},
		sourceRef: "fixture:enrichment/reference#REQ-2",
	},
};

export function createReferenceEnrichmentProvider(
	options: ReferenceEnrichmentProviderOptions = {},
): EnrichmentProvider {
	const pluginId = options.pluginId ?? "@refarm.dev/enrichment-reference";
	const providerId = options.providerId ?? "sovereign.reference-enrichment";
	const ruleId = options.ruleId ?? "fixture-map";
	const keyField = options.keyField ?? "externalKey";
	const fixture = options.fixture ?? DEFAULT_REFERENCE_ENRICHMENT_FIXTURE;
	const now = options.now ?? (() => DEFAULT_NOW);

	function describe(): EnrichmentProviderDescription {
		const addsFields = [
			...new Set(Object.values(fixture).flatMap((entry) => Object.keys(entry.fields))),
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
