// The messenger BASICS — the day-separator + timestamp convention every chat has (Telegram/WhatsApp):
// group a conversation's messages into day buckets with a human day label ("Hoje", "Ontem", a
// weekday, or a date), and a per-message "HH:MM" time. PURE + surface-agnostic: it works on ANY
// message carrying an `at` (ms) timestamp — the agent chat, a person-to-person messenger, anything —
// so a conversation UI never re-derives "when was this" by hand.
//
// `now` is INJECTED (never read from the clock here), so the same input always groups the same way —
// the caller passes Date.now() in production and a fixed instant in tests. Day boundaries are the
// VIEWER's local calendar (a message at 23:00 and one at 00:30 the next day are different days), via
// the runtime's local timezone; labels/format come from an Intl locale (default pt-BR).

/** A run of consecutive messages that fall on the same calendar day, under one day separator. */
export interface ConversationDayGroup<M> {
	/** A stable per-day key (`YYYY-MM-DD` in local time) — for React keys / de-dup, not for display. */
	dayKey: string;
	/** The human day separator: "Hoje", "Ontem", a weekday (this week), or a date. */
	label: string;
	/** The messages of this day, in the order given. */
	messages: M[];
}

export interface ConversationTimeOptions {
	/** "Now" in ms — injected for determinism (the caller passes Date.now()). */
	now: number;
	/** BCP-47 locale for the weekday/date/time formatting (default "pt-BR"). */
	locale?: string;
	/** Overrides for the today/yesterday words. Default: the locale-correct word from
	 * Intl.RelativeTimeFormat (pt-BR → "Hoje"/"Ontem", en → "Today"/"Yesterday", …). */
	todayLabel?: string;
	yesterdayLabel?: string;
}

const DEFAULT_LOCALE = "pt-BR";

/** The local `YYYY-MM-DD` of an instant — the viewer's calendar day (not UTC), so day boundaries
 * match what the viewer sees. Exported so an INCREMENTAL transcript (appending live messages) can
 * tell when to drop a new day separator without re-grouping the whole list. */
export function conversationDayKey(at: number): string {
	const d = new Date(at);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** The whole-calendar-day distance from `at` to `now` (0 = same day, 1 = yesterday, …), computed on
 * local midnights so it is not skewed by the time of day. */
function calendarDaysAgo(at: number, now: number): number {
	const a = new Date(at);
	const b = new Date(now);
	const midA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
	const midB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
	return Math.round((midB - midA) / 86_400_000);
}

/** Capitalize the first character for a header — Intl.RelativeTimeFormat yields a lowercase word
 * ("hoje", "today"), but a day separator reads as a heading. Locale-aware upper-casing. */
function capitalizeFirst(value: string, locale: string): string {
	return value.length === 0 ? value : value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
}

/** The locale-correct relative-day WORD for an offset (0 → "hoje"/"today", -1 → "ontem"/"yesterday"),
 * from CLDR data via Intl.RelativeTimeFormat. `numeric: "auto"` is what turns the integer offset into a
 * word instead of "in 0 days" / "1 day ago" — so we don't hand-roll a per-locale string table. */
function relativeDayWord(offset: number, locale: string): string {
	return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, "day");
}

/**
 * The day separator label for a message instant relative to `now`, the messenger convention:
 * today → "Hoje", yesterday → "Ontem", 2–6 days ago → the weekday name, same year → day+month, older
 * → day+month+year. `future` instants (clock skew) fall through to a date so they never read "Hoje".
 *
 * Today/yesterday come from Intl.RelativeTimeFormat (CLDR), so they are locale-correct like every other
 * branch — a caller passing `locale: "en"` gets "Today"/"Yesterday", not a hard-coded pt-BR word. An
 * explicit todayLabel/yesterdayLabel still wins.
 */
export function conversationDayLabel(at: number, options: ConversationTimeOptions): string {
	const locale = options.locale ?? DEFAULT_LOCALE;
	const daysAgo = calendarDaysAgo(at, options.now);
	if (daysAgo === 0) return options.todayLabel ?? capitalizeFirst(relativeDayWord(0, locale), locale);
	if (daysAgo === 1) return options.yesterdayLabel ?? capitalizeFirst(relativeDayWord(-1, locale), locale);
	const d = new Date(at);
	if (daysAgo >= 2 && daysAgo <= 6) {
		return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d);
	}
	const sameYear = d.getFullYear() === new Date(options.now).getFullYear();
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	}).format(d);
}

/** The per-message clock time "HH:MM" in the viewer's locale. */
export function conversationMessageTime(at: number, options: { locale?: string } = {}): string {
	return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(at));
}

/**
 * Group chronologically-ordered messages into day buckets, each under one day separator — the
 * transcript shape a messenger renders (a "Hoje"/"Ontem"/date divider, then that day's messages).
 * Messages MUST be sorted ascending by `at`; a new bucket starts whenever the local calendar day
 * changes. Returns [] for no messages.
 */
export function groupConversationByDay<M extends { at: number }>(
	messages: readonly M[],
	options: ConversationTimeOptions,
): ConversationDayGroup<M>[] {
	const groups: ConversationDayGroup<M>[] = [];
	for (const message of messages) {
		const dayKey = conversationDayKey(message.at);
		const last = groups[groups.length - 1];
		if (last && last.dayKey === dayKey) {
			last.messages.push(message);
		} else {
			groups.push({ dayKey, label: conversationDayLabel(message.at, options), messages: [message] });
		}
	}
	return groups;
}
