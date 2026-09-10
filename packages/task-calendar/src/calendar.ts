import type { Task } from "@refarm.dev/task-contract-v1";

/**
 * Generic iCalendar (.ics) → `task:v1` expansion — the reusable kernel distilled from an operational
 * vault's calendar-import generator (rcdc5's `almtask` `CalendarTaskImporter`). It parses RFC 5545
 * VEVENTs (line unfolding, `DTSTART`/`DTEND`/`DURATION`, text unescaping) into plain calendar events,
 * and maps each event to a `task:v1` create-input. The sibling of `task-recurrence`: recurrence rules
 * and calendars are the two generic ways an operational vault generates dated tasks.
 *
 * SOVEREIGN BOUNDARY: this owns only the generic iCalendar parsing + the event→task shape. The vendor
 * layer — a UST service catalog, the estimate/description formatting, one ALM's import-CSV columns —
 * stays with the consumer as product/config. All functions are PURE (no network, no clock unless an
 * explicit `now` is passed for future-filtering), so parsing/expansion is deterministic and testable.
 */

/** A parsed calendar event — the generic subset a task cares about. */
export interface CalendarEvent {
	uid?: string;
	summary: string;
	description?: string;
	location?: string;
	/** Event start. `allDay` events are at local midnight of the date. */
	start: Date;
	/** Event end, when a `DTEND` or `DURATION` was present. */
	end?: Date;
	allDay: boolean;
}

/** Unescape RFC 5545 TEXT: `\n`/`\N` → newline, `\,` `\;` `\\` → literal. PURE. */
function unescapeText(value: string): string {
	return value.replace(/\\([\\;,nN])/g, (_m, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

/** Parse an RFC 5545 DURATION (`PT1H30M`, `P1D`, `P1W`, `PT45M`) into milliseconds. The sign and the
 * `P`/`T` separators are ignored (only magnitude+unit pairs matter). PURE. */
export function parseICalDuration(value: string): number {
	let ms = 0;
	const re = /(\d+)([WDHMS])/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(value.toUpperCase())) !== null) {
		const n = Number.parseInt(m[1]!, 10);
		switch (m[2]) {
			case "W":
				ms += n * 604_800_000;
				break;
			case "D":
				ms += n * 86_400_000;
				break;
			case "H":
				ms += n * 3_600_000;
				break;
			case "M":
				ms += n * 60_000;
				break;
			case "S":
				ms += n * 1_000;
				break;
		}
	}
	return ms;
}

/** Parse a DTSTART/DTEND value (with its raw key so `VALUE=DATE` params are seen). Returns the Date
 * plus whether it is an all-day date. `…Z` is UTC; a bare date-time or a TZID is read as local time
 * (a full tz database is out of scope — documented). PURE. */
function parseICalDate(rawKey: string, value: string): { date: Date; allDay: boolean } {
	const v = value.trim();
	if (/VALUE=DATE(?!-TIME)/i.test(rawKey) || /^\d{8}$/.test(v)) {
		const y = Number(v.slice(0, 4));
		const mo = Number(v.slice(4, 6)) - 1;
		const d = Number(v.slice(6, 8));
		return { date: new Date(y, mo, d), allDay: true };
	}
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
	if (!m) throw new Error(`invalid iCalendar date-time: "${value}"`);
	const [, y, mo, d, hh, mm, ss, z] = m;
	const parts = [Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)] as const;
	const date = z ? new Date(Date.UTC(...parts)) : new Date(...parts);
	return { date, allDay: false };
}

/** Parse iCalendar text into calendar events. Handles line unfolding (folded continuation lines) and
 * property parameters (`DTSTART;TZID=…:…`). Events without a `DTSTART` are skipped. PURE. */
export function parseICalendar(text: string): CalendarEvent[] {
	const unfolded = text.replace(/\r?\n[ \t]/g, "");
	const lines = unfolded.split(/\r?\n/);
	const events: CalendarEvent[] = [];
	let cur: Record<string, { rawKey: string; value: string }> | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "BEGIN:VEVENT") {
			cur = {};
			continue;
		}
		if (trimmed === "END:VEVENT") {
			if (cur) {
				const event = buildEvent(cur);
				if (event) events.push(event);
			}
			cur = null;
			continue;
		}
		if (!cur) continue;
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const rawKey = line.slice(0, colon);
		const value = line.slice(colon + 1);
		const key = rawKey.split(";")[0]!.trim().toUpperCase();
		cur[key] = { rawKey, value };
	}
	return events;
}

function buildEvent(props: Record<string, { rawKey: string; value: string }>): CalendarEvent | null {
	const dtstart = props.DTSTART;
	if (!dtstart) return null;
	const { date: start, allDay } = parseICalDate(dtstart.rawKey, dtstart.value);
	let end: Date | undefined;
	if (props.DTEND) end = parseICalDate(props.DTEND.rawKey, props.DTEND.value).date;
	else if (props.DURATION) {
		const ms = parseICalDuration(props.DURATION.value);
		if (ms > 0) end = new Date(start.getTime() + ms);
	}
	return {
		...(props.UID ? { uid: props.UID.value.trim() } : {}),
		summary: props.SUMMARY ? unescapeText(props.SUMMARY.value) : "",
		...(props.DESCRIPTION ? { description: unescapeText(props.DESCRIPTION.value) } : {}),
		...(props.LOCATION ? { location: unescapeText(props.LOCATION.value) } : {}),
		start,
		...(end ? { end } : {}),
		allDay,
	};
}

export interface CalendarTaskOptions {
	assignedTo?: string | null;
	createdBy?: string | null;
	contextId?: string | null;
	tags?: string[];
	/** Title template with `{summary}` / `{date}` / `{location}` placeholders. Default `"{summary}"`. */
	titleTemplate?: string;
	/** How to render `{date}` — defaults to ISO date (`YYYY-MM-DD`). */
	formatDate?: (d: Date) => string;
}

type TaskCreateInput = Omit<Task, "@id" | "created_at_ns" | "updated_at_ns">;

/** Map one calendar event to a `task:v1` create-input: title templated, `due_at_ns` from the event
 * start, status `pending`. PURE. */
export function calendarEventToTask(event: CalendarEvent, opts: CalendarTaskOptions = {}): TaskCreateInput {
	const fmt = opts.formatDate ?? ((d: Date) => d.toISOString().slice(0, 10));
	const vars: Record<string, string> = {
		summary: event.summary,
		date: fmt(event.start),
		location: event.location ?? "",
	};
	const template = opts.titleTemplate ?? "{summary}";
	const title = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
		Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
	);
	return {
		"@type": "Task",
		title,
		status: "pending",
		created_by: opts.createdBy ?? null,
		assigned_to: opts.assignedTo ?? null,
		context_id: opts.contextId ?? null,
		parent_task_id: null,
		due_at_ns: event.start.getTime() * 1_000_000,
		...(opts.tags ? { tags: opts.tags } : {}),
	};
}

export interface ExpandCalendarOptions extends CalendarTaskOptions {
	/** When set with `futureOnly`, drop events starting before `now`. */
	now?: Date;
	/** Keep only events at/after `now` (requires `now`). Default false. */
	futureOnly?: boolean;
}

/** Parse iCalendar text and map its events to `task:v1` create-inputs, optionally keeping only future
 * events. PURE given `now`. */
export function expandCalendarTasks(icsText: string, opts: ExpandCalendarOptions = {}): TaskCreateInput[] {
	let events = parseICalendar(icsText);
	if (opts.futureOnly && opts.now) {
		const cutoff = opts.now.getTime();
		events = events.filter((e) => e.start.getTime() >= cutoff);
	}
	return events.map((e) => calendarEventToTask(e, opts));
}
