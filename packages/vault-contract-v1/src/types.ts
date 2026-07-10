import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";

/**
 * This is the NATIVE (in-process) face of vault:v1. Its sovereign, sandboxed
 * sibling is the WASM component contract in `wit/vault.wit` (package
 * `refarm:vault@0.1.0`, world `vault-surface`). The two are the same contract
 * two ways — a vault surface is satisfied in-process here OR as a pure-compute
 * WASM component, and the host aggregates either's output the same way
 * ("native ↔ WASM parity", mirroring quality:v1 spec §3). Keep the shapes below
 * in step with the WIT records so the boundary can't drift; the WIT uses
 * kebab-case (rule-id) for the same fields.
 *
 * WHY vault:v1 EXISTS: two independent knowledge-vault POCs (a PARA markdown
 * vault of records, and a PARA daily-note vault) both need the SAME four generic
 * verbs over a vault — SEARCH, EXTRACT, ORGANIZE, PROFILE — and refarm's
 * `SourceProvider` deliberately stops at resolve/materialize/status/refresh (NO
 * read, NO search, NO extract). vault:v1 is that missing block, declared once so
 * a sandboxed component can supply it to any surface. The vault-specific rules
 * (a domain's split/parse logic, a PARA routing map) never enter this contract —
 * they ride in as matcher-is-data profiles the host hands the surface.
 */
export const VAULT_CAPABILITY = "vault:v1" as const;

/** The four generic verbs a vault surface can answer. Each is a distinct
 * `<pluginKey>:<verb>` dispatch target and has its own output shape below. A verb
 * a given surface doesn't implement simply returns an empty result — forward-safe,
 * never an error (mirrors the matcher-is-data forward-safety of quality:v1). */
export type VaultVerb = "search" | "extract" | "organize" | "profile";

/** All four verbs, as a readonly tuple, for iteration and validation. */
export const VAULT_VERBS: readonly VaultVerb[] = [
	"search",
	"extract",
	"organize",
	"profile",
] as const;

/**
 * What a vault surface inspects: one note the HOST has already read. The host
 * does the capability-bearing work (reads the file, lists the tree); the surface
 * only analyses the note text + its path, so it stays pure compute. `path` is the
 * note's vault-relative path (drives `organize`); `text` is its full content
 * (frontmatter + body). A closed record keeps the boundary typed; a later
 * contract version can add fields without breaking a reader.
 */
export interface VaultNote {
	/** The note's vault-relative path, e.g. `20-Projects/demanda-42.md`. */
	path: string;
	/** The note's full text content (YAML frontmatter + markdown body). */
	text: string;
}

/**
 * A rule. `match` is an OPAQUE JSON string the surface interprets (a query for
 * `search`, a section/frontmatter extractor for `extract`, a routing predicate
 * for `organize`, a quality assertion for `profile`) — matcher-is-data, so a new
 * matcher ships as surface code + rule data, never a contract edit. `verb` scopes
 * the rule to one of the four verbs; the host passes only the rules for the verb
 * being dispatched. This is the same json-as-string bridge the rest of the plugin
 * boundary uses.
 */
export interface VaultRule {
	id: string;
	verb: VaultVerb;
	/** Opaque JSON the surface interprets (matcher-is-data). */
	match: string;
	/** Optional open-string severity, meaningful for the `profile` verb. */
	severity?: string;
	description?: string;
	[key: string]: unknown;
}

/**
 * A named rule set. Composition (`extends`) is resolved by the host BEFORE
 * dispatch, so a surface always receives a flat, effective profile. A profile
 * mixes rules for any verb; the host filters to the dispatched verb's rules.
 */
export interface VaultProfile {
	name: string;
	extends?: string;
	rules: VaultRule[];
	[key: string]: unknown;
}

/** One `search` result: a note that matched, with an opaque locus the host
 * renders (line/snippet) and an optional relevance score. */
export interface VaultSearchHit {
	path: string;
	ruleId: string;
	/** Opaque JSON locus (line/snippet), rendered by the host. */
	locus?: string;
	/** Higher = more relevant. Open numeric hint, never required. */
	score?: number;
	[key: string]: unknown;
}

/**
 * One `organize` decision: where a note should live and under what canonical
 * name, resolved deterministically from a routing rule. The host performs the
 * move; the surface only decides. `destination` is a vault-relative folder,
 * `fileName` the canonical file name.
 */
export interface VaultOrganizePlan {
	path: string;
	ruleId: string;
	destination: string;
	fileName: string;
	[key: string]: unknown;
}

/** One `profile` finding: a quality/hygiene verdict over a note. Mirrors
 * quality:v1's finding so a profiling surface and a quality checker read alike. */
export interface VaultFinding {
	severity: string;
	ruleId: string;
	message: string;
	/** Opaque JSON locus (line/snippet), rendered by the host. */
	locus?: string;
	[key: string]: unknown;
}

/**
 * The output of dispatching one verb against one note. Exactly one field is
 * populated per verb (extract → records, search → hits, organize → plans,
 * profile → findings); the others are empty. Keeping it one shape lets the host
 * treat every verb's dispatch uniformly. `extract` emits `records-contract-v1`
 * KnowledgeRecords directly — the same nodes the silo already stores end to end.
 */
export interface VaultResult {
	verb: VaultVerb;
	records: KnowledgeRecord[];
	hits: VaultSearchHit[];
	plans: VaultOrganizePlan[];
	findings: VaultFinding[];
}

/** An empty result for a verb — the forward-safe default when no rule fires or a
 * surface doesn't implement the verb. */
export function emptyVaultResult(verb: VaultVerb): VaultResult {
	return { verb, records: [], hits: [], plans: [], findings: [] };
}

/**
 * The in-process face of a vault surface. A surface answers one verb at a time
 * against one note + the effective profile for that verb. Pure compute: no I/O,
 * deterministic for a deterministic (note, profile). The host produces the note
 * (reads the file) and resolves the profile; the surface only analyses. The WASM
 * sibling (world `vault-surface`) exports the same `run` and imports NOTHING —
 * that absence is the sandbox.
 */
export interface VaultSurface {
	readonly surfaceId: string;
	/** The verbs this surface implements. A verb outside this set returns empty. */
	readonly verbs: readonly VaultVerb[];
	run(verb: VaultVerb, note: VaultNote, profile: VaultProfile): VaultResult | Promise<VaultResult>;
}

export interface VaultConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export interface VaultConformanceOptions {
	note?: VaultNote;
	profile?: VaultProfile;
	profiles?: Record<string, VaultProfile>;
}
