import { computeRecordContentHash, type KnowledgeRecord } from "@refarm.dev/records-contract-v1";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** The minimal source-provider surface the ingest needs — just `materialize`. Typed
 * structurally so this module doesn't take a source-contract dependency (any source:v1
 * provider satisfies it). */
export interface IngestSourceProvider {
	materialize(
		ref: string,
		opts?: { offline?: boolean; force?: boolean },
	): Promise<{ location: { path: string } }>;
}

/**
 * The INGEST seam — the missing link between `source pull` and records. `source pull`
 * materializes a system into a local snapshot (its body); records hold the analyst's data.
 * Nothing turned the pulled body INTO records — so "pick a system → pull → the requirements
 * appear" had a gap. This closes it.
 *
 * ingestSourceToRecords materializes a ref, reads the snapshot body, and applies a
 * caller-supplied PARSER to turn it into records. The MECHANISM is generic (materialize →
 * read → parse → hash); the PARSER is the domain's (a requirements app parses its ALM HTML,
 * a notes app parses its export). The substrate ships the ingest; the app brings the parser
 * — the same split as source/enrichment.
 *
 * Runs in Node (it reads the materialized file). A WASM/daemon source works too as long as
 * its provider materializes to a readable location.
 */

/** What the parser receives: the raw body + where it came from. */
export interface SourceIngestContext {
	/** The source ref that was materialized (e.g. `web:efd`). */
	ref: string;
	/** The media type of the body, if the snapshot recorded one. */
	mediaType?: string;
	/** The on-disk location the snapshot materialized to. */
	location: string;
}

/** Turn a materialized source body into records. Return records WITHOUT a contentHash
 * (ingest computes it) — set `id`, `fields`, `sections`, `relations`, etc. as needed. */
export type SourceRecordParser = (
	body: string,
	context: SourceIngestContext,
) => Array<Omit<KnowledgeRecord, "contentHash"> & { contentHash?: string }>;

export interface IngestSourceToRecordsOptions {
	sourceProvider: IngestSourceProvider;
	/** The source ref to materialize + ingest (e.g. `web:efd`). */
	ref: string;
	/** Parses the materialized body into records (the domain step). */
	parse: SourceRecordParser;
	/** Materialize offline (replay a cached snapshot) — default true. */
	offline?: boolean;
	/** Re-materialize even if a snapshot exists. */
	force?: boolean;
	/** The snapshot body file name within the materialized location. Defaults to trying the
	 * common ones a source provider writes (source-web writes `content.html`). */
	bodyFileName?: string;
}

export interface IngestSourceResult {
	ref: string;
	/** The records parsed from the source, each with a computed contentHash. */
	records: KnowledgeRecord[];
	/** Where the source materialized (for provenance/debugging). */
	location: string;
}

const DEFAULT_BODY_FILES = ["content.html", "content.txt", "body.html", "snapshot.html"];

async function readSnapshotBody(locationPath: string, bodyFileName?: string): Promise<string> {
	const candidates = bodyFileName ? [bodyFileName] : DEFAULT_BODY_FILES;
	for (const name of candidates) {
		try {
			return await readFile(path.join(locationPath, name), "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
	}
	// Some providers materialize a single file at `location.path` (not a dir).
	try {
		return await readFile(locationPath, "utf-8");
	} catch {
		throw new Error(
			`INGEST_NO_BODY: no snapshot body found at ${locationPath} (looked for ${candidates.join(", ")})`,
		);
	}
}

/**
 * Materialize `ref`, read its snapshot body, parse it into records, and stamp each record's
 * contentHash. The records are RETURNED (not persisted) — a caller merges them into its
 * manifest / vault. Idempotent at the source level (materialize reuses a cached snapshot by
 * default), so re-ingesting the same ref yields the same records.
 */
export async function ingestSourceToRecords(
	options: IngestSourceToRecordsOptions,
): Promise<IngestSourceResult> {
	const materialized = await options.sourceProvider.materialize(options.ref, {
		offline: options.offline ?? true,
		force: options.force === true,
	});
	const locationPath = materialized.location.path;
	const body = await readSnapshotBody(locationPath, options.bodyFileName);

	const parsed = options.parse(body, { ref: options.ref, location: locationPath });

	const records: KnowledgeRecord[] = parsed.map((record) => {
		const withHash = { ...record, contentHash: "" } as KnowledgeRecord;
		withHash.contentHash = computeRecordContentHash(withHash);
		return withHash;
	});

	return { ref: options.ref, records, location: locationPath };
}
