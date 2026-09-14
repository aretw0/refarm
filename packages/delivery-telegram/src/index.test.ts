import {
	refuseUnenforceableAdapter,
	type DeliveryAnswerSink,
	type DeliveryRequest,
} from "@refarm.dev/delivery-contract-v1";
import { describe, expect, it } from "vitest";
import {
	backoffDelayMs,
	buildInlineKeyboard,
	composeMessage,
	createTelegramDeliveryAdapter,
	fitsCallbackData,
	MAX_ANSWER_POLLS,
	parseCallbackData,
	statusIsTransportRefusal,
	verdictCode,
	TELEGRAM_USER_AGENT,
} from "./index.js";

// A token shaped like a real one, so the redaction tests are honest.
const TOKEN = "7654321:AAHfakeBotTokenThatMustNeverBeLogged";

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
	return {
		promptId: "p-abc",
		question: "Bring the VPN up?",
		asker: "refarm connection up",
		needsDecision: true,
		choices: [
			{ value: "true", label: "Yes" },
			{ value: "false", label: "No" },
		],
		answerTravels: false,
		expiresAt: null,
		...overrides,
	};
}

interface Call {
	url: string;
	body: Record<string, unknown>;
	headers: Record<string, string>;
}

/** A mocked transport. No network is ever touched by this suite. */
function mockFetch(responder: (call: Call, n: number) => { status: number; json: unknown }) {
	const calls: Call[] = [];
	const fetchImpl = (async (url: unknown, init: unknown) => {
		const request_ = init as { body: string; headers: Record<string, string> };
		const call: Call = {
			url: String(url),
			body: JSON.parse(request_.body) as Record<string, unknown>,
			headers: request_.headers,
		};
		calls.push(call);
		const { status, json } = responder(call, calls.length);
		return {
			status,
			ok: status >= 200 && status < 300,
			json: async () => json,
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

const okSend = { status: 200, json: { ok: true, result: { message_id: 77 } } };

function adapter(
	fetchImpl: typeof fetch,
	overrides: Partial<Parameters<typeof createTelegramDeliveryAdapter>[0]> = {},
) {
	return createTelegramDeliveryAdapter({
		chatId: "424242",
		resolveToken: async () => TOKEN,
		fetch: fetchImpl,
		sleep: async () => {},
		now: () => 1_000,
		apiBase: "https://api.telegram.test",
		// Most tests are about the SEND, not the button watch. Zero means the watch
		// exits before its first poll, so those tests assert only what they name.
		answerWatchMs: 0,
		...overrides,
	});
}

const noSink: DeliveryAnswerSink = { answer: () => true };

// ── The declaration it makes about itself ─────────────────────────────────────

describe("the adapter's own declaration", () => {
	it("declares answer + unattended, and can actually enforce both", () => {
		const a = adapter(mockFetch(() => okSend).fetchImpl);
		expect(a.id).toBe("telegram");
		expect(a.capability).toBe("answer");
		expect(a.unattended).toBe(true);
		expect(typeof a.offerAnswer).toBe("function");
		expect(() => refuseUnenforceableAdapter(a)).not.toThrow();
	});
});

// ── Announce ──────────────────────────────────────────────────────────────────

describe("announce", () => {
	it("sends the question and reports delivered", async () => {
		const { fetchImpl, calls } = mockFetch(() => okSend);
		const outcome = await adapter(fetchImpl).announce(request());
		expect(outcome.status).toBe("delivered");
		expect(outcome.mode).toBe("announce");
		expect(calls[0]!.body.chat_id).toBe("424242");
		expect(String(calls[0]!.body.text)).toContain("Bring the VPN up?");
		expect(String(calls[0]!.body.text)).toContain("refarm connection up");
	});

	it("identifies itself, as a guest on someone else's service must (E5)", async () => {
		const { fetchImpl, calls } = mockFetch(() => okSend);
		await adapter(fetchImpl).announce(request());
		expect(calls[0]!.headers["User-Agent"]).toBe(TELEGRAM_USER_AGENT);
	});

	it("an announcement of a DECISION tells the operator where to answer it", () => {
		const text = composeMessage(request(), "announce");
		expect(text).toContain("cannot carry the reply");
	});

	it("a notice carries no such instruction", () => {
		const text = composeMessage(request({ needsDecision: false }), "announce");
		expect(text).not.toContain("cannot carry the reply");
	});

	it("stays inside Telegram's 4096-character message limit", () => {
		const text = composeMessage(request({ question: "x".repeat(9000) }), "announce");
		expect(text.length).toBeLessThanOrEqual(4096);
	});
});

// ── D4 — the three outcomes, from a real transport ────────────────────────────

describe("D4 — the three outcomes are produced by real transport conditions", () => {
	it("2xx → delivered", async () => {
		const { fetchImpl } = mockFetch(() => okSend);
		expect((await adapter(fetchImpl).announce(request())).status).toBe("delivered");
	});

	it("a 4xx verdict → refused by the transport, and it does NOT retry", async () => {
		const { fetchImpl, calls } = mockFetch(() => ({
			status: 403,
			json: { ok: false, description: "Forbidden: bot was blocked by the user" },
		}));
		const outcome = await adapter(fetchImpl).announce(request());
		expect(outcome.status).toBe("refused");
		expect(outcome.detail).toContain("bot was blocked");
		expect(calls).toHaveLength(1);
	});

	it("a persistent 5xx → could not attempt, after bounded retries", async () => {
		const { fetchImpl, calls } = mockFetch(() => ({
			status: 502,
			json: { ok: false, description: "Bad Gateway" },
		}));
		const outcome = await adapter(fetchImpl).announce(request());
		expect(outcome.status).toBe("could-not-attempt");
		expect(calls).toHaveLength(3);
	});

	it("a network failure → could not attempt, never a refusal", async () => {
		const fetchImpl = (async () => {
			throw new Error("getaddrinfo ENOTFOUND api.telegram.org");
		}) as unknown as typeof fetch;
		const outcome = await adapter(fetchImpl).announce(request());
		expect(outcome.status).toBe("could-not-attempt");
		expect(outcome.detail).toContain("could not reach Telegram");
	});

	it("a token that will not resolve → could not attempt: refarm never reached the transport", async () => {
		const { fetchImpl, calls } = mockFetch(() => okSend);
		const outcome = await adapter(fetchImpl, {
			resolveToken: async () => {
				throw new Error("ENOENT: .refarm/delivery/telegram.token");
			},
		}).announce(request());
		expect(outcome.status).toBe("could-not-attempt");
		expect(calls).toHaveLength(0);
	});

	it("an empty token is not a token", async () => {
		const { fetchImpl, calls } = mockFetch(() => okSend);
		const outcome = await adapter(fetchImpl, { resolveToken: async () => "   " }).announce(
			request(),
		);
		expect(outcome.status).toBe("could-not-attempt");
		expect(calls).toHaveLength(0);
	});

	it("recovers when a transient failure is followed by success", async () => {
		const { fetchImpl, calls } = mockFetch((_call, n) =>
			n === 1 ? { status: 500, json: { ok: false, description: "oops" } } : okSend,
		);
		expect((await adapter(fetchImpl).announce(request())).status).toBe("delivered");
		expect(calls).toHaveLength(2);
	});

	it("the BODY's error_code is the verdict when Telegram sent one", async () => {
		// An intermediary rewrote the status to 200; Telegram still said 403.
		const { fetchImpl, calls } = mockFetch(() => ({
			status: 200,
			json: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
		}));
		const outcome = await adapter(fetchImpl).announce(request());
		expect(outcome.status).toBe("refused");
		expect(calls).toHaveLength(1);
	});

	it("verdictCode prefers the body, and falls back to the HTTP status", () => {
		expect(verdictCode(200, { ok: false, error_code: 403 })).toBe(403);
		expect(verdictCode(500, { ok: false })).toBe(500);
		expect(verdictCode(429, null)).toBe(429);
	});

	it("a 429 declared only in the BODY still gets the rate-limit wait", async () => {
		const slept: number[] = [];
		const { fetchImpl } = mockFetch((_c, n) =>
			n === 1
				? { status: 200, json: { ok: false, error_code: 429, description: "Too Many Requests" } }
				: okSend,
		);
		await adapter(fetchImpl, {
			sleep: async (ms) => {
				slept.push(ms);
			},
		}).announce(request());
		expect(slept).toEqual([30_000]);
	});

	it("statusIsTransportRefusal separates a verdict from a transient failure", () => {
		expect(statusIsTransportRefusal(400)).toBe(true);
		expect(statusIsTransportRefusal(401)).toBe(true);
		expect(statusIsTransportRefusal(403)).toBe(true);
		expect(statusIsTransportRefusal(404)).toBe(true);
		expect(statusIsTransportRefusal(429)).toBe(false);
		expect(statusIsTransportRefusal(500)).toBe(false);
		expect(statusIsTransportRefusal(200)).toBe(false);
	});
});

// ── E5 — honest citizenship ───────────────────────────────────────────────────

describe("E5 — bounded, backed off, and it does what it is told", () => {
	it("backs off exponentially, with a ceiling", () => {
		expect(backoffDelayMs(1)).toBe(500);
		expect(backoffDelayMs(2)).toBe(1000);
		expect(backoffDelayMs(3)).toBe(2000);
		expect(backoffDelayMs(50)).toBe(8000);
	});

	// The Telegram figures below come from @aretw0/dgk-channels
	// (vault-seed/packages/dgk-channels/src/rate_limiter.js), which researched
	// them: 30 msg/s globally, 1 msg/s per chat, and a 429 with no retry_after
	// defaulting to 30s. They are used rather than re-derived.
	it("honours Telegram's own retry_after IN FULL, never clamped to our own ceiling", () => {
		expect(backoffDelayMs(1, 3)).toBe(3000);
		// A 30s instruction must not be silently shortened to our 8s backoff cap —
		// disrespecting it is exactly how a bot earns a harder limit.
		expect(backoffDelayMs(1, 30)).toBe(30_000);
		// Capped only against a nonsense value.
		expect(backoffDelayMs(1, 9999)).toBe(60_000);
	});

	it("a 429 naming no retry_after waits dgk-channels' 30s default", () => {
		expect(backoffDelayMs(1, undefined, true)).toBe(30_000);
		// A plain transient failure is NOT a rate limit and keeps the short backoff.
		expect(backoffDelayMs(1, undefined, false)).toBe(500);
	});

	it("waits the retry_after Telegram sent on a 429", async () => {
		const slept: number[] = [];
		const { fetchImpl } = mockFetch((_c, n) =>
			n === 1
				? { status: 429, json: { ok: false, description: "Too Many Requests", parameters: { retry_after: 4 } } }
				: okSend,
		);
		const outcome = await adapter(fetchImpl, {
			sleep: async (ms) => {
				slept.push(ms);
			},
		}).announce(request());
		expect(outcome.status).toBe("delivered");
		expect(slept).toEqual([4000]);
	});

	it("never sends more than three times for one delivery", async () => {
		const { fetchImpl, calls } = mockFetch(() => ({ status: 500, json: { ok: false } }));
		await adapter(fetchImpl).announce(request());
		expect(calls).toHaveLength(3);
	});
});

// ── The token never escapes ───────────────────────────────────────────────────

describe("the bot token never reaches a log, an error, or a record", () => {
	it("no outcome from ANY failure path carries the token", async () => {
		const cases: Array<() => typeof fetch> = [
			() => mockFetch(() => ({ status: 403, json: { ok: false, description: "Forbidden" } })).fetchImpl,
			() => mockFetch(() => ({ status: 500, json: { ok: false, description: "Bad Gateway" } })).fetchImpl,
			() =>
				(async () => {
					throw new Error(`request to https://api.telegram.test/bot${TOKEN}/sendMessage failed`);
				}) as unknown as typeof fetch,
		];
		for (const build of cases) {
			const outcome = await adapter(build()).announce(request());
			expect(JSON.stringify(outcome)).not.toContain(TOKEN);
			expect(JSON.stringify(outcome)).not.toContain("AAHfakeBotToken");
		}
	});

	it("an error message quoting the whole URL is redacted, not passed through", async () => {
		const fetchImpl = (async () => {
			throw new Error(`connect ECONNREFUSED https://api.telegram.test/bot${TOKEN}/sendMessage`);
		}) as unknown as typeof fetch;
		const outcome = await adapter(fetchImpl).announce(request());
		expect(outcome.detail).toContain("[redacted]");
		expect(outcome.detail).not.toContain(TOKEN);
	});

	it("a hostile Telegram description echoing the token is redacted too", async () => {
		const { fetchImpl } = mockFetch(() => ({
			status: 400,
			json: { ok: false, description: `Bad Request: token ${TOKEN} is invalid` },
		}));
		const outcome = await adapter(fetchImpl).announce(request());
		expect(outcome.detail).not.toContain(TOKEN);
		expect(outcome.detail).toContain("[redacted]");
	});

	it("a delivered outcome carries no token either", async () => {
		const { fetchImpl } = mockFetch(() => okSend);
		const outcome = await adapter(fetchImpl).announce(request());
		expect(JSON.stringify(outcome)).not.toContain(TOKEN);
	});

	it("the request BODY never contains the token — it belongs in the path alone", async () => {
		const { fetchImpl, calls } = mockFetch(() => okSend);
		await adapter(fetchImpl).announce(request());
		expect(JSON.stringify(calls[0]!.body)).not.toContain(TOKEN);
	});
});

// ── The inline keyboard, and the answer coming back ───────────────────────────

describe("the inline keyboard carries a decision back", () => {
	it("builds one button per choice", () => {
		const keyboard = buildInlineKeyboard(request());
		expect(keyboard.inline_keyboard).toHaveLength(2);
		expect(keyboard.inline_keyboard[0]![0]!.text).toBe("Yes");
		expect(keyboard.inline_keyboard[0]![0]!.callback_data).toBe("p-abc|0");
	});

	it("callback_data stays inside the Bot API's 64-BYTE cap", () => {
		expect(fitsCallbackData("p-abc|0")).toBe(true);
		expect(fitsCallbackData("x".repeat(64))).toBe(true);
		expect(fitsCallbackData("x".repeat(65))).toBe(false);
		// Bytes, not characters.
		expect(fitsCallbackData("é".repeat(33))).toBe(false);
	});

	it("drops a choice that cannot be encoded rather than sending it truncated", () => {
		const keyboard = buildInlineKeyboard(
			request({ promptId: "p".repeat(80), choices: [{ value: "a", label: "A" }] }),
		);
		expect(keyboard.inline_keyboard).toHaveLength(0);
	});

	it("sends the keyboard and reports delivered as answerable", async () => {
		const { fetchImpl, calls } = mockFetch(() => okSend);
		const outcome = await adapter(fetchImpl).offerAnswer!(request(), noSink);
		expect(outcome.status).toBe("delivered");
		expect(outcome.mode).toBe("answer");
		expect(calls[0]!.body.reply_markup).toBeDefined();
	});

	it("refuses to claim an offer it could not make", async () => {
		const { fetchImpl, calls } = mockFetch(() => okSend);
		const outcome = await adapter(fetchImpl).offerAnswer!(
			request({ promptId: "p".repeat(80) }),
			noSink,
		);
		expect(outcome.status).toBe("could-not-attempt");
		expect(calls).toHaveLength(0);
	});

	it("a button press settles the prompt through the sink", async () => {
		const settled: Array<string | boolean> = [];
		const { fetchImpl } = mockFetch((call) => {
			if (call.url.endsWith("/sendMessage")) return okSend;
			if (call.url.endsWith("/getUpdates")) {
				return {
					status: 200,
					json: {
						ok: true,
						result: [{ update_id: 5, callback_query: { id: "cb1", data: "p-abc|1" } }],
					},
				};
			}
			return { status: 200, json: { ok: true, result: true } };
		});
		await adapter(fetchImpl, { answerWatchMs: 60_000 }).offerAnswer!(request(), {
			answer: (v) => {
				settled.push(v);
				return true;
			},
		});
		// The watch runs detached; let its first poll land.
		await new Promise((r) => setTimeout(r, 20));
		expect(settled).toEqual(["false"]);
	});

	it("acknowledges the button press so Telegram stops spinning", async () => {
		const { fetchImpl, calls } = mockFetch((call) => {
			if (call.url.endsWith("/sendMessage")) return okSend;
			if (call.url.endsWith("/getUpdates")) {
				return {
					status: 200,
					json: {
						ok: true,
						result: [{ update_id: 5, callback_query: { id: "cb1", data: "p-abc|0" } }],
					},
				};
			}
			return { status: 200, json: { ok: true, result: true } };
		});
		await adapter(fetchImpl, { answerWatchMs: 60_000 }).offerAnswer!(request(), noSink);
		await new Promise((r) => setTimeout(r, 20));
		expect(calls.some((c) => c.url.endsWith("/answerCallbackQuery"))).toBe(true);
	});

	it("parseCallbackData only accepts data naming THIS prompt and a real choice", () => {
		const r = request();
		expect(parseCallbackData("p-abc|0", r)).toEqual({ value: "true" });
		expect(parseCallbackData("p-abc|1", r)).toEqual({ value: "false" });
		// A different prompt's button must never settle this one.
		expect(parseCallbackData("p-other|0", r)).toBeNull();
		expect(parseCallbackData("p-abc|9", r)).toBeNull();
		expect(parseCallbackData("p-abc|-1", r)).toBeNull();
		expect(parseCallbackData("garbage", r)).toBeNull();
		expect(parseCallbackData(42, r)).toBeNull();
		expect(parseCallbackData(undefined, r)).toBeNull();
	});

	it("the watch stops at the prompt's own deadline rather than polling forever", async () => {
		let clock = 1_000;
		const { fetchImpl, calls } = mockFetch((call) =>
			call.url.endsWith("/sendMessage") ? okSend : { status: 200, json: { ok: true, result: [] } },
		);
		await adapter(fetchImpl, {
			answerWatchMs: 10 * 60 * 1000,
			now: () => clock,
			sleep: async () => {
				clock += 60_000;
			},
		}).offerAnswer!(request({ expiresAt: 100_000 }), noSink);
		await new Promise((r) => setTimeout(r, 30));
		// Bounded: it gave up rather than polling indefinitely.
		expect(calls.length).toBeLessThan(10);
	});

	it("the watch is bounded by POLL COUNT too, so a frozen clock cannot make it spin", async () => {
		const { fetchImpl, calls } = mockFetch((call) =>
			call.url.endsWith("/sendMessage") ? okSend : { status: 200, json: { ok: true, result: [] } },
		);
		await adapter(fetchImpl, {
			answerWatchMs: 60_000,
			// A clock that never advances: the deadline alone would loop forever.
			now: () => 1_000,
			sleep: async () => {},
		}).offerAnswer!(request(), noSink);
		await new Promise((r) => setTimeout(r, 50));
		// sendMessage + at most MAX_ANSWER_POLLS getUpdates calls.
		expect(calls.length).toBeLessThanOrEqual(MAX_ANSWER_POLLS + 1);
	});
});
