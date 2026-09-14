import type { Task } from "@refarm.dev/task-contract-v1";

/**
 * Generic recurring-task expansion — the reusable kernel distilled from an operational vault's
 * recurring-task generator (rcdc5's `almtask`). A recurring spec (a title/body TEMPLATE + a schedule
 * reference) expands into a concrete, dated `task:v1` create-input. It is the write-side complement
 * of the read-side source adapters: source-oslc pulls work-items IN, this emits recurring work-items OUT.
 *
 * SOVEREIGN BOUNDARY: this owns only what is generic — resolving a schedule reference to a date and
 * templating text. The vendor vocabulary (a UST service catalog, an effort→deadline calculation, the
 * import-CSV columns of one ALM) stays with the consumer as product/config; none of it is here. All
 * functions are PURE given an explicit `now` (never reads the clock itself), so expansion is
 * deterministic and testable.
 */

/**
 * A schedule reference, resolved relative to `now`. Neutral tokens (a consumer maps its own spelling
 * onto these — e.g. rcdc5's `proximo_dia:N`/`dia_mes:N`):
 *   `undefined` | `"today"`        → `now`
 *   `"next-weekday:N"` (0=Mon…6=Sun) → the next occurrence of weekday N; if today IS N, the NEXT week
 *   `"month-day:N"`                 → day N of `now`'s month (time zeroed)
 */
export type ScheduleRef = string | undefined;

/** ISO weekday of a Date in the 0=Mon…6=Sun convention (JS `getDay()` is 0=Sun…6=Sat). PURE. */
function isoWeekday(d: Date): number {
	return (d.getDay() + 6) % 7;
}

/** Resolve a schedule reference to a concrete Date relative to `now`. Throws on a malformed token. PURE. */
export function resolveScheduleRef(ref: ScheduleRef, now: Date): Date {
	const token = (ref ?? "today").trim().toLowerCase();
	if (token === "today") return new Date(now);

	if (token.startsWith("next-weekday:")) {
		const target = Number.parseInt(token.slice("next-weekday:".length), 10);
		if (!Number.isInteger(target) || target < 0 || target > 6) {
			throw new Error(`invalid next-weekday token: "${ref}" (use 0=Mon … 6=Sun)`);
		}
		let daysUntil = (target - isoWeekday(now) + 7) % 7;
		if (daysUntil === 0) daysUntil = 7; // today is the target → go to the next week
		const d = new Date(now);
		d.setDate(now.getDate() + daysUntil);
		return d;
	}

	if (token.startsWith("month-day:")) {
		const day = Number.parseInt(token.slice("month-day:".length), 10);
		if (!Number.isInteger(day) || day < 1 || day > 31) {
			throw new Error(`invalid month-day token: "${ref}" (use 1…31)`);
		}
		const d = new Date(now);
		d.setDate(day);
		d.setHours(0, 0, 0, 0);
		return d;
	}

	throw new Error(`invalid schedule reference: "${ref}" (use "today", "next-weekday:N", or "month-day:N")`);
}

/** Substitute `{key}` placeholders from `vars`; an unknown key is left intact (forward-safe). PURE. */
export function expandTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
		Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
	);
}

/** A recurring-task spec — neutral, no vendor vocabulary. The consumer builds this from its own
 * source (a YAML of recurring items, a service catalog, …) and keeps its vocab there. */
export interface RecurringTaskSpec {
	/** Title template; `{date}` / `{deadline}` (+ any `vars`) are substituted. */
	titleTemplate: string;
	/** When this occurrence lands. Omit for `now`. */
	schedule?: ScheduleRef;
	assignedTo?: string | null;
	createdBy?: string | null;
	contextId?: string | null;
	tags?: string[];
}

export interface ExpandOptions {
	/** The reference "now" — passed explicitly so expansion is deterministic. */
	now: Date;
	/** An optional deadline: it supplies `{deadline}` and, when present, the Task's `due_at_ns`
	 * (otherwise the resolved schedule date is the due date). */
	deadline?: Date;
	/** Extra template variables beyond the built-in `{date}` / `{deadline}`. */
	vars?: Record<string, string>;
	/** How to render `{date}` / `{deadline}` — defaults to ISO date (`YYYY-MM-DD`). */
	formatDate?: (d: Date) => string;
}

type TaskCreateInput = Omit<Task, "@id" | "created_at_ns" | "updated_at_ns">;

/** Expand a recurring spec into a `task:v1` create-input: title templated, `due_at_ns` from the
 * deadline (or the resolved schedule date), status `pending`. Ready to hand to a TaskContractAdapter.
 * PURE given `now`/`deadline`. */
export function expandRecurringTask(spec: RecurringTaskSpec, opts: ExpandOptions): TaskCreateInput {
	const date = resolveScheduleRef(spec.schedule, opts.now);
	const fmt = opts.formatDate ?? ((d: Date) => d.toISOString().slice(0, 10));
	const vars: Record<string, string> = {
		date: fmt(date),
		...(opts.deadline ? { deadline: fmt(opts.deadline) } : {}),
		...(opts.vars ?? {}),
	};
	const dueDate = opts.deadline ?? date;
	return {
		"@type": "Task",
		title: expandTemplate(spec.titleTemplate, vars),
		status: "pending",
		created_by: spec.createdBy ?? null,
		assigned_to: spec.assignedTo ?? null,
		context_id: spec.contextId ?? null,
		parent_task_id: null,
		due_at_ns: dueDate.getTime() * 1_000_000,
		...(spec.tags ? { tags: spec.tags } : {}),
	};
}
