/**
 * THE PERIOD THE TWO COUNTS MUST SHARE.
 *
 * A provider meter resets on a date. A count of this node's own dispatches that spans a different
 * period is the same category error as comparing tokens to requests, moved into the time
 * dimension — and it would be harder to spot, because both numbers would look like counts.
 *
 * The provider states the END (`resetsAt`) and, in its sku, that the period is monthly. The start
 * is an INFERENCE from those two, so it is labelled as one. A caller that later learns the true
 * window from somewhere else can say `declared` instead.
 */

export type QuotaWindowSource = "derived-from-reset" | "declared";

export interface QuotaWindow {
	/** A period spec a counter can resolve — `YYYY-MM`. */
	readonly spec: string;
	readonly source: QuotaWindowSource;
}

const FIRST_OF_MONTH = /^(\d{4})-(\d{2})-01$/u;

/**
 * PURE. The window ending at a first-of-month reset, or nothing.
 *
 * REFUSES a mid-month reset. That could be monthly-from-signup, weekly, or something this build
 * has never seen; picking one would produce a window that looks measured and is not. Nothing is
 * the honest answer, and it makes the count come back `null` rather than wrong.
 */
export function quotaWindowFor(resetsAt: string | undefined): QuotaWindow | null {
	if (!resetsAt) return null;
	const match = FIRST_OF_MONTH.exec(resetsAt.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	if (!Number.isFinite(year) || month < 1 || month > 12) return null;
	// The period is the month BEFORE the reset: a meter that resets on 2026-09-01 was counting
	// August. Rolling back across January is why this is arithmetic and not a string slice.
	const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
	return {
		spec: `${previous.year}-${String(previous.month).padStart(2, "0")}`,
		source: "derived-from-reset",
	};
}
