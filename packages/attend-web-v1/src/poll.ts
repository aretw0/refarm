/**
 * Honest polling: the interval the node ADVERTISED, and a backoff.
 *
 * `GET /prompts` returns `pollIntervalMs` in every payload. That number is the node
 * saying how often it is willing to be asked, and a surface that invents a faster cadence
 * has decided its own convenience outweighs what it was told. So the floor is always the
 * declared value, and this module never produces anything below it.
 *
 * The backoff is the other half. A phone left face-up on a desk with this page open is
 * the common case, not the exception, and a tab that asks every two seconds for an
 * afternoon costs the node tens of thousands of requests to learn nothing. Consecutive
 * EMPTY rounds double the wait toward a ceiling; anything appearing resets it to the
 * floor, so the surface is fast exactly when there is something to be fast about.
 *
 * PURE — no timers here. The page owns `setTimeout`; this decides the number.
 */

/** The floor when the node declared nothing usable. Matches the block's own default, so
 *  a node that omits the field is treated as one that stated this. */
export const ATTEND_DEFAULT_POLL_INTERVAL_MS = 2_000;

/** The ceiling the backoff climbs to. Past this, asking again is noise rather than
 *  attention. Matches the block's `PENDING_PROMPT_POLL_MAX_INTERVAL_MS`. */
export const ATTEND_MAX_POLL_INTERVAL_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The interval the NODE declared, when it declared a usable one.
 *
 * Zero, negative and non-finite values fall back to the default rather than being
 * honoured: a declared interval of `0` is a node asking to be polled in a tight loop,
 * which is not a thing a caller should agree to just because it was written down.
 */
export function declaredAttendPollIntervalMs(body: unknown): number {
	const declared = isRecord(body) ? body.pollIntervalMs : undefined;
	return typeof declared === "number" && Number.isFinite(declared) && declared > 0
		? Math.trunc(declared)
		: ATTEND_DEFAULT_POLL_INTERVAL_MS;
}

export interface AttendPollDelayOptions {
	/** The declared interval. Never undercut. */
	readonly base?: number;
	readonly max?: number;
}

/**
 * How long to wait before asking again, given how many rounds in a row came back empty.
 *
 * `emptyRounds = 0` — something was pending last time — returns the floor exactly.
 */
export function nextAttendPollDelayMs(
	emptyRounds: number,
	options: AttendPollDelayOptions = {},
): number {
	const floor = Math.max(1, Math.trunc(options.base ?? ATTEND_DEFAULT_POLL_INTERVAL_MS));
	const ceiling = Math.max(floor, Math.trunc(options.max ?? ATTEND_MAX_POLL_INTERVAL_MS));
	const rounds =
		Number.isFinite(emptyRounds) && emptyRounds > 0 ? Math.trunc(emptyRounds) : 0;
	// Clamped exponent before the multiply, so a page left open for a week cannot
	// overflow its way to `Infinity` and then to a `setTimeout` that fires immediately.
	const grown = floor * 2 ** Math.min(rounds, 20);
	return Math.min(grown, ceiling);
}

/**
 * The wait after a TRANSPORT failure, which is a different curve.
 *
 * An empty round means the farm is calm; an unreachable node means something is wrong,
 * and the right response is to back off hard and quickly rather than to keep a broken
 * request in flight every two seconds. Starts at the ceiling's quarter and doubles.
 */
export function nextAttendRetryDelayMs(
	consecutiveFailures: number,
	options: AttendPollDelayOptions = {},
): number {
	const ceiling = Math.max(1, Math.trunc(options.max ?? ATTEND_MAX_POLL_INTERVAL_MS));
	const start = Math.max(1, Math.trunc(options.base ?? Math.floor(ceiling / 4)));
	const failures =
		Number.isFinite(consecutiveFailures) && consecutiveFailures > 1
			? Math.trunc(consecutiveFailures)
			: 1;
	return Math.min(start * 2 ** Math.min(failures - 1, 20), ceiling);
}
