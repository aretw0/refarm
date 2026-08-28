import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { slugify as stdSlugify } from "@refarm.dev/std";

import { profileForVerb } from "./profile.js";
import type { VaultNote, VaultOrganizePlan, VaultProfile, VaultSearchHit } from "./types.js";

/** The minimal ORGANIZE plan `organizeRecords` reads — the concrete fields, no index
 * signature, so a `VaultOrganizePlan` AND a WASM component's `SurfaceOrganizePlan` (which
 * lacks the `[key: string]` catch-all) both satisfy it. */
interface DispatchOrganizePlan {
	path: string;
	ruleId: string;
	destination: string;
	fileName: string;
}

/** The minimal dispatch result `organizeRecords` reads: only the `plans`. Structural so a
 * full `VaultResult` AND a loaded WASM component's result (whose `verb` is a bare string)
 * both satisfy it — no cast at the call site. */
interface OrganizeDispatchResult {
	plans: DispatchOrganizePlan[];
}

/** The minimal surface `organizeRecords` needs: dispatch a verb and get back something with
 * `plans`. `verb` is a bare string (the four verb names) so a VaultSurface AND a WASM
 * component surface (which types verb as string) both satisfy it — the caller passes either
 * with no wrapper and no cast. */
export interface OrganizeDispatcher {
	run(
		verb: string,
		note: VaultNote,
		profile: VaultProfile,
	): OrganizeDispatchResult | Promise<OrganizeDispatchResult>;
}

/**
 * DX helpers for the common "organize a set of records into PARA destinations" flow, so a
 * consumer (a note-box example, a vault app) does it in ONE call instead of hand-writing
 * record→note conversion + per-note dispatch + plan collection. The plumbing lives here;
 * the consumer brings its records + a taxonomy profile (data) and gets back the plans.
 */

/** Render one frontmatter value as a SINGLE YAML line — never breaking out of the `---` fence.
 * Objects/arrays become compact JSON; a scalar whose string form contains a newline (a multi-line
 * `body`, an embedded markdown field) is JSON-encoded so the newline is escaped to `\n` instead of
 * splitting the frontmatter. A plain single-line scalar renders as-is. PURE. */
/**
 * Does this scalar change meaning when written unquoted in YAML? PURE.
 *
 * The dangerous case in a knowledge vault is `[[Note]]`: unquoted it is a nested flow SEQUENCE,
 * so a wikilink silently becomes `[["Note"]]` — the value survives a diff and dies at parse. The
 * rest are the standard indicator characters, the `: ` / ` #` separators, surrounding whitespace,
 * and the plain scalars YAML would retype (`true`, `null`, `1.5`).
 */
function needsYamlQuoting(str: string): boolean {
	if (str === "") return true;
	if (str !== str.trim()) return true;
	if (/[\n\r]/.test(str)) return true;
	// Leading indicator characters: everything after this position is ordinary text.
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(str)) return true;
	// `: ` opens a mapping and ` #` opens a comment, anywhere in the scalar.
	if (str.includes(": ") || str.includes(" #")) return true;
	// Plain scalars YAML retypes away from string.
	if (/^(true|false|null|~|yes|no|on|off)$/i.test(str)) return true;
	if (/^[+-]?(\d[\d_]*)(\.\d*)?([eE][+-]?\d+)?$/.test(str)) return true;
	return false;
}

function frontmatterValue(value: unknown): string {
	if (typeof value === "object") return JSON.stringify(value);
	const str = String(value);
	// Numbers and booleans arrive already typed; only strings can be retyped by quoting them, so
	// they are the only ones asked. JSON quoting is YAML-compatible double quoting.
	if (typeof value !== "string") return str;
	return needsYamlQuoting(str) ? JSON.stringify(str) : str;
}

/** Render a record's `fields` as a minimal YAML frontmatter block — enough for a matcher
 * that routes by frontmatter (taxonomy-route reads `tipo`/`sistema`/… from here). Every value is
 * emitted as a single line (multi-line/object values are JSON-encoded), so a field carrying
 * markdown (e.g. `body`) can never break the `---` fence. PURE. */
function fieldsToFrontmatter(fields: Record<string, unknown>): string {
	const lines: string[] = ["---"];
	for (const [key, value] of Object.entries(fields)) {
		if (value === null || value === undefined) continue;
		// The KEY is always present (so a `frontmatter-required` gate sees it); the value is a
		// single, fence-safe line. A routing axis reads a plain string, so it simply won't match a
		// JSON-encoded object/multiline value — forward-safe.
		lines.push(`${key}: ${frontmatterValue(value)}`);
	}
	lines.push("---", "");
	return lines.join("\n");
}

/**
 * Turn a KnowledgeRecord into a VaultNote the vault surface can analyse: its `path` (an
 * id/path the organize plan is keyed by) plus `text` = frontmatter (from `fields`) + body
 * (the record's sections, if any). The record's own id is the note path when it has no
 * explicit path, so a plan round-trips back to the record. PURE.
 */
export function recordToVaultNote(record: KnowledgeRecord): VaultNote {
	const path =
		typeof record.fields?.path === "string" ? (record.fields.path as string) : record.id;
	const parts = (record.sections ?? [])
		.map((s) => (typeof s.content === "string" ? s.content : ""))
		.filter(Boolean);
	// Traceability: render the record's relations as a markdown block, so a MATERIALIZED note
	// carries its links (deriva-de / satisfaz / referencia …), not only the aggregate MOC/graph.
	// A wikilink for an in-corpus target (another record id); the raw target otherwise.
	const relations = record.relations ?? [];
	if (relations.length > 0) {
		const links = relations.map((rel) => `- ${rel.type} → [[${rel.target}]]`).join("\n");
		parts.push(`## Rastreabilidade\n${links}`);
	}
	const body = parts.join("\n\n");
	return { path, text: `${fieldsToFrontmatter(record.fields ?? {})}${body}\n` };
}

/** One organize plan tied back to the record it came from. */
export interface RecordOrganizePlan extends VaultOrganizePlan {
	/** The id of the record this plan routes. */
	recordId: string;
}

/**
 * Organize a set of records into PARA destinations in ONE call: render each to a note,
 * dispatch the `organize` verb through `surface` under `profile`, and return the plans
 * keyed back to their records. A record that matches no routing rule yields no plan (it
 * stays put) — the result only carries records that WILL move.
 *
 * Async because a sovereign WASM-backed surface dispatches asynchronously; it transparently
 * awaits a sync reference surface too, so the CALLER chooses sovereignty (the reference
 * surface for a test, the zero-import WASM component in production) without changing this
 * call. That is the DX point: one await, any surface.
 */
export async function organizeRecords(
	surface: OrganizeDispatcher,
	records: readonly KnowledgeRecord[],
	profile: VaultProfile,
): Promise<RecordOrganizePlan[]> {
	const organizeProfile = profileForVerb(profile, "organize");
	const plans: RecordOrganizePlan[] = [];
	for (const record of records) {
		const note = recordToVaultNote(record);
		const result = await surface.run("organize", note, organizeProfile);
		for (const plan of result.plans) {
			plans.push({ ...plan, recordId: record.id });
		}
	}
	return plans;
}

/** The minimal SEARCH hit `searchRecords` reads — concrete fields only, so a full `VaultSearchHit`
 * AND a WASM component's `SurfaceSearchHit` (no `[key: string]` catch-all) both satisfy it. */
interface DispatchSearchHit {
	path: string;
	ruleId: string;
	locus?: string;
	score?: number;
}

/** The minimal dispatch result `searchRecords` reads: only the `hits`. Structural so a full
 * `VaultResult` AND a loaded WASM component's result both satisfy it — no cast at the call site. */
interface SearchDispatchResult {
	hits: DispatchSearchHit[];
}

/** The minimal surface `searchRecords` needs: dispatch `search` and get back something with
 * `hits`. `verb` is a bare string so a VaultSurface AND a WASM component surface both satisfy it. */
export interface SearchDispatcher {
	run(
		verb: string,
		note: VaultNote,
		profile: VaultProfile,
	): SearchDispatchResult | Promise<SearchDispatchResult>;
}

/** One search hit tied back to the record it came from. */
export interface RecordSearchHit extends VaultSearchHit {
	/** The id of the record this hit is in. */
	recordId: string;
}

/**
 * Build a `search` profile from a plain query — one `contains` rule per query term (AND across
 * terms is the caller's concern; each term is its own rule, so a note matching ANY term yields a
 * hit for that term). Matcher-is-data: the query becomes rules the sovereign surface interprets,
 * never code. PURE.
 */
export function searchProfileForQuery(query: string): VaultProfile {
	const terms = query
		.split(/\s+/)
		.map((t) => t.trim())
		.filter(Boolean);
	return {
		name: "requirements-search",
		rules: terms.map((term, i) => ({
			id: `q-${i}`,
			verb: "search" as const,
			match: JSON.stringify({ type: "contains", value: term }),
		})),
	};
}

/**
 * Search a set of records in ONE call: render each to a note, dispatch the `search` verb through
 * `surface` under a query-derived profile, and return the hits keyed back to their records. The
 * SAME sovereign surface that routes (`organize`) also searches — the query is data the surface
 * interprets, not a code path the host owns.
 *
 * Async for the same reason as `organizeRecords`: a WASM surface dispatches asynchronously; a sync
 * reference surface is awaited transparently, so the caller chooses sovereignty without changing
 * this call.
 */
export async function searchRecords(
	surface: SearchDispatcher,
	records: readonly KnowledgeRecord[],
	query: string,
): Promise<RecordSearchHit[]> {
	const profile = searchProfileForQuery(query);
	if (profile.rules.length === 0) return [];
	const hits: RecordSearchHit[] = [];
	for (const record of records) {
		const note = recordToVaultNote(record);
		const result = await surface.run("search", note, profile);
		for (const hit of result.hits) {
			hits.push({ ...hit, recordId: record.id });
		}
	}
	return hits;
}

/** A writable note file: where it goes + what it contains, keyed back to its record. PURE data —
 * a filesystem writer (or an OPFS/store writer) consumes these; the planner never touches I/O. */
export interface RecordFilePlan {
	/** The record this file materializes. */
	recordId: string;
	/** The destination folder (the organize plan's PARA area), relative to the vault root. Empty
	 * string = the vault root (an unrouted record). */
	destination: string;
	/** The file name (with extension). */
	fileName: string;
	/** The relative path `destination/fileName` — the write target under the vault root. */
	relativePath: string;
	/** The full note content: YAML frontmatter (from the record's fields) + body. */
	text: string;
}

/** Slugify a title/id into a safe file-name stem \u2014 the shared, accent-aware @refarm.dev/std slug. */
function slugify(value: string): string {
	return stdSlugify(value, { maxLength: 80, fallback: "note" });
}

export interface PlanRecordFilesOptions {
	/** Organize plans (from `organizeRecords`) that give a record its destination folder + file
	 * name. A record with no matching plan is materialized at the root with a slugified name. */
	plans?: readonly RecordOrganizePlan[];
	/** Override the file name for a record (else the plan's fileName, else `<slug>.md`). */
	fileNameFor?: (record: KnowledgeRecord) => string;
}

/**
 * Plan the note FILES for a set of records — the pure step before materializing a vault to disk.
 * Each record becomes a `RecordFilePlan` (destination + fileName + relativePath + rendered text),
 * using its organize plan for placement when one exists. No I/O: a filesystem writer (or any
 * store) consumes these, so the planner is testable and substrate-pure. This is the reusable
 * half of "records → Obsidian notes on disk"; the consumer supplies the writer + idempotency.
 */
export function planRecordFiles(
	records: readonly KnowledgeRecord[],
	options: PlanRecordFilesOptions = {},
): RecordFilePlan[] {
	const planByRecord = new Map((options.plans ?? []).map((p) => [p.recordId, p]));
	return records.map((record) => {
		const note = recordToVaultNote(record);
		const plan = planByRecord.get(record.id);
		const destination = plan?.destination ?? "";
		const titleForName =
			typeof record.fields?.title === "string" ? (record.fields.title as string) : record.id;
		const fileName = options.fileNameFor?.(record) ?? plan?.fileName ?? `${slugify(titleForName)}.md`;
		const relativePath = destination ? `${destination}/${fileName}` : fileName;
		return { recordId: record.id, destination, fileName, relativePath, text: note.text };
	});
}
