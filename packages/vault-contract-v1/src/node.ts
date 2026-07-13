import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { RecordFilePlan } from "./organize.js";

/**
 * The FILESYSTEM half of "records → Obsidian notes on disk" — the writer `planRecordFiles`
 * deliberately left to the consumer. This is a `node`-flavored module (it touches fs), kept out
 * of the pure contract index: import it from `@refarm.dev/vault-contract-v1/node`.
 *
 * The machine here is the IDEMPOTENT write: a note is written only when its content actually
 * differs from what is on disk (skip-if-identical), so re-materializing an unchanged vault is a
 * no-op. A `normalizeForCompare` hook lets a consumer exclude a volatile line from the comparison
 * (e.g. a per-run sync timestamp) so it doesn't force a rewrite — the machinery is shared, the
 * volatile-field knowledge stays the consumer's.
 */

export interface RecordFileWriterOptions {
	/** The vault root the plans' relative paths are written under. */
	root: string;
	/** Normalize both the on-disk and the new content before comparing for equality — return a
	 * comparable string. Use this to drop a volatile line (a sync timestamp) so a note that differs
	 * ONLY there is treated as unchanged and kept. Default: identity (exact-content comparison). */
	normalizeForCompare?: (text: string) => string;
	/** Injected fs ops (for tests). Default: node:fs. */
	fs?: {
		readFileSync: (file: string, enc: "utf8") => string;
		writeFileSync: (file: string, data: string, enc: "utf8") => void;
		mkdirSync: (dir: string, opts: { recursive: true }) => void;
	};
}

/** Whether a single write happened or was skipped as unchanged. */
export type RecordFileWriteOutcome = "written" | "skipped";

/**
 * Build an idempotent note writer: `(relativePath, text) → "written" | "skipped"`. Writes
 * `<root>/<relativePath>` only when the (normalized) content differs from disk; creates parent
 * dirs. Skip-if-identical mirrors an operational scraper — a re-run rewrites only what changed.
 */
export function createRecordFileWriter(
	options: RecordFileWriterOptions,
): (relativePath: string, text: string) => RecordFileWriteOutcome {
	const fs = options.fs ?? { readFileSync, writeFileSync, mkdirSync };
	const normalize = options.normalizeForCompare ?? ((t: string): string => t);
	return (relativePath, text) => {
		const file = path.join(options.root, relativePath);
		try {
			if (normalize(fs.readFileSync(file, "utf8")) === normalize(text)) return "skipped";
		} catch {
			// absent / unreadable → write it
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text, "utf8");
		return "written";
	};
}

export interface MaterializeResult {
	written: number;
	skipped: number;
	/** The per-file outcomes, keyed by relative path. */
	outcomes: Array<{ path: string; outcome: RecordFileWriteOutcome }>;
}

/**
 * Materialize a set of `RecordFilePlan`s (from `planRecordFiles`) to disk idempotently, returning
 * the written/skipped tally. The whole "plan → write, skip unchanged" flow in one call — the fs
 * companion to the pure `planRecordFiles`.
 */
export function materializeRecordFiles(
	plans: readonly RecordFilePlan[],
	options: RecordFileWriterOptions,
): MaterializeResult {
	const write = createRecordFileWriter(options);
	const outcomes: MaterializeResult["outcomes"] = [];
	let written = 0;
	let skipped = 0;
	for (const plan of plans) {
		const outcome = write(plan.relativePath, plan.text);
		outcomes.push({ path: plan.relativePath, outcome });
		if (outcome === "written") written += 1;
		else skipped += 1;
	}
	return { written, skipped, outcomes };
}
