import {
	computeRecordContentHash,
	CURRENT_RECORD_SCHEMA_VERSION,
	type KnowledgeRecord,
} from "@refarm.dev/records-contract-v1";

import {
	emptyVaultResult,
	type VaultFinding,
	type VaultNote,
	type VaultOrganizePlan,
	type VaultProfile,
	type VaultResult,
	type VaultSearchHit,
	type VaultSurface,
	type VaultVerb,
	VAULT_VERBS,
} from "./types.js";

/**
 * The reference vault surface. It proves the `vault-surface` component boundary
 * end-to-end with the smallest real matcher for EACH of the four verbs:
 *
 *   search   — match.type "contains": a note whose text includes a literal
 *              substring is a hit.
 *   extract  — match.type "frontmatter": build a KnowledgeRecord from the note's
 *              YAML frontmatter keys (a real profile parses richer records; the
 *              contract only needs one honest matcher to prove the boundary).
 *   organize — match.type "prefix-route": if the note text contains a marker,
 *              route it to a destination folder with a canonical file name.
 *   profile  — match.type "requires": flag a note whose text is MISSING a
 *              required substring (a hygiene check).
 *
 * matcher-is-data — every rule's `match` is opaque JSON the surface interprets,
 * so richer matchers ship as surface code + rule data, never a contract change.
 * An unknown match.type yields nothing (forward-safe): a newer profile's matcher
 * simply doesn't fire on this surface, it never errors.
 *
 * This surface imports NOTHING capability-bearing — it is pure compute over the
 * (note, profile) the host hands it, the same absence-is-the-sandbox discipline
 * the WASM world enforces structurally.
 */
export interface ReferenceVaultSurfaceOptions {
	surfaceId?: string;
}

export function createReferenceVaultSurface(
	options: ReferenceVaultSurfaceOptions = {},
): VaultSurface {
	return {
		surfaceId: options.surfaceId ?? "sovereign.reference-vault-surface",
		verbs: VAULT_VERBS,
		run(verb, note, profile) {
			return runReferenceVault(verb, note, profile);
		},
	};
}

/** Dispatch one verb against one note using the reference matchers. Deterministic
 * pure compute — the same (verb, note, profile) always yields the same result. */
export function runReferenceVault(
	verb: VaultVerb,
	note: VaultNote,
	profile: VaultProfile,
): VaultResult {
	const result = emptyVaultResult(verb);
	for (const rule of profile.rules) {
		if (rule.verb !== verb) continue;
		const match = parseMatch(rule.match);
		if (!match) continue;
		switch (verb) {
			case "search": {
				const hit = searchNote(note, rule.id, match);
				if (hit) result.hits.push(hit);
				break;
			}
			case "extract": {
				const record = extractRecord(note, rule.id, match);
				if (record) result.records.push(record);
				break;
			}
			case "organize": {
				const plan = organizeNote(note, rule.id, match);
				if (plan) result.plans.push(plan);
				break;
			}
			case "profile": {
				const finding = profileNote(note, rule.id, rule.severity, match);
				if (finding) result.findings.push(finding);
				break;
			}
		}
	}
	return result;
}

/** A rule's `match` field, parsed from its opaque JSON string. */
interface Match {
	type?: string;
	[key: string]: unknown;
}

function parseMatch(raw: string): Match | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object") return parsed as Match;
	} catch {
		// A malformed matcher fires nothing — forward-safe, never throws.
	}
	return undefined;
}

function str(match: Match, key: string): string | undefined {
	const value = match[key];
	return typeof value === "string" ? value : undefined;
}

// ── search: "contains" ──
function searchNote(note: VaultNote, ruleId: string, match: Match): VaultSearchHit | undefined {
	if (match.type !== "contains") return undefined;
	const value = str(match, "value");
	if (!value) return undefined;
	const index = note.text.indexOf(value);
	if (index < 0) return undefined;
	return {
		path: note.path,
		ruleId,
		locus: JSON.stringify({ index, match: value }),
		score: 1,
	};
}

// ── extract: "frontmatter" → KnowledgeRecord ──
function extractRecord(note: VaultNote, ruleId: string, match: Match): KnowledgeRecord | undefined {
	if (match.type !== "frontmatter") return undefined;
	const fields = parseFrontmatter(note.text);
	if (Object.keys(fields).length === 0) return undefined;
	const type = str(match, "recordType") ?? "VaultRecord";
	const record: KnowledgeRecord = {
		id: note.path,
		schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
		"@type": type,
		fields,
		sourceRefs: [note.path],
		contentHash: "",
	};
	record.contentHash = computeRecordContentHash(record);
	// The rule id is provenance for which matcher produced the record.
	record["ruleId"] = ruleId;
	return record;
}

/** A deliberately tiny YAML-frontmatter reader: the leading `---` block, one
 * `key: value` per line. Not a full YAML parser — the reference surface only
 * needs an honest, deterministic matcher; a real extract profile ships a richer
 * parser as surface code. */
function parseFrontmatter(text: string): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	if (!text.startsWith("---")) return fields;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return fields;
	const block = text.slice(3, end);
	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colon = trimmed.indexOf(":");
		if (colon < 0) continue;
		const key = trimmed.slice(0, colon).trim();
		const value = trimmed.slice(colon + 1).trim();
		if (key) fields[key] = value;
	}
	return fields;
}

// ── organize: "prefix-route" ──
function organizeNote(
	note: VaultNote,
	ruleId: string,
	match: Match,
): VaultOrganizePlan | undefined {
	if (match.type !== "prefix-route") return undefined;
	const marker = str(match, "marker");
	const destination = str(match, "destination");
	if (!marker || !destination) return undefined;
	if (!note.text.includes(marker)) return undefined;
	const base = note.path.split("/").pop() ?? note.path;
	const prefix = str(match, "prefix");
	const fileName = prefix ? `${prefix}${base}` : base;
	return { path: note.path, ruleId, destination, fileName };
}

// ── profile: "requires" ──
function profileNote(
	note: VaultNote,
	ruleId: string,
	severity: string | undefined,
	match: Match,
): VaultFinding | undefined {
	if (match.type !== "requires") return undefined;
	const value = str(match, "value");
	if (!value) return undefined;
	if (note.text.includes(value)) return undefined;
	return {
		severity: severity ?? "warn",
		ruleId,
		message: `note is missing required content: ${value}`,
		locus: JSON.stringify({ path: note.path }),
	};
}
