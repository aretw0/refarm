import {
	computeRecordContentHash,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import {
	DEFAULT_WEB_SOURCE_FIXTURE,
	type WebSourceSnapshot,
} from "@refarm.dev/source-web";

/**
 * This file is the WORK layer — the notesbox app's OWN domain data. It carries the
 * vocabulary a real deployment would (here: a "requirements" note box). refarm never
 * holds any of this; the app injects it into the neutral blocks and gets the verbs.
 *
 * A production white-label app would replace these fixtures with a real authenticated
 * source provider and a real records manifest; the SHAPE of what it injects is exactly
 * what's here.
 */

/** The source identity + ref this app pulls. `web:<identity>` → the fixture below. */
export const NOTESBOX_SOURCE_IDENTITY = "notesbox-requirements";
export const NOTESBOX_SOURCE_REF = `web:${NOTESBOX_SOURCE_IDENTITY}`;

/** The app's OWN offline source snapshot — its work-specific "requirements" content.
 * Keyed by identity into the source provider's fixtures map. Built off the source-web
 * default so only the domain-specific fields (identity/url/body) diverge. */
export const NOTESBOX_SOURCE_FIXTURE: WebSourceSnapshot = {
	...DEFAULT_WEB_SOURCE_FIXTURE,
	identity: NOTESBOX_SOURCE_IDENTITY,
	url: "https://notesbox.example/requirements",
	body: [
		"<!doctype html>",
		"<html><body>",
		"<article data-req='REQ-1'>Coletar requisitos do note box</article>",
		"<article data-req='REQ-2'>Revisar requisitos aceitos</article>",
		"</body></html>",
	].join(""),
};

export const NOTESBOX_SOURCE_FIXTURES: Record<string, WebSourceSnapshot> = {
	[NOTESBOX_SOURCE_IDENTITY]: NOTESBOX_SOURCE_FIXTURE,
};

/**
 * The app's OWN records manifest — the "requirements" note box. Each record carries an
 * `externalKey` the app's enrichment fixture matches on (`REQ-1`/`REQ-2`). This is the
 * data `records enrich` operates over and `vault init` seeds into markdown. refarm
 * ships NONE of it — it enters only through the injected `loadManifest` / `seed`.
 */
export function notesboxManifest(): RecordsManifest {
	const records = [
		{
			id: "record:req-root",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "Requirement"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: { title: "Requisito raiz", status: "draft", externalKey: "REQ-1" },
			sections: [
				{ key: "description", content: "O requisito raiz do note box." },
			],
			sourceRefs: [NOTESBOX_SOURCE_REF],
			review: { state: "draft", at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		},
		{
			id: "record:req-child",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "Requirement"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: { title: "Requisito filho", status: "reviewed", externalKey: "REQ-2" },
			sections: [
				{ key: "acceptance", content: "- Deve preservar campos desconhecidos." },
			],
			sourceRefs: [NOTESBOX_SOURCE_REF],
			review: { state: "reviewed", at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		},
	].map((record) => ({ ...record, contentHash: computeRecordContentHash(record) }));

	return { manifestVersion: 1, records } as unknown as RecordsManifest;
}
