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
		if (typeof value === "object") continue; // routing reads scalars
		lines.push(`${key}: ${String(value)}`);
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
