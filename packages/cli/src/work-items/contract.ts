// The neutral shape. Adapters translate; the core never sees a backend's own record.
export const WORK_ITEM_STATUSES = ["open", "deferred", "resolved"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_AXES = [
	"node-vs-directory",
	"cost",
	"sandbox",
	"durability",
	"other",
] as const;
export type WorkItemAxis = (typeof WORK_ITEM_AXES)[number];

export const WORK_ITEM_FIELDS = [
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
	"resolvedBy",
] as const;
export type WorkItemField = (typeof WORK_ITEM_FIELDS)[number];

/** THREE STATES. `unsupported` is not `null` and not absent — it is a backend that cannot carry
 * this field at all, and the CLI must say so rather than drop the value silently. */
export type FieldSupport = "native" | "emulated" | "unsupported";
export type CapabilityTable = Readonly<Record<WorkItemField, FieldSupport>>;

export interface WorkItem {
	id: string;
	title: string;
	body: string;
	location: string;
	status: WorkItemStatus;
	priority: string;
	category: string;
	package: string;
	/** Absent means UNCLASSIFIED, which is a reportable row — never folded into a total. */
	axis?: WorkItemAxis;
	source?: string;
	resolvedBy?: string;
}

export interface WorkItemReadResult {
	ok: boolean;
	items: WorkItem[];
	/** Fields present in the backend document that this contract does not know. Reported, never
	 * rejected: rcdc5's ledger carries `description` and refarm's schema forbids it. */
	extraFields: string[];
	error: { reason: string; message: string } | null;
}

export interface WorkItemWriteResult {
	ok: boolean;
	item: WorkItem | null;
	error: { reason: string; message: string } | null;
}

export interface WorkItemAdapter {
	readonly provider: string;
	capabilities(): CapabilityTable;
	list(): WorkItemReadResult;
	add(item: WorkItem): WorkItemWriteResult;
	setStatus(id: string, status: WorkItemStatus, resolvedBy?: string): WorkItemWriteResult;
}

export function qualifyId(workspaceId: string, itemId: string): string {
	return `${workspaceId}#${itemId}`;
}

/** The capability guard lives HERE, not inside each adapter, so a backend cannot forget it and so
 * it is testable without a backend. Returns the fields the caller tried to write that this backend
 * declares it cannot carry. Empty array means the write is safe. */
export function rejectUnsupportedFields(
	capabilities: CapabilityTable,
	item: Partial<WorkItem>,
): WorkItemField[] {
	return WORK_ITEM_FIELDS.filter((field) => {
		const value = item[field];
		const present = typeof value === "string" ? value.trim().length > 0 : value !== undefined;
		return present && capabilities[field] === "unsupported";
	});
}
