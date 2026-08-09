import type {
	CapabilityTable,
	WorkItem,
	WorkItemAdapter,
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
	source: "native",
	resolvedBy: "native",
});

export interface ProjectJsonAdapterOptions {
	readDocument: () => string;
	writeDocument: (contents: string) => void;
}

function toWorkItem(record: Record<string, unknown>): WorkItem {
	const status = WORK_ITEM_STATUSES.includes(record.status as WorkItemStatus)
		? (record.status as WorkItemStatus)
		: "open";
	const axisValue = record.axis;
	return {
		id: String(record.id ?? ""),
		title: String(record.title ?? ""),
		body: String(record.body ?? ""),
		location: String(record.location ?? ""),
		status,
		priority: String(record.priority ?? ""),
		category: String(record.category ?? ""),
		package: String(record.package ?? ""),
		axis: WORK_ITEM_AXES.includes(axisValue as never) ? (axisValue as WorkItem["axis"]) : undefined,
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
				return { ok: true, items: records.map(toWorkItem), extraFields, error: null };
			} catch (error) {
				return {
					ok: false,
					items: [],
					extraFields: [],
					error: {
						reason: "document_unreadable",
						message: error instanceof Error ? error.message : String(error),
					},
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
				return {
					ok: false,
					item: null,
					error: {
						reason: "document_unreadable",
						message: error instanceof Error ? error.message : String(error),
					},
				};
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
				return { ok: true, item: toWorkItem(updated), error: null };
			} catch (error) {
				return {
					ok: false,
					item: null,
					error: {
						reason: "document_unreadable",
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	};
}
