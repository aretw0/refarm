import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";

import { profileForVerb } from "./profile.js";
import type { VaultNote, VaultOrganizePlan, VaultProfile } from "./types.js";

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

/** Render a record's `fields` as a minimal YAML frontmatter block — enough for a matcher
 * that routes by frontmatter (taxonomy-route reads `tipo`/`sistema`/… from here). Scalar
 * fields only (the routing keys are scalars); nested/array fields are skipped, since a
 * routing axis reads a string value. PURE. */
function fieldsToFrontmatter(fields: Record<string, unknown>): string {
	const lines: string[] = ["---"];
	for (const [key, value] of Object.entries(fields)) {
		if (value === null || value === undefined) continue;
		// Object/array fields (e.g. a nested `provenance`) render as a compact JSON scalar:
		// the KEY is present (so a `frontmatter-required` gate sees it) and its value is
		// readable. A routing axis reads a plain string value, so it simply won't match an
		// object field — forward-safe. Scalars render as-is.
		lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
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
	const body = (record.sections ?? [])
		.map((s) => (typeof s.content === "string" ? s.content : ""))
		.join("\n\n");
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

/** Slugify a title/id into a safe file-name stem (lowercase, ascii-ish, dash-separated). */
function slugify(value: string): string {
	return (
		value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "note"
	);
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
