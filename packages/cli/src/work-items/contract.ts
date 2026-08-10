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
	"requirement",
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
	/** Which operator requirement (R1-R12) this item serves. OPTIONAL by decision: several open
	 *  items are pure hygiene with no operator-facing requirement behind them, and forcing every one
	 *  to name a requirement would manufacture false precision. Absent means UNSERVED, which is a
	 *  real answer and its own reportable bucket — never folded into a requirement's count.
	 *  SINGULAR, not a list: overlapping links make per-requirement totals overlap, and "R7 has N
	 *  open" stops being a decidable number. Overlap belongs in the body. */
	requirement?: string;
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
	/** Classify an item that already exists. Without this, `axis` is writable only at `add` time
	 * and a misfiled or legacy item can be reclassified ONLY by hand-editing the backing document
	 * — which is exactly the writer-gap that left `tasks.json`/`issues.json` dead from 2026-05-05:
	 * a governed document whose only editor is a text editor stops receiving reality. The gate
	 * requires `axis` on every open item, so "reopen a resolved item" would otherwise force a hand
	 * edit inside a gated document. */
	setAxis(id: string, axis: WorkItemAxis): WorkItemWriteResult;
	/** Link (or unlink) an item to the operator requirement it serves. `null` CLEARS it — unlike
	 *  `setAxis`, which has no clear because the gate requires an axis on every open item. A wrong
	 *  link fabricates a false count in the exact number this field exists to produce, so the writer
	 *  must be able to undo one. */
	setRequirement(id: string, requirement: string | null): WorkItemWriteResult;
	/** Correct what an item SAYS: its title, body or location. Without this the ledger had writers
	 *  for creation, lifecycle and classification and none for its own prose, so fixing a sentence
	 *  meant hand-editing a governed document — the exact writer-gap that killed `tasks.json` and
	 *  `issues.json` the first time (ISS-085), and one that bit five times in a single session.
	 *  ONE verb rather than three, unlike `setStatus` and `setAxis`: those are separate because
	 *  lifecycle and classification are separate questions, while title, body and location are three
	 *  answers to one question — what does this item say. */
	editText(id: string, fields: { title?: string; body?: string; location?: string }): WorkItemWriteResult;
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
