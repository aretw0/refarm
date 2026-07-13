import {
	PROVENANCE_FIELD,
	type NoteProvenance,
	type ProvenanceCheck,
	type ProvenanceChecks,
	type ProvenanceVerificationResult,
} from "./types.js";

/** A minimal "fields bag" — a note's frontmatter/fields object. Kept structural so this
 * works on a KnowledgeRecord's `fields`, a plain frontmatter object, or any store. */
export type FieldsBag = Record<string, unknown>;

/**
 * Stamp `provenance` onto a fields bag under the reserved key, returning a NEW bag (never
 * mutates the input — a caller decides whether to persist). Undefined provenance fields
 * are dropped so a note carries only what it actually has. PURE.
 */
export function stampProvenance(fields: FieldsBag, provenance: NoteProvenance): FieldsBag {
	const clean: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(provenance)) {
		if (value !== undefined) clean[key] = value;
	}
	return { ...fields, [PROVENANCE_FIELD]: clean };
}

/** Read a note's provenance back from its fields, or `null` when absent/malformed. PURE. */
export function readProvenance(fields: FieldsBag | undefined): NoteProvenance | null {
	const value = fields?.[PROVENANCE_FIELD];
	if (!value || typeof value !== "object") return null;
	const p = value as Record<string, unknown>;
	if (typeof p.channel !== "string" || p.channel.trim().length === 0) return null;
	return p as NoteProvenance;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Verify a note's provenance: the required `channel`, and — only when present — the shape
 * of `collectedAt`, `contentSha256`, and that at least one origin locator exists. A note
 * with just a valid channel is valid (it knows how it arrived); the optional shape checks
 * only fire for fields that are set. PURE.
 */
export function verifyProvenance(provenance: NoteProvenance | null): ProvenanceVerificationResult {
	const checks: ProvenanceChecks = {};
	const failures: string[] = [];
	const record = (check: ProvenanceCheck) => {
		checks[check.name] = check;
		if (!check.ok) failures.push(check.detail ? `${check.name}: ${check.detail}` : check.name);
	};

	if (!provenance) {
		record({ name: "has-channel", ok: false, detail: "no provenance present" });
		return { valid: false, checks, failures };
	}

	record({
		name: "has-channel",
		ok: typeof provenance.channel === "string" && provenance.channel.trim().length > 0,
	});

	if (provenance.collectedAt !== undefined) {
		record({
			name: "collected-at-valid",
			ok: ISO_DATE.test(provenance.collectedAt),
			detail: ISO_DATE.test(provenance.collectedAt) ? undefined : `not ISO: ${provenance.collectedAt}`,
		});
	}
	if (provenance.contentSha256 !== undefined) {
		record({
			name: "sha256-shape",
			ok: SHA256_HEX.test(provenance.contentSha256),
			detail: SHA256_HEX.test(provenance.contentSha256) ? undefined : "not a 64-char hex sha256",
		});
	}
	// A soft check: at least one origin locator. Not a hard failure (a channel-only note is
	// valid), but recorded so a caller can require it via policy if it wants richer audit.
	const hasOrigin = Boolean(provenance.sourceFile || provenance.sourcePath || provenance.originLink);
	record({ name: "not-empty-origin", ok: hasOrigin });

	// `valid` = the REQUIRED checks (has-channel) + any present-field shape check. The
	// origin-locator check is soft, so it does not sink validity on its own.
	const hardFailures = failures.filter((f) => !f.startsWith("not-empty-origin"));
	return { valid: hardFailures.length === 0, checks, failures };
}
