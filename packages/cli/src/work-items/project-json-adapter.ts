import type {
	CapabilityTable,
	CoercedValue,
	WorkItem,
	WorkItemAdapter,
	WorkItemAxis,
	WorkItemReadResult,
	WorkItemStatus,
	WorkItemWriteResult,
} from "./contract.js";
import { WORK_ITEM_AXES, WORK_ITEM_STATUSES } from "./contract.js";

/** The document's own field names, which are snake_case where the contract is camelCase. */
const KNOWN_DOCUMENT_FIELDS = new Set([
	"id",
	"title",
	"body",
	"location",
	"status",
	"priority",
	"category",
	"package",
	"axis",
	"requirement",
	"source",
	"resolved_by",
]);

const PROJECT_JSON_CAPABILITIES: CapabilityTable = Object.freeze({
	id: "native",
	title: "native",
	body: "native",
	location: "native",
	status: "native",
	priority: "native",
	category: "native",
	package: "native",
	axis: "native",
	requirement: "native",
	source: "native",
	resolvedBy: "native",
});

export interface ProjectJsonAdapterOptions {
	readDocument: () => string;
	writeDocument: (contents: string) => void;
}

/** Shared shape for the one failure mode `readRecords`/`write` can throw: the document could not
 * be parsed or written. Extracted so `list`, `add` and `setStatus` derive the same error the same
 * way instead of three copies drifting apart. */
function documentUnreadableError(error: unknown): { reason: string; message: string } {
	return {
		reason: "document_unreadable",
		message: error instanceof Error ? error.message : String(error),
	};
}

/**
 * NEVER SILENTLY. `coerced` collects what this reader had to substitute, so a value the contract
 * has no name for is reported by `issues validate` rather than absorbed.
 *
 * The status coercion is the one that lied. An unrecognised axis becomes `undefined` — the reader
 * saying it does not know. An unrecognised status became `"open"`, which is a claim about the work:
 * two finished items written as `"closed"` reappeared in the operator's open queue on 2026-08-11,
 * and `validate` passed while it happened.
 */
function toWorkItem(record: Record<string, unknown>, coerced: CoercedValue[]): WorkItem {
	const id = String(record.id ?? "");
	const rawStatus = record.status;
	const status = WORK_ITEM_STATUSES.includes(rawStatus as WorkItemStatus)
		? (rawStatus as WorkItemStatus)
		: "open";
	if (rawStatus !== undefined && rawStatus !== status) {
		coerced.push({ id, field: "status", raw: String(rawStatus), readAs: status });
	}
	const axisValue = record.axis;
	if (axisValue !== undefined && !WORK_ITEM_AXES.includes(axisValue as never)) {
		coerced.push({ id, field: "axis", raw: String(axisValue), readAs: "(absent)" });
	}
	return {
		id,
		title: String(record.title ?? ""),
		body: String(record.body ?? ""),
		location: String(record.location ?? ""),
		status,
		priority: String(record.priority ?? ""),
		category: String(record.category ?? ""),
		package: String(record.package ?? ""),
		axis: WORK_ITEM_AXES.includes(axisValue as never) ? (axisValue as WorkItem["axis"]) : undefined,
		requirement: typeof record.requirement === "string" ? record.requirement : undefined,
		source: typeof record.source === "string" ? record.source : undefined,
		resolvedBy: typeof record.resolved_by === "string" ? record.resolved_by : undefined,
	};
}

function toDocumentRecord(item: WorkItem): Record<string, unknown> {
	const record: Record<string, unknown> = {
		id: item.id,
		title: item.title,
		body: item.body,
		location: item.location,
		status: item.status,
		category: item.category,
		priority: item.priority,
		package: item.package,
	};
	if (item.axis) record.axis = item.axis;
	if (item.requirement) record.requirement = item.requirement;
	if (item.source) record.source = item.source;
	if (item.resolvedBy) record.resolved_by = item.resolvedBy;
	return record;
}

export function createProjectJsonAdapter(options: ProjectJsonAdapterOptions): WorkItemAdapter {
	function readRecords(): { records: Record<string, unknown>[]; extraFields: string[] } {
		const parsed = JSON.parse(options.readDocument()) as { issues?: unknown };
		const records = Array.isArray(parsed.issues)
			? (parsed.issues as Record<string, unknown>[])
			: [];
		const extras = new Set<string>();
		for (const record of records) {
			for (const key of Object.keys(record)) {
				if (!KNOWN_DOCUMENT_FIELDS.has(key)) extras.add(key);
			}
		}
		return { records, extraFields: [...extras].sort() };
	}

	function write(records: Record<string, unknown>[]): void {
		options.writeDocument(`${JSON.stringify({ issues: records }, null, "\t")}\n`);
	}

	return {
		provider: "project-json",
		capabilities: () => PROJECT_JSON_CAPABILITIES,

		list(): WorkItemReadResult {
			try {
				const { records, extraFields } = readRecords();
				const coercedValues: CoercedValue[] = [];
				const items = records.map((record) => toWorkItem(record, coercedValues));
				return { ok: true, items, extraFields, coercedValues, error: null };
			} catch (error) {
				return {
					ok: false,
					items: [],
					extraFields: [],
					coercedValues: [],
					error: documentUnreadableError(error),
				};
			}
		},

		add(item: WorkItem): WorkItemWriteResult {
			try {
				const { records } = readRecords();
				if (records.some((record) => String(record.id) === item.id)) {
					return {
						ok: false,
						item: null,
						error: { reason: "duplicate_id", message: `Work item ${item.id} already exists.` },
					};
				}
				write([...records, toDocumentRecord(item)]);
				return { ok: true, item, error: null };
			} catch (error) {
				return { ok: false, item: null, error: documentUnreadableError(error) };
			}
		},

		setStatus(id: string, status: WorkItemStatus, resolvedBy?: string): WorkItemWriteResult {
			if (status === "resolved" && !resolvedBy?.trim()) {
				return {
					ok: false,
					item: null,
					error: {
						reason: "resolved_by_required",
						message: "Resolving a work item requires --resolved-by <commit or reference>.",
					},
				};
			}
			try {
				const { records } = readRecords();
				const index = records.findIndex((record) => String(record.id) === id);
				if (index === -1) {
					return {
						ok: false,
						item: null,
						error: { reason: "unknown_id", message: `No work item with id ${id}.` },
					};
				}
				const updated = { ...records[index], status } as Record<string, unknown>;
				if (resolvedBy?.trim()) updated.resolved_by = resolvedBy.trim();
				const next = [...records];
				next[index] = updated;
				write(next);
				return { ok: true, item: toWorkItem(updated, []), error: null };
			} catch (error) {
				return { ok: false, item: null, error: documentUnreadableError(error) };
			}
		},

		editText(
			id: string,
			fields: { title?: string; body?: string; location?: string },
		): WorkItemWriteResult {
			const named = (["title", "body", "location"] as const).filter((key) => fields[key] !== undefined);
			if (named.length === 0) {
				return {
					ok: false,
					item: null,
					error: { reason: "no_fields", message: "Name at least one of --title, --body or --location." },
				};
			}
			// An empty value is REFUSED rather than written: title, body and location are required by
			// the schema, so "clearing" one produces a record the gate rejects — and a writer that can
			// leave a governed document invalid is worse than the hand edit it replaces.
			const empty = named.filter((key) => !String(fields[key]).trim());
			if (empty.length > 0) {
				return {
					ok: false,
					item: null,
					error: {
						reason: "empty_value",
						message: `${empty.join(", ")} cannot be empty — these fields are required by the schema.`,
					},
				};
			}
			try {
				const { records } = readRecords();
				const index = records.findIndex((record) => String(record.id) === id);
				if (index === -1) {
					return { ok: false, item: null, error: { reason: "unknown_id", message: `No work item with id ${id}.` } };
				}
				let updated = records[index] as Record<string, unknown>;
				for (const key of named) {
					// `withField` keeps key ORDER and every unmodelled key (rcdc5's `description`) — the
					// same rule `setAxis` follows, and the reason a plain spread is not enough.
					updated = withField(updated, key, String(fields[key]), ["package"]);
				}
				const next = [...records];
				next[index] = updated;
				write(next);
				return { ok: true, item: toWorkItem(updated, []), error: null };
			} catch (error) {
				return { ok: false, item: null, error: documentUnreadableError(error) };
			}
		},

		setRequirement(id: string, requirement: string | null): WorkItemWriteResult {
			try {
				const { records } = readRecords();
				const index = records.findIndex((record) => String(record.id) === id);
				if (index === -1) {
					return { ok: false, item: null, error: { reason: "unknown_id", message: `No work item with id ${id}.` } };
				}
				const next = [...records];
				// Anchored after `axis`, falling back to `package` — `toDocumentRecord`'s canonical
				// position — so an item linked later is byte-shaped like one linked at `add`. No
				// requirement-id validation here: the adapter cannot see the catalog, the CLI checks
				// before calling, and the gate checks the document. Two doors, neither pretending to
				// be the other.
				next[index] = withField(records[index] as Record<string, unknown>, "requirement", requirement, [
					"axis",
					"package",
				]);
				write(next);
				return { ok: true, item: toWorkItem(next[index] as Record<string, unknown>, []), error: null };
			} catch (error) {
				return { ok: false, item: null, error: documentUnreadableError(error) };
			}
		},

		setAxis(id: string, axis: WorkItemAxis): WorkItemWriteResult {
			if (!WORK_ITEM_AXES.includes(axis)) {
				return {
					ok: false,
					item: null,
					error: { reason: "invalid_axis", message: `Axis must be one of: ${WORK_ITEM_AXES.join(", ")}.` },
				};
			}
			try {
				const { records } = readRecords();
				const index = records.findIndex((record) => String(record.id) === id);
				if (index === -1) {
					return {
						ok: false,
						item: null,
						error: { reason: "unknown_id", message: `No work item with id ${id}.` },
					};
				}
				const next = [...records];
				next[index] = withField(records[index] as Record<string, unknown>, "axis", axis, ["package"]);
				write(next);
				return { ok: true, item: toWorkItem(next[index] as Record<string, unknown>, []), error: null };
			} catch (error) {
				return { ok: false, item: null, error: documentUnreadableError(error) };
			}
		},
	};
}

/** Rebuilds one record with `key` set, keeping EVERY other key — including the ones this contract
 * does not model, such as rcdc5's `description` — and keeping them in their original order. A record
 * that lacks the key gets it immediately after the first `anchors` entry it has, which is
 * `toDocumentRecord`'s canonical position, so an item edited later is byte-shaped like one written
 * at `add` and the document does not drift into two layouts. A plain `{ ...record, key }` would
 * append instead, and rebuilding from `toWorkItem` would silently DROP the extra fields.
 *
 * Generalised from `withAxis` when `editText` arrived (ISS-085): both callers differ only in which
 * key they write and where a missing one belongs. */
function withField(
	record: Record<string, unknown>,
	key: string,
	value: string | null,
	anchors: string[],
): Record<string, unknown> {
	// `null` REMOVES the key. A wrong link fabricates a false count in the very number the field
	// exists to produce, so `--clear` has to be able to undo one — and clearing by writing an empty
	// string would leave a record the reader has to interpret.
	if (value === null) {
		const { [key]: _removed, ...rest } = record;
		return rest;
	}
	if (key in record) return { ...record, [key]: value };
	const anchor = anchors.find((candidate) => candidate in record);
	const next: Record<string, unknown> = {};
	for (const [existingKey, existingValue] of Object.entries(record)) {
		next[existingKey] = existingValue;
		if (existingKey === anchor) next[key] = value;
	}
	if (!(key in next)) next[key] = value;
	return next;
}
