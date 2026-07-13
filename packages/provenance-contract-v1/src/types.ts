/**
 * provenance:v1 — WHERE a note came from. Any ingestion of dispersed data (a scraped
 * artifact, a feed item, an inbox message, a requirements pull) must record its origin so
 * the note is auditable and sovereign: from which source/file/path, when it was collected,
 * under what license and privacy, with a content fingerprint to detect drift.
 *
 * This is the atom two independent note-boxes (a vault template and an operational
 * requirements vault) each carried DUPLICATED in their own frontmatter — evidence it wants
 * to be one contract. The field names unify theirs (`fonte_arquivo`/`fonte_caminho`/
 * `link_origem`/`origem_*` and `source`/`collectedAt`/`sha256`/`license`/`privacy`) under
 * neutral, agnostic names. It rides on a record's `fields` (records-contract-v1) but is
 * modeled standalone and dependency-light, so any store — not just KnowledgeRecords — can
 * carry provenance.
 */

export const PROVENANCE_CAPABILITY = "provenance:v1" as const;

/** The frontmatter key a note's provenance is stored under (a single nested object, so it
 * never collides with domain fields and a reader finds it in one place). */
export const PROVENANCE_FIELD = "provenance" as const;

/** A privacy posture for a note's content. Open string beyond these so a domain can add
 * its own, but these are the shared vocabulary. */
export type ProvenancePrivacy =
	| "public"
	| "internal"
	| "private"
	| "private-until-published"
	| (string & {});

/**
 * The provenance of one note — where it came from and under what terms. Every field is
 * OPTIONAL except `channel`: a note always knows HOW it arrived (the ingestion channel),
 * even when a specific file/link is not applicable. Unknown/absent fields are simply
 * omitted (never `null` sentinels), so a note carries only the provenance it actually has.
 */
export interface NoteProvenance {
	/** HOW the note arrived — the ingestion channel/source system (e.g. "inbox-markdown",
	 * "web-scrape", "telegram", "requirements-pull"). The one required field. */
	channel: string;
	/** The origin FILE the note was extracted from (basename), when applicable. */
	sourceFile?: string;
	/** The origin PATH relative to the source root, when applicable. */
	sourcePath?: string;
	/** A canonical link back to the origin (a URL/URI), when the source has one. */
	originLink?: string;
	/** When the note was collected (ISO 8601). */
	collectedAt?: string;
	/** A SHA-256 hex fingerprint of the source content, to detect drift on re-ingest. */
	contentSha256?: string;
	/** The content's license (or "verificar"/"unknown" when not yet determined). */
	license?: string;
	/** The privacy posture governing publication. */
	privacy?: ProvenancePrivacy;
	/** Free extra provenance a domain preserves (e.g. `origem_sistema`, `alm_source_url`).
	 * Kept open so a domain never has to fork the contract to carry an extra origin fact. */
	[extra: string]: unknown;
}

/** The named checks `verify` runs over a note's provenance. */
export type ProvenanceCheckName =
	| "has-channel" // the required channel is present and non-empty
	| "collected-at-valid" // collectedAt, if present, is a valid ISO date
	| "sha256-shape" // contentSha256, if present, is a 64-char hex string
	| "not-empty-origin"; // at least one of sourceFile/sourcePath/originLink is present

export interface ProvenanceCheck {
	name: ProvenanceCheckName;
	ok: boolean;
	detail?: string;
}

export type ProvenanceChecks = Partial<Record<ProvenanceCheckName, ProvenanceCheck>>;

export interface ProvenanceVerificationResult {
	/** All REQUIRED checks passed (has-channel; shape checks only when the field exists). */
	valid: boolean;
	checks: ProvenanceChecks;
	failures: string[];
}

export interface ProvenanceConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
