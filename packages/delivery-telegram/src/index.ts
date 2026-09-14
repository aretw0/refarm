/**
 * Telegram delivery — the first adapter (D7).
 *
 * Telegram's app has already won the argument with Android's doze, battery
 * saver and background delivery, maintained by people whose job that is.
 * Borrowing it is the same move as borrowing systemd: keep the declaration,
 * lend out the act. Its cost is real and is the operator's to accept —
 * metadata at a third party — which is exactly why it is DECLARED and never
 * detected.
 *
 * This package imports `@refarm.dev/delivery-contract-v1` and nothing else. It
 * has no idea refarm's core exists, which is what makes it a demonstration that
 * a third-party adapter is one file plus one registry line (D2/D5).
 *
 * ── The token ────────────────────────────────────────────────────────────────
 * Telegram puts the bot token in the URL PATH, so any log line, error message
 * or diagnostic that echoes a request URL leaks the credential. Three defences,
 * all tested:
 *   1. the URL is built inside `endpoint()` and never returned, stored, or
 *      interpolated into an Error;
 *   2. every operator-facing string this adapter emits goes through
 *      `scrubSecret`;
 *   3. `assertNoSecretInDetail` refuses to emit one that still contains it.
 * The token is resolved AT USE through `resolveToken()` and never held on the
 * adapter object.
 */

import {
	assertNoSecretInDetail,
	couldNotAttempt,
	delivered,
	DeliveryDeclarationError,
	refused,
	scrubSecret,
	type DeliveryAdapter,
	type DeliveryAdapterContext,
	type DeliveryAdapterFactory,
	type DeliveryAnswerSink,
	type DeliveryOutcome,
	type DeliveryDestination,
	type DeliveryProbe,
	type DeliveryRequest,
} from "@refarm.dev/delivery-contract-v1";

export const TELEGRAM_ADAPTER_ID = "telegram";

/** Identifies itself, as an honest citizen of someone else's service must (E5). */
export const TELEGRAM_USER_AGENT = "refarm-delivery-telegram/0.1 (+https://refarm.dev)";

export const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Telegram's own limits. Exceeding them is a 400, so we stay inside them.
 * Source: the Bot API docs, https://core.telegram.org/bots/api (sendMessage's `text` and
 * InlineKeyboardButton's `callback_data`). Recorded 2026-07-30 (commit 3899ab63) — a link, not
 * an independent re-check; not re-verified since.
 */
const MAX_MESSAGE_LEN = 4096;
/** `callback_data` is capped at 64 BYTES by the Bot API. Same source and date as above. */
const MAX_CALLBACK_DATA_BYTES = 64;

/** Bounded by construction — an adapter that retries forever is not a guest. */
const MAX_SEND_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * ── Rate limiting: whose numbers these are ───────────────────────────────────
 *
 * The operator already owns a researched, platform-agnostic rate limiter:
 * `@aretw0/dgk-channels` (`packages/dgk-channels/src/rate_limiter.js` in the
 * vault-seed repo), written explicitly to be shared with refarm. Its published
 * Telegram figures, and the reasoning behind them, are the source of truth and
 * are used here rather than being re-derived:
 *
 *   - Telegram's hard limits: 30 messages/second globally, 1 message/second per
 *     chat. Its conservative `minDelayMs: 1100` sits just under the per-chat
 *     limit, with a burst ceiling of 20 per 60s window.
 *   - A 429 with no `retry_after` defaults to **30 seconds**
 *     (`handleRateLimitResponse`: `(parameters?.retry_after ?? 30) * 1000`).
 *
 * What is NOT duplicated here: `throttle()`, the PROACTIVE pacing that spaces
 * sends apart using machine-local state in `~/.dgk/rate-limits.json`. That
 * solves a publish-pipeline problem — one post fanned out to many channels —
 * which is not the shape delivery has today: refarm sends one message per
 * pending prompt, and a wizard blocks on one question at a time. It WILL bind
 * once several channels are declared and several prompts are in flight, so this
 * is a real debt and not a hypothetical one.
 *
 * Closing it properly means moving that limiter into refarm as a shared block
 * and having vault-seed consume refarm — the direction the operator has already
 * chosen — which is larger than this slice. Until then: same numbers, same
 * reasoning, no second implementation of the pacing itself.
 *
 * Provenance: source is `@aretw0/dgk-channels` in the vault-seed repo (external to this
 * repo, not independently re-checked against Telegram's own docs here). Recorded 2026-07-30
 * (commit 3899ab63) — not re-verified since.
 */

/**
 * Telegram TELLING us to wait is not a number to negotiate with. Honour
 * `retry_after` in full, up to a ceiling that exists only to bound a hostile or
 * buggy response — never to clamp a realistic instruction.
 */
const MAX_RETRY_AFTER_MS = 60_000;
/** dgk-channels' default for a 429 that names no `retry_after`. */
const DEFAULT_RETRY_AFTER_MS = 30_000;

/** How long the adapter will watch for a button press before giving up. */
const DEFAULT_ANSWER_WATCH_MS = 10 * 60 * 1000;
const CALLBACK_POLL_INTERVAL_MS = 2_000;
const CALLBACK_POLL_MAX_INTERVAL_MS = 20_000;
/**
 * A second, independent bound on the watch loop.
 *
 * The deadline is a *clock* bound, and a clock is something this adapter is
 * handed rather than something it owns — a frozen, coarse or mocked one would
 * turn "poll until the deadline" into an unbounded loop hammering someone
 * else's API. Counting iterations cannot be defeated that way. At the interval
 * schedule above, 64 polls is comfortably longer than the default watch, so in
 * normal operation the deadline is what ends the loop and this never binds.
 */
export const MAX_ANSWER_POLLS = 64;

export interface TelegramDeliveryOptions {
	/** Where the message goes. A chat id is not a secret; a token is. */
	chatId: string;
	/**
	 * Resolve the bot token at the moment of use. Called per request, never
	 * cached on the adapter, so rotating the token needs no restart and a token
	 * that has been removed stops working immediately.
	 *
	 * Throwing here is a `could-not-attempt`, never a `refused`: refarm never
	 * reached Telegram, so it has no verdict to report.
	 */
	resolveToken(): Promise<string>;
	/** Injected so tests never touch the network. */
	fetch?: typeof fetch;
	/** Injected so tests are instant and deterministic. */
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/** Point at a local stub instead of Telegram. */
	apiBase?: string;
	/** How long to watch for a button press. Defaults to 10 minutes. */
	answerWatchMs?: number;
}

interface TelegramResponse {
	ok: boolean;
	error_code?: number;
	description?: string;
	parameters?: { retry_after?: number };
	result?: unknown;
}

/**
 * The verdict code for a response — the BODY's `error_code` when Telegram sent
 * one, otherwise the HTTP status.
 *
 * The body is preferred because it is where Telegram actually states its
 * verdict, and it survives an intermediary that rewrites the status. A proxy
 * answering `200 {ok:false, error_code:403}` still means "the bot is blocked",
 * and treating that as a transient failure would retry a refusal three times
 * and then report the wrong outcome. `@aretw0/dgk-channels` reads `error_code`
 * off the body for the same reason.
 */
export function verdictCode(status: number, payload: TelegramResponse | null): number {
	const declared = payload?.error_code;
	return typeof declared === "number" && Number.isFinite(declared) ? declared : status;
}

/** What a send attempt concluded, before it becomes a `DeliveryOutcome`. */
type SendResult =
	| { kind: "sent"; messageId: number | null }
	| { kind: "refused"; detail: string }
	| { kind: "could-not-attempt"; detail: string };

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		// A pending notification must never be the reason a CLI refuses to exit.
		timer.unref?.();
	});
}

/**
 * How long to wait before retrying.
 *
 * Two different situations, deliberately not merged:
 *
 *  - **Telegram answered 429.** It told us how long to wait, so we wait exactly
 *    that (capped only against a nonsense value). Clamping its instruction down
 *    to our own preferred ceiling is precisely how a bot earns a harder limit.
 *    A 429 naming no `retry_after` gets dgk-channels' 30s default.
 *  - **A transient network or 5xx failure.** Nobody told us anything, so this
 *    is our own exponential backoff with a small ceiling.
 */
export function backoffDelayMs(attempt: number, retryAfterSec?: number, rateLimited = false): number {
	if (typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
		return Math.min(retryAfterSec * 1000, MAX_RETRY_AFTER_MS);
	}
	if (rateLimited) return DEFAULT_RETRY_AFTER_MS;
	return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

/**
 * Did Telegram give us a VERDICT, or did we never get one? The whole of D4's
 * middle-versus-last distinction, in one function.
 *
 * 4xx that is not 429 → Telegram was reached and said no (bad token, blocked
 * bot, unknown chat). 429 and 5xx are transient: retried, and if they persist
 * we never got a verdict at all.
 */
export function statusIsTransportRefusal(status: number): boolean {
	return status >= 400 && status < 500 && status !== 429;
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Keep `callback_data` inside the Bot API's 64-byte cap, measured in BYTES. */
export function fitsCallbackData(data: string): boolean {
	return new TextEncoder().encode(data).length <= MAX_CALLBACK_DATA_BYTES;
}

/**
 * The message an operator reads on their phone. Plain text — no Markdown, no
 * HTML — so a question containing `_`, `*` or `<` cannot break the rendering or
 * be used to inject formatting into the operator's chat.
 */
export function composeMessage(request: DeliveryRequest, mode: "announce" | "answer"): string {
	const lines = [request.question, "", `asked by ${request.asker}`];
	if (request.expiresAt !== null) {
		lines.push(`expires ${new Date(request.expiresAt).toISOString()}`);
	}
	if (mode === "announce" && request.needsDecision) {
		// Never leave the operator holding an announcement with no idea what to do
		// with it — this is the announce-only case being labelled as what it is.
		lines.push("", "Answer it at the terminal or with `farm-attend` — this channel cannot carry the reply.");
	}
	return truncate(lines.join("\n"), MAX_MESSAGE_LEN);
}

/**
 * Build the inline keyboard. `callback_data` carries the prompt id and the
 * choice INDEX rather than the value: an index is short enough to fit the
 * 64-byte cap whatever the option was called, and it means an arbitrary
 * operator-supplied option value never has to survive a round trip through a
 * third party's data field.
 *
 * A choice whose encoded form still does not fit is dropped rather than sent
 * truncated — a button that answers the wrong question is worse than a button
 * that is not there.
 */
export function buildInlineKeyboard(
	request: DeliveryRequest,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
	const rows: Array<Array<{ text: string; callback_data: string }>> = [];
	(request.choices ?? []).forEach((choice, index) => {
		const data = `${request.promptId}|${index}`;
		if (!fitsCallbackData(data)) return;
		rows.push([{ text: truncate(choice.label, 64), callback_data: data }]);
	});
	return { inline_keyboard: rows };
}

/** Parse a `callback_data` back into the choice it names. */
export function parseCallbackData(
	data: unknown,
	request: DeliveryRequest,
): { value: string } | null {
	if (typeof data !== "string") return null;
	const separator = data.lastIndexOf("|");
	if (separator <= 0) return null;
	if (data.slice(0, separator) !== request.promptId) return null;
	const index = Number(data.slice(separator + 1));
	if (!Number.isInteger(index) || index < 0) return null;
	const choice = request.choices?.[index];
	return choice ? { value: choice.value } : null;
}

export function createTelegramDeliveryAdapter(options: TelegramDeliveryOptions): DeliveryAdapter {
	const doFetch = options.fetch ?? globalThis.fetch;
	const sleep = options.sleep ?? defaultSleep;
	const now = options.now ?? (() => Date.now());
	const apiBase = (options.apiBase ?? TELEGRAM_API_BASE).replace(/\/+$/, "");
	const answerWatchMs = options.answerWatchMs ?? DEFAULT_ANSWER_WATCH_MS;

	/** The ONLY place a token is interpolated into a string. Never returned. */
	function endpoint(token: string, method: string): string {
		return `${apiBase}/bot${token}/${method}`;
	}

	/**
	 * Everything this adapter says out loud passes through here. `scrubSecret`
	 * removes the token; `assertNoSecretInDetail` refuses the record outright if
	 * anything survived, because a leaked credential is not a thing to report
	 * best-effort.
	 */
	function safeDetail(text: string, token: string | null): string {
		return assertNoSecretInDetail(scrubSecret(text, token), token);
	}

	async function callApi(
		token: string,
		method: string,
		body: unknown,
	): Promise<{ status: number; payload: TelegramResponse | null }> {
		const response = await doFetch(endpoint(token, method), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"User-Agent": TELEGRAM_USER_AGENT,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		let payload: TelegramResponse | null = null;
		try {
			payload = (await response.json()) as TelegramResponse;
		} catch {
			payload = null;
		}
		return { status: response.status, payload };
	}

	/**
	 * Send, with bounded retries. Returns a verdict rather than throwing, so the
	 * caller can map it onto the three outcomes without guessing.
	 */
	async function send(token: string, body: unknown): Promise<SendResult> {
		let lastDetail = "no attempt was made";
		for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
			let status: number;
			let payload: TelegramResponse | null;
			try {
				({ status, payload } = await callApi(token, "sendMessage", body));
			} catch (error) {
				// Network failure, DNS, timeout: we never reached Telegram, so we have
				// no verdict — retry, then admit we do not know.
				lastDetail = `could not reach Telegram: ${errorMessage(error)}`;
				if (attempt < MAX_SEND_ATTEMPTS) await sleep(backoffDelayMs(attempt));
				continue;
			}

			if (status >= 200 && status < 300 && payload?.ok) {
				const result = payload.result as { message_id?: number } | undefined;
				return { kind: "sent", messageId: result?.message_id ?? null };
			}

			const code = verdictCode(status, payload);
			const described = payload?.description ?? `HTTP ${code}`;
			if (statusIsTransportRefusal(code)) {
				// Telegram was reached and said no. That is a verdict, and it is final:
				// retrying a blocked bot or a wrong chat id just makes us a bad guest.
				return { kind: "refused", detail: `Telegram refused: ${described}` };
			}

			lastDetail = `Telegram did not accept it: ${described}`;
			if (attempt < MAX_SEND_ATTEMPTS) {
				await sleep(backoffDelayMs(attempt, payload?.parameters?.retry_after, code === 429));
			}
		}
		return { kind: "could-not-attempt", detail: lastDetail };
	}

	async function withToken<T>(
		run: (token: string) => Promise<T>,
		onNoToken: (detail: string) => T,
	): Promise<T> {
		let token: string;
		try {
			token = await options.resolveToken();
		} catch (error) {
			// Never reached the transport — could-not-attempt, never refused.
			return onNoToken(`no bot token available: ${errorMessage(error)}`);
		}
		if (typeof token !== "string" || !token.trim()) {
			return onNoToken("no bot token available: the declared source resolved to nothing");
		}
		return run(token);
	}

	async function announce(request: DeliveryRequest): Promise<DeliveryOutcome> {
		return withToken(
			async (token) => {
				const result = await send(token, {
					chat_id: options.chatId,
					text: composeMessage(request, "announce"),
					disable_notification: false,
				});
				return outcomeFrom(result, "announce", token);
			},
			(detail) => couldNotAttempt(TELEGRAM_ADAPTER_ID, "announce", now(), detail),
		);
	}

	async function offerAnswer(
		request: DeliveryRequest,
		sink: DeliveryAnswerSink,
	): Promise<DeliveryOutcome> {
		return withToken(
			async (token) => {
				const keyboard = buildInlineKeyboard(request);
				if (keyboard.inline_keyboard.length === 0) {
					// Nothing to press. Say so rather than sending a dead message: an
					// adapter that claims to have offered a decision it could not offer
					// is D4's worst case wearing a success badge.
					return couldNotAttempt(
						TELEGRAM_ADAPTER_ID,
						"answer",
						now(),
						"no choice fit an inline keyboard button",
					);
				}
				const result = await send(token, {
					chat_id: options.chatId,
					text: composeMessage(request, "answer"),
					reply_markup: keyboard,
				});
				if (result.kind === "sent") {
					// The message is delivered; the button press is a separate, bounded
					// wait that must not block the outcome being recorded.
					void watchForAnswer(token, request, sink).catch(() => {
						// A failed watch cannot be allowed to surface as an unhandled
						// rejection. The prompt still settles at the terminal, or expires.
					});
				}
				return outcomeFrom(result, "answer", token);
			},
			(detail) => couldNotAttempt(TELEGRAM_ADAPTER_ID, "answer", now(), detail),
		);
	}

	function outcomeFrom(
		result: SendResult,
		mode: "announce" | "answer",
		token: string,
	): DeliveryOutcome {
		if (result.kind === "sent") {
			return delivered(
				TELEGRAM_ADAPTER_ID,
				mode,
				now(),
				result.messageId === null ? "sent" : `sent as message ${result.messageId}`,
			);
		}
		const detail = safeDetail(result.detail, token);
		return result.kind === "refused"
			? refused(TELEGRAM_ADAPTER_ID, mode, now(), detail)
			: couldNotAttempt(TELEGRAM_ADAPTER_ID, mode, now(), detail);
	}

	/**
	 * Watch for the operator pressing a button, bounded three ways: the prompt's
	 * own deadline, this adapter's ceiling, and the sink saying the prompt is
	 * already settled (answered at the terminal, or by another device).
	 *
	 * Polls `getUpdates` with backoff — a declared interval walking to a ceiling,
	 * not as-fast-as-possible. Being a guest on someone else's service means
	 * polling like one.
	 */
	async function watchForAnswer(
		token: string,
		request: DeliveryRequest,
		sink: DeliveryAnswerSink,
	): Promise<void> {
		const deadline = Math.min(
			request.expiresAt ?? Number.POSITIVE_INFINITY,
			now() + answerWatchMs,
		);
		let offset: number | undefined;
		let interval = CALLBACK_POLL_INTERVAL_MS;
		let polls = 0;

		while (now() < deadline && polls < MAX_ANSWER_POLLS) {
			polls += 1;
			let payload: TelegramResponse | null = null;
			try {
				({ payload } = await callApi(token, "getUpdates", {
					offset,
					timeout: 0,
					allowed_updates: ["callback_query"],
				}));
			} catch {
				// Transient. Back off and try again until the deadline.
				payload = null;
			}

			const updates = Array.isArray(payload?.result) ? (payload.result as unknown[]) : [];
			let sawUpdate = false;
			for (const update of updates) {
				sawUpdate = true;
				const record = update as {
					update_id?: number;
					callback_query?: { data?: unknown; id?: string };
				};
				if (typeof record.update_id === "number") offset = record.update_id + 1;
				const parsed = parseCallbackData(record.callback_query?.data, request);
				if (!parsed) continue;
				// The sink returns false when something else already settled it —
				// normal, not an error. Either way this watch is done.
				sink.answer(parsed.value);
				await acknowledge(token, record.callback_query?.id);
				return;
			}

			interval = sawUpdate
				? CALLBACK_POLL_INTERVAL_MS
				: Math.min(interval * 2, CALLBACK_POLL_MAX_INTERVAL_MS);
			await sleep(interval);
		}
	}

	/** Stop Telegram's spinner on the operator's button. Best-effort by design. */
	async function acknowledge(token: string, callbackQueryId: string | undefined): Promise<void> {
		if (!callbackQueryId) return;
		try {
			await callApi(token, "answerCallbackQuery", { callback_query_id: callbackQueryId });
		} catch {
			// The answer is already recorded; a missing acknowledgement is cosmetic.
		}
	}

	/**
	 * IS THIS BOT REAL, AND WHICH ONE — `getMe`, which delivers nothing to anybody.
	 *
	 * Telegram answers with the bot's own id and username, which is exactly the "as whom" half a
	 * probe owes: an operator running one bot across several workspaces needs to see it is the
	 * bot he thinks it is, and a token silently rotated onto another identity looks healthy
	 * without that.
	 *
	 * NEVER THROWS. A probe that dies is a surface that cannot report, and the whole point is to
	 * turn an unknown into a stated one.
	 */
	async function probe(): Promise<DeliveryProbe> {
		let token: string;
		try {
			token = await options.resolveToken();
		} catch (error) {
			return { reachable: false, reason: `token unavailable: ${errorMessage(error)}` };
		}
		try {
			const { status, payload } = await callApi(token, "getMe", {});
			if (payload?.ok === true) {
				const result = payload.result as { username?: unknown; id?: unknown } | undefined;
				const username = typeof result?.username === "string" ? result.username : undefined;
				const id = typeof result?.id === "number" ? String(result.id) : undefined;
				const identity = username ? `@${username}` : id;
				return identity ? { reachable: true, identity } : { reachable: true };
			}
			const described =
				typeof payload?.description === "string" ? payload.description : `HTTP ${status}`;
			// THROUGH `safeDetail`, the one door everything this adapter says out loud goes
			// through: it scrubs AND refuses the record outright if anything survived, because a
			// leaked credential is not a thing to report best-effort. Telegram echoes the
			// offending token in some error descriptions, and a probe exists to be printed by
			// `delivery list` and pasted into a handoff. Calling `scrubSecret` directly here
			// would have been half of this helper, copied.
			return { reachable: false, reason: safeDetail(described, token) };
		} catch (error) {
			// A network failure is not a verdict about the bot — say which one it is.
			return { reachable: false, reason: `could not reach Telegram: ${errorMessage(error)}` };
		}
	}

	/**
	 * WHICH CHATS THIS BOT HAS SEEN — `getUpdates`, read for the chats it carries rather than for
	 * the callbacks the answer path wants.
	 *
	 * TELEGRAM ONLY REMEMBERS WHAT IT HAS NOT DELIVERED. `getUpdates` returns the pending queue,
	 * so a chat that has been quiet, or whose updates this bot already consumed, does NOT appear.
	 * That is a real limit and is reported as what it is: this returns what it SAW, never "every
	 * chat that exists". Someone who wants a chat listed sends the bot a message.
	 *
	 * IT DOES NOT ADVANCE THE OFFSET. Passing an offset would acknowledge the updates and delete
	 * them from Telegram's queue — the answer path polls the same endpoint, and a discovery that
	 * consumed its updates would silently eat button presses.
	 */
	async function discoverDestinations(): Promise<DeliveryDestination[]> {
		let token: string;
		try {
			token = await options.resolveToken();
		} catch {
			return [];
		}
		let payload: TelegramResponse | null = null;
		try {
			({ payload } = await callApi(token, "getUpdates", { limit: 100, timeout: 0 }));
		} catch {
			return [];
		}
		if (payload?.ok !== true) return [];
		const updates = Array.isArray(payload.result) ? (payload.result as unknown[]) : [];
		const seen = new Map<string, DeliveryDestination>();
		for (const update of updates) {
			const record = update as Record<string, { chat?: Record<string, unknown> } | undefined>;
			// EVERY SHAPE THAT CARRIES A CHAT, because a bot added to a group appears as
			// `my_chat_member` and never as a message — the case an operator most wants to see.
			const chat =
				record.message?.chat ??
				record.channel_post?.chat ??
				record.my_chat_member?.chat ??
				record.chat_member?.chat;
			if (!chat || (typeof chat.id !== "number" && typeof chat.id !== "string")) continue;
			const id = String(chat.id);
			if (seen.has(id)) continue;
			const username = typeof chat.username === "string" ? chat.username : undefined;
			seen.set(id, {
				platform: TELEGRAM_ADAPTER_ID,
				id,
				name:
					(typeof chat.title === "string" ? chat.title : undefined) ??
					(typeof chat.first_name === "string" ? chat.first_name : undefined) ??
					username ??
					id,
				...(typeof chat.type === "string" ? { type: chat.type } : {}),
				handle: username ? `@${username}` : null,
			});
		}
		return [...seen.values()];
	}

	/**
	 * Carry a question that wants a VALUE, and bring the value back.
	 *
	 * WHAT IT UNLOCKS: `refarm sow` asks "paste the redirect URL" through the operator channel,
	 * which is already delivery-attached. That question has no choices, so it routed as
	 * `announce` — the operator saw it on his phone and had nowhere to answer. An OAuth
	 * re-authentication was completable from anywhere except the surface he was holding.
	 *
	 * THE ANSWER IS BOUND TO THE QUESTION BY `reply_to_message`, and that is the whole of the
	 * safety here. Capturing "the next message in the chat" would turn any unrelated line into
	 * the answer to a pending question — and in a group, anyone else's line. `force_reply` makes
	 * the client compose a reply, so the binding is what the operator does naturally rather than
	 * something they must remember.
	 *
	 * IT DOES NOT ADVANCE THE OFFSET, for the reason `discoverDestinations` does not: the button
	 * path polls the same queue, and consuming its updates would eat callbacks.
	 */
	async function offerTextAnswer(
		request: DeliveryRequest,
		sink: DeliveryAnswerSink,
	): Promise<DeliveryOutcome> {
		let token: string;
		try {
			token = await options.resolveToken();
		} catch (error) {
			return couldNotAttempt(
				TELEGRAM_ADAPTER_ID,
				"text-answer",
				now(),
				`token unavailable: ${errorMessage(error)}`,
			);
		}

		let sentMessageId: number | undefined;
		try {
			const { status, payload } = await callApi(token, "sendMessage", {
				chat_id: options.chatId,
				text: composeMessage(request, "announce"),
				// FORCE_REPLY, not a plain message: it makes the client open a reply box bound to
				// this message.
				reply_markup: { force_reply: true },
			});
			if (payload?.ok !== true) {
				return refused(
					TELEGRAM_ADAPTER_ID,
					"text-answer",
					now(),
					safeDetail(
						typeof payload?.description === "string" ? payload.description : `HTTP ${status}`,
						token,
					),
				);
			}
			const result = payload.result as { message_id?: unknown } | undefined;
			if (typeof result?.message_id === "number") sentMessageId = result.message_id;
		} catch (error) {
			return couldNotAttempt(
				TELEGRAM_ADAPTER_ID,
				"text-answer",
				now(),
				safeDetail(errorMessage(error), token),
			);
		}

		const deadline = now() + (options.answerWatchMs ?? DEFAULT_ANSWER_WATCH_MS);
		let polls = 0;
		while (now() < deadline && polls < MAX_ANSWER_POLLS) {
			polls += 1;
			let payload: TelegramResponse | null = null;
			try {
				({ payload } = await callApi(token, "getUpdates", {
					timeout: 0,
					allowed_updates: ["message"],
				}));
			} catch {
				payload = null;
			}
			const updates = Array.isArray(payload?.result) ? (payload.result as unknown[]) : [];
			for (const update of updates) {
				const message = (update as { message?: Record<string, unknown> }).message;
				const repliedTo = message?.["reply_to_message"] as { message_id?: unknown } | undefined;
				// THE BINDING. Not "a message arrived" — a reply to THIS question.
				if (!sentMessageId || repliedTo?.message_id !== sentMessageId) continue;
				const text = message?.["text"];
				if (typeof text !== "string" || text.trim() === "") continue;
				if (sink.answer(text.trim())) {
					return delivered(TELEGRAM_ADAPTER_ID, "text-answer", now());
				}
				// Someone else settled it first. The value is not ours to apply twice.
				return delivered(TELEGRAM_ADAPTER_ID, "text-answer", now(), "answered elsewhere first");
			}
			await sleep(CALLBACK_POLL_INTERVAL_MS);
		}
		// SENT AND UNANSWERED IS NOT A FAILURE TO DELIVER. The question reached the operator; the
		// asker's own timeout decides what happens next.
		return delivered(TELEGRAM_ADAPTER_ID, "text-answer", now(), "no reply within the watch window");
	}

	return {
		id: TELEGRAM_ADAPTER_ID,
		capability: "answer",
		// Telegram's app has already solved doze and background delivery, which is
		// the entire reason this adapter goes first (D7).
		unattended: true,
		announce,
		offerAnswer,
		probe,
		discoverDestinations,
		offerTextAnswer,
	};
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : "unknown error";
}

/**
 * The registry entry. This is the whole of what refarm's core imports — it
 * never learns that a chat id, an inline keyboard or `getUpdates` exist.
 *
 * A missing `chatId` is refused HERE, at resolution, rather than becoming a
 * 400 from Telegram the first time the operator is actually waiting for
 * something.
 */
export const telegramDeliveryAdapterFactory: DeliveryAdapterFactory = {
	id: TELEGRAM_ADAPTER_ID,
	create(context: DeliveryAdapterContext): DeliveryAdapter {
		const chatId = context.declaration.options.chatId;
		if (typeof chatId !== "string" && typeof chatId !== "number") {
			throw new DeliveryDeclarationError(
				`delivery."${context.declaration.name}": telegram needs a "chatId" — the chat the bot ` +
					`should message. It is an identifier, not a secret, so it belongs in the declaration.`,
			);
		}
		const resolved = String(chatId).trim();
		if (!resolved) {
			throw new DeliveryDeclarationError(
				`delivery."${context.declaration.name}": telegram's "chatId" must not be blank`,
			);
		}
		return createTelegramDeliveryAdapter({
			chatId: resolved,
			resolveToken: () => context.resolveToken(),
		});
	},
};
