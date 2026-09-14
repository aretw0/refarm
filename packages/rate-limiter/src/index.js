/**
 * PER-PLATFORM PUBLISH PACING — a minimum gap between sends, plus a burst ceiling per window.
 *
 * PROMOTED FROM `@aretw0/dgk-channels` 2026-08-28, whose own ROADMAP declared this package as its
 * destination and itself as "um pacote bridge temporário". The mechanism, the platform table and
 * the persisted-state design are that package's, proven by its 28 tests; what changed here is
 * everything that made it belong to one consumer.
 *
 * THREE THINGS WERE HARDENED, each because a library owes its callers something the original did
 * not have to:
 *
 *   1. NO STATE PATH IS BAKED IN. The original defaulted to `~/.dgk/rate-limits.json`, which is
 *      one consumer's directory. A caller names its own base and this derives the file, so the
 *      same limiter serves a DGK vault, a refarm node and anything else without either of them
 *      inheriting the other's home.
 *   2. IT DOES NOT PRINT. The original warned on the console, in one human language, from inside
 *      a library. A wait that nobody can see is worse, so the wait is REPORTED through an injected
 *      `onWait` and the caller decides whether that is a log line, a spinner or a Telegram notice.
 *   3. THE WRITE CANNOT CORRUPT THE FILE. Written to a temporary sibling and renamed, so a process
 *      killed mid-write leaves the previous state rather than half of one.
 *
 * WHAT IS STILL TRUE AND IS NOT FIXED HERE, said plainly rather than discovered later: two
 * processes pacing the same platform CAN lose an update — each reads, waits, and writes back what
 * it read. The consequence is a send that goes out sooner than intended, never a crash or a
 * corrupt file. Closing it needs a lock, and a lock needs a consumer that actually sends from two
 * processes at once. Nothing does today.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * @typedef {object} PlatformLimit
 * @property {number} minDelayMs      Smallest gap between two sends.
 * @property {number} burstLimit      Sends allowed inside one window.
 * @property {number} burstWindowMs   The window the burst limit applies to.
 */

/**
 * Conservative defaults, BELOW each platform's published hard limits — a limiter that sits exactly
 * on the ceiling has no room for the clock disagreeing with the provider's.
 *
 * Telegram:   30 msg/s globally, 1 msg/s per chat.
 * Mastodon:   varies by instance, typically 300 req/5min.
 * Bluesky:    ~5000 req/day authenticated.
 * WhatsApp:   80 msg/s at tier 1, varies by WABA tier.
 * Buttondown: generous but undocumented; kept conservative for that reason.
 *
 * @type {Record<string, PlatformLimit>}
 */
export const PLATFORM_LIMITS = {
	telegram: { minDelayMs: 1100, burstLimit: 20, burstWindowMs: 60_000 },
	mastodon: { minDelayMs: 1000, burstLimit: 50, burstWindowMs: 60_000 },
	bluesky: { minDelayMs: 1200, burstLimit: 80, burstWindowMs: 300_000 },
	whatsapp: { minDelayMs: 1100, burstLimit: 60, burstWindowMs: 60_000 },
	buttondown: { minDelayMs: 500, burstLimit: 10, burstWindowMs: 60_000 },
};

/** The file this limiter keeps its state in, under a base the CALLER names. PURE. */
export function rateLimitStatePath(baseDir) {
	if (typeof baseDir !== "string" || baseDir.trim() === "") {
		throw new Error("rateLimitStatePath needs the directory the caller keeps machine-local state in");
	}
	return join(baseDir, "rate-limits.json");
}

function loadState(statePath) {
	if (!existsSync(statePath)) return {};
	try {
		return JSON.parse(readFileSync(statePath, "utf8"));
	} catch {
		// Unreadable state is not a reason to refuse to send: the worst it costs is one send
		// paced from scratch, and refusing would make a corrupt file stop a publish pipeline.
		return {};
	}
}

function saveState(state, statePath) {
	mkdirSync(dirname(statePath), { recursive: true });
	const temporary = `${statePath}.writing`;
	writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	renameSync(temporary, statePath);
}

function defaultSleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @typedef {object} ThrottleWait
 * @property {string} platform
 * @property {"min-delay" | "burst-window"} reason  Which rule made this call wait.
 * @property {number} waitedMs
 */

/**
 * Wait, if waiting is what staying inside the limits requires, then record the send.
 *
 * @param {string} platform
 * @param {object} [options]
 * @param {string}   [options.statePath]  Where the pacing state lives. Required in practice —
 *                                        see {@link rateLimitStatePath}.
 * @param {PlatformLimit} [options.limits] Override for this platform.
 * @param {(ms: number) => Promise<void>} [options.sleep] Injected for tests.
 * @param {(wait: ThrottleWait) => void}  [options.onWait] Told about every wait, so a surface can
 *                                        show it. A library that printed would choose the
 *                                        caller's language and output stream for them.
 * @param {() => number} [options.now] Injected clock.
 * @returns {Promise<ThrottleWait[]>} Every wait this call performed, in order. Empty when it did
 *                                    not have to wait — which is the common case and is worth
 *                                    being able to assert.
 */
export async function throttle(platform, options = {}) {
	const {
		statePath,
		limits = PLATFORM_LIMITS[platform],
		sleep = defaultSleep,
		onWait,
		now = Date.now,
	} = options;
	const waits = [];
	// AN UNKNOWN PLATFORM IS NOT PACED, and that is deliberate: inventing a limit for a provider
	// nobody measured would be a number in a durable place that was guessed.
	if (!limits) return waits;
	if (!statePath) {
		throw new Error("throttle needs a statePath — the caller owns where machine-local state lives");
	}

	const report = (reason, waitedMs) => {
		const wait = { platform, reason, waitedMs };
		waits.push(wait);
		onWait?.(wait);
	};

	const state = loadState(statePath);
	const startedAt = now();
	// `lastSentAt: 0` IS THE "NEVER SENT" SENTINEL, and it is compared arithmetically below. With a
	// real clock the distance from the epoch dwarfs any `minDelayMs`, so a first send never waits.
	// With an injected clock near zero it would, which is a property of the fixture rather than of
	// the pacing — said here because a test that trips on it should recognise it instead of
	// concluding the limiter is wrong.
	const paced = state[platform] ?? { lastSentAt: 0, windowStart: startedAt, sentInWindow: 0 };

	if (startedAt - paced.windowStart > limits.burstWindowMs) {
		paced.windowStart = startedAt;
		paced.sentInWindow = 0;
	}

	const sinceLastSend = startedAt - paced.lastSentAt;
	if (sinceLastSend < limits.minDelayMs) {
		const waitMs = limits.minDelayMs - sinceLastSend;
		report("min-delay", waitMs);
		await sleep(waitMs);
	}

	if (paced.sentInWindow >= limits.burstLimit) {
		const windowRemaining = limits.burstWindowMs - (now() - paced.windowStart);
		if (windowRemaining > 0) {
			report("burst-window", windowRemaining);
			await sleep(windowRemaining);
			paced.windowStart = now();
			paced.sentInWindow = 0;
			const sinceLastSendAfterBurst = now() - paced.lastSentAt;
			if (sinceLastSendAfterBurst < limits.minDelayMs) {
				const waitMs = limits.minDelayMs - sinceLastSendAfterBurst;
				report("min-delay", waitMs);
				await sleep(waitMs);
			}
		}
	}

	paced.lastSentAt = now();
	paced.sentInWindow += 1;
	state[platform] = paced;
	saveState(state, statePath);
	return waits;
}

/**
 * How long a provider's own rate-limit answer says to wait, in milliseconds.
 *
 * ZERO MEANS "NOT A RATE-LIMIT ANSWER", never "wait zero". A caller that treats every response
 * through this gets 0 for the successful ones, which is the same as not waiting.
 *
 * @param {unknown} response Parsed JSON body, or a fetch-shaped object carrying `status`.
 * @param {string} platform
 * @returns {number}
 */
export function handleRateLimitResponse(response, platform) {
	if (!response || typeof response !== "object") return 0;
	const body = /** @type {Record<string, any>} */ (response);

	// Telegram answers `{ ok: false, error_code: 429, parameters: { retry_after: N } }` — seconds,
	// in a nested object nobody else uses.
	if (platform === "telegram" && body.error_code === 429) {
		return (body.parameters?.retry_after ?? 30) * 1000;
	}
	if (body.status === 429 || body.error_code === 429) {
		return (body.retryAfter ?? 30) * 1000;
	}
	return 0;
}
