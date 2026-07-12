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

/**
 * A RULES enrichment provider — the generic mechanic behind "scan a record's text/fields
 * and add a tag when a pattern matches" (a vault's rm-enrichment / a knowledge base's
 * auto-tagger). A rule is `{ matchSource, matchPattern → outputTag }`: if the pattern hits
 * any of the named field sources, the record gains `outputTag` in its tag field.
 *
 * It is deliberately generic — the substrate ships the ENGINE (idempotent, non-destructive,
 * provenance-tracked); a consumer brings its OWN rules (a domain app's `CNPJ → tag:cnpj`,
 * a research vault's `\bAPI\b → tag:integration`). The behaviours the reference vault proved
 * necessary are baked in:
 *   - idempotent: a tag already present is not re-added (no change emitted);
 *   - non-destructive: only the tag field is touched, never the body/other fields;
 *   - provenance: each added tag records which ruleId + a content hash + timestamp.
 */
export interface EnrichmentRule {
	/** Stable id for provenance (which rule added the tag). */
	id: string;
	/**
	 * Which field(s) of the record to test the pattern against. Values are read from
	 * `input.fields[source]`: a string is matched directly; an array/object is stringified.
	 * Defaults to the tag field's neighbours are NOT scanned — you name the sources.
	 */
	matchSource: string | string[];
	/** The pattern to test. A RegExp, or a string compiled with `matchFlags`. */
	matchPattern: RegExp | string;
	/** Flags used when `matchPattern` is a string (default "i"). Ignored for a RegExp. */
	matchFlags?: string;
	/** The tag to add to the tag field when the pattern matches. */
	outputTag: string;
}

export interface RulesEnrichmentProviderOptions {
	pluginId?: string;
	providerId?: string;
	/** The record field holding the tag array (default "sovereign.tags"). */
	tagField?: string;
	/** The rules to apply, in order. */
	rules: EnrichmentRule[];
	now?: () => string;
}

/** Read a field value as searchable text: strings as-is, arrays/objects stringified. */
function fieldAsText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	return JSON.stringify(value);
}

function ruleRegExp(rule: EnrichmentRule): RegExp {
	return rule.matchPattern instanceof RegExp
		? rule.matchPattern
		: new RegExp(rule.matchPattern, rule.matchFlags ?? "i");
}

/** Current tags as a string array (tolerates a missing/scalar field). */
function currentTags(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	if (typeof value === "string") return [value];
	return [];
}

export function createRulesEnrichmentProvider(
	options: RulesEnrichmentProviderOptions,
): EnrichmentProvider {
	const pluginId = options.pluginId ?? "@refarm.dev/enrichment-rules";
	const providerId = options.providerId ?? "sovereign.rules-enrichment";
	const tagField = options.tagField ?? "sovereign.tags";
	const rules = options.rules;
	const now = options.now ?? (() => DEFAULT_NOW);
	const compiled = rules.map((rule) => ({ rule, re: ruleRegExp(rule) }));

	function describe(): EnrichmentProviderDescription {
		return {
			providerId,
			// The engine reads the rule sources; it writes exactly the tag field.
			needsKeyFrom: [...new Set(rules.flatMap((rule) => [rule.matchSource].flat()))].sort(),
			addsFields: [tagField],
		};
	}

	// A record is a candidate only if it exposes at least one of the fields the rules read —
	// there is nothing to match against otherwise. (This is the enrichment:v1 "usable key"
	// filter: inputs with no matchable source are dropped here, not skipped in enrich.)
	const sourceFields = [...new Set(rules.flatMap((rule) => [rule.matchSource].flat()))];
	function select(inputs: EnrichmentInput[]): EnrichmentInput[] {
		return inputs.filter((input) =>
			sourceFields.some((field) => {
				const value = input.fields[field];
				return typeof value === "string"
					? value.length > 0
					: value !== undefined && value !== null;
			}),
		);
	}

	async function enrich(
		inputs: EnrichmentInput[],
		enrichOptions?: { mode?: EnrichmentMode; signal?: AbortSignal },
	): Promise<EnrichmentResult> {
		enrichOptions?.signal?.throwIfAborted();
		const mode = enrichOptions?.mode ?? "dry-run";

		const records = inputs.map((input): EnrichmentRecordResult => {
			// No matchable source at all → NO_KEY (the enrichment:v1 skip semantics: this
			// provider had nothing to read).
			const hasSource = sourceFields.some((field) => {
				const value = input.fields[field];
				return typeof value === "string"
					? value.length > 0
					: value !== undefined && value !== null;
			});
			if (!hasSource) {
				return {
					id: input.id,
					changes: [],
					skipped: { code: "NO_KEY", message: "No rule source field present on the record." },
				};
			}

			const tagsBefore = currentTags(input.fields[tagField]);
			const tagsNow = [...tagsBefore];

			for (const { rule, re } of compiled) {
				if (tagsNow.includes(rule.outputTag)) continue; // idempotent
				const sources = [rule.matchSource].flat();
				const text = sources.map((source) => fieldAsText(input.fields[source])).join("\n");
				if (re.test(text)) tagsNow.push(rule.outputTag);
			}

			if (tagsNow.length === tagsBefore.length) {
				// No rule contributed a new tag (nothing matched, or every match was already
				// present) → NO_MATCH. Not an error; the contract labels it a skip with a reason.
				return {
					id: input.id,
					changes: [],
					skipped: { code: "NO_MATCH", message: "No rule pattern matched the record." },
				};
			}

			// One change: the tag field, before → after. Provenance names the rules that
			// contributed the newly-added tags.
			const added = tagsNow.filter((tag) => !tagsBefore.includes(tag));
			const ruleId = compiled
				.filter(({ rule }) => added.includes(rule.outputTag))
				.map(({ rule }) => rule.id)
				.join(",");
			const change: EnrichmentChange = {
				field: tagField,
				before: tagsBefore,
				after: tagsNow,
				provenance: {
					providerId,
					ruleId,
					key: input.id,
					sourceRef: input.sourceRef,
					hash: stableHash(tagsNow),
					at: now(),
				},
			};
			return { id: input.id, changes: [change] };
		});

		return { mode, records, diagnostics: buildDiagnostics(records) };
	}

	return { pluginId, capability: ENRICHMENT_CAPABILITY, describe, select, enrich };
}
