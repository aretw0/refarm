/**
 * `requirements-activity` — the WEB "watch the machine work" face for T3: the requirements a pull/crawl
 * brings in, rendered as a LIVE, growing table (the reqbench twin of T1's agent-activity). Same generic
 * live-table engine (`mountLiveEventTable` from capability-homestead-surface), one domain row mapping.
 *
 * REPLAY a corpus offline (testable headless in jsdom), or FOLLOW a live SSE stream of pull progress. This
 * host cannot reach the official system the requirements are scraped from, so the FOLLOW path is a
 * ready-to-run seam (point it at a real pull's `/requirements/events` SSE); the REPLAY path works here with
 * the seed corpus and is unit-tested.
 */
import {
	arrayEventSource,
	eventSourceStream,
	mountLiveEventTable,
	type LiveEventSource,
} from "@refarm.dev/capability-homestead-surface";

/** One pulled requirement, structurally — what a pull/crawl yields (or the seed corpus carries). */
export interface RequirementActivityLine {
	id: string;
	tipo: string;
	title: string;
	status?: string;
	sistema?: string;
}

const COLUMNS = [
	{ key: "#", header: "#" },
	{ key: "id", header: "Requirement" },
	{ key: "tipo", header: "Type" },
	{ key: "status", header: "Status" },
	{ key: "title", header: "Title" },
];

/** Map a pulled requirement to a numbered table row — the web twin of the TUI renderTable's row. */
export function requirementActivityRow(req: RequirementActivityLine, index: number): Record<string, unknown> {
	return {
		"#": index + 1,
		id: req.id,
		tipo: req.tipo,
		status: req.status ?? "",
		title: req.title,
	};
}

export interface MountRequirementsActivityOptions {
	container: HTMLElement;
	source: LiveEventSource<RequirementActivityLine>;
	/** Keep only the last N rows — a rolling window; default unbounded. */
	maxRows?: number;
}

/** Mount the live requirements table into `container`, growing a row per requirement from `source`. */
export function mountRequirementsActivity(opts: MountRequirementsActivityOptions): () => void {
	return mountLiveEventTable({
		container: opts.container,
		source: opts.source,
		columns: COLUMNS,
		toRow: requirementActivityRow,
		caption: "Requirements — live",
		...(opts.maxRows !== undefined ? { maxRows: opts.maxRows } : {}),
	});
}

/** REPLAY a corpus of requirements into the live table (the offline/demo path — testable headless). */
export function replayRequirementsActivity(
	container: HTMLElement,
	requirements: readonly RequirementActivityLine[],
	maxRows?: number,
): () => void {
	return mountRequirementsActivity({
		container,
		source: arrayEventSource(requirements),
		...(maxRows !== undefined ? { maxRows } : {}),
	});
}

/** FOLLOW a live SSE stream of pull progress (browser-only; the server tail). Each SSE message is one JSON
 * requirement line. The render/grow logic it feeds is proven by replayRequirementsActivity's tests. */
export function followRequirementsActivity(container: HTMLElement, url: string): () => void {
	const source = eventSourceStream<RequirementActivityLine>(url, (data) => JSON.parse(data) as RequirementActivityLine);
	return mountRequirementsActivity({ container, source });
}
