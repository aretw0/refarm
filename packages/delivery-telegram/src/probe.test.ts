import { describe, expect, it, vi } from "vitest";

import { createTelegramDeliveryAdapter } from "./index.js";

const TOKEN = "8826483119:AA-fake-token-for-tests";

function probeAdapter(
	fetchImpl: typeof fetch,
	resolveToken: () => Promise<string> = async () => TOKEN,
) {
	return createTelegramDeliveryAdapter({
		chatId: "424242",
		resolveToken,
		fetch: fetchImpl,
		sleep: async () => {},
		now: () => 1_000,
		apiBase: "https://api.telegram.test",
		answerWatchMs: 0,
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("telegram probe", () => {
	it("reports the bot it speaks as, and asks getMe rather than sending", async () => {
		// The parameters are DECLARED so the mock's call tuple carries their types; an untyped
		// `vi.fn(async () => ...)` records calls as `[]` and every argument assertion becomes a
		// cast. vitest does not type-check, so only `tsc` sees the difference.
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			jsonResponse({ ok: true, result: { id: 8826483119, username: "refarm_hand_bot" } }),
		);
		const probe = await probeAdapter(fetchImpl as never).probe?.();
		expect(probe).toEqual({ reachable: true, identity: "@refarm_hand_bot" });
		// THE METHOD IS THE WHOLE POINT. A probe that reached `sendMessage` would buzz the
		// operator's phone to find out whether it can buzz the operator's phone.
		const url = String(fetchImpl.mock.calls[0]?.[0]);
		expect(url).toContain("/getMe");
		expect(url).not.toContain("sendMessage");
	});

	// THE CASE THIS EXISTS FOR. A revoked token reads exactly like a healthy one without a probe,
	// and the first anyone learns otherwise is a consent question that never arrives.
	it("reports a revoked token as unreachable, carrying Telegram's own reason", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ ok: false, description: "Unauthorized" }, 401),
		);
		const probe = await probeAdapter(fetchImpl as never).probe?.();
		expect(probe?.reachable).toBe(false);
		expect(probe?.reason).toBe("Unauthorized");
	});

	it("separates a network failure from a verdict about the bot", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("getaddrinfo ENOTFOUND api.telegram.org");
		});
		const probe = await probeAdapter(fetchImpl as never).probe?.();
		expect(probe?.reachable).toBe(false);
		expect(probe?.reason).toContain("could not reach Telegram");
	});

	it("blames the missing token rather than the channel", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: {} }));
		const probe = await probeAdapter(fetchImpl as never, async () => {
			throw new Error("no such file");
		}).probe?.();
		expect(probe?.reachable).toBe(false);
		expect(probe?.reason).toContain("token unavailable");
		// It never reached the network, because there was nothing to authenticate with.
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("never leaks the token into the reason it reports", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ ok: false, description: `bad token ${TOKEN}` }, 401),
		);
		const probe = await probeAdapter(fetchImpl as never).probe?.();
		expect(probe?.reason ?? "").not.toContain(TOKEN);
	});
});

describe("telegram destination discovery", () => {
	function updatesResponse(result: unknown[]) {
		return jsonResponse({ ok: true, result });
	}

	it("finds a group the bot was added to, which arrives as my_chat_member", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			updatesResponse([
				{ update_id: 1, my_chat_member: { chat: { id: -100123, title: "Coop", type: "supergroup" } } },
			]),
		);
		const found = await probeAdapter(fetchImpl as never).discoverDestinations?.();
		// A bot added to a group NEVER appears as a message — this is the case an operator most
		// wants to see, and reading only `message.chat` would miss it entirely.
		expect(found).toEqual([
			{ platform: "telegram", id: "-100123", name: "Coop", type: "supergroup", handle: null },
		]);
	});

	it("carries the handle when there is one, and null when there is not", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			updatesResponse([
				{ update_id: 1, message: { chat: { id: 1, first_name: "Ana", type: "private", username: "ana" } } },
				{ update_id: 2, message: { chat: { id: 2, first_name: "Bruno", type: "private" } } },
			]),
		);
		const found = (await probeAdapter(fetchImpl as never).discoverDestinations?.()) ?? [];
		expect(found.map((entry) => entry.handle)).toEqual(["@ana", null]);
	});

	it("deduplicates a chat that appears in several updates", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			updatesResponse([
				{ update_id: 1, message: { chat: { id: 7, first_name: "Ana", type: "private" } } },
				{ update_id: 2, message: { chat: { id: 7, first_name: "Ana", type: "private" } } },
			]),
		);
		const found = await probeAdapter(fetchImpl as never).discoverDestinations?.();
		expect(found).toHaveLength(1);
	});

	it("NEVER advances the offset, because the answer path polls the same queue", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			updatesResponse([]),
		);
		await probeAdapter(fetchImpl as never).discoverDestinations?.();
		const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit)?.body ?? "{}"));
		// Passing an offset ACKNOWLEDGES updates and deletes them from Telegram's queue. Discovery
		// that consumed them would silently eat button presses the answer path is waiting for.
		expect(body).not.toHaveProperty("offset");
	});

	it("reports nothing rather than throwing when the token or the call fails", async () => {
		const failing = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			throw new Error("offline");
		});
		expect(await probeAdapter(failing as never).discoverDestinations?.()).toEqual([]);
	});
});

describe("telegram text answers", () => {
	/**
	 * A watch window that actually opens. The shared `probeAdapter` sets `answerWatchMs: 0` —
	 * right for tests about the SEND — which makes the poll loop never run. The first version of
	 * these tests used it and the happy path silently captured nothing, which would have left the
	 * two negative assertions passing VACUOUSLY: "no answer was captured" is trivially true when
	 * nothing can be.
	 */
	function watchingAdapter(fetchImpl: typeof fetch) {
		return createTelegramDeliveryAdapter({
			chatId: "424242",
			resolveToken: async () => TOKEN,
			fetch: fetchImpl,
			sleep: async () => {},
			now: () => 1_000,
			apiBase: "https://api.telegram.test",
			answerWatchMs: 60_000,
		});
	}

	const request = {
		promptId: "p1",
		question: "Paste the redirect URL:",
		asker: "refarm sow",
		needsDecision: true,
		answerTravels: false,
		expiresAt: null,
	} as never;

	function scriptedFetch(responses: unknown[]) {
		let call = 0;
		return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			const body = responses[Math.min(call, responses.length - 1)];
			call += 1;
			return jsonResponse(body);
		});
	}

	const sent = { ok: true, result: { message_id: 77 } };

	it("accepts a reply bound to the question it asked", async () => {
		const answers: string[] = [];
		const fetchImpl = scriptedFetch([
			sent,
			{
				ok: true,
				result: [{ update_id: 1, message: { text: "https://x/cb?code=abc", reply_to_message: { message_id: 77 } } }],
			},
		]);
		const outcome = await watchingAdapter(fetchImpl as never).offerTextAnswer?.(request, {
			answer: (value) => {
				answers.push(String(value));
				return true;
			},
		});
		expect(answers).toEqual(["https://x/cb?code=abc"]);
		expect(outcome?.status).toBe("delivered");
	});

	// THE ASSERTION THAT MATTERS. Capturing "the next message in the chat" would turn any
	// unrelated line — or, in a group, anyone else's line — into the answer to a pending question.
	it("ignores a message that is not a reply to this question", async () => {
		const answers: string[] = [];
		const fetchImpl = scriptedFetch([
			sent,
			{ ok: true, result: [{ update_id: 1, message: { text: "bom dia" } }] },
		]);
		await watchingAdapter(fetchImpl as never).offerTextAnswer?.(request, {
			answer: (value) => {
				answers.push(String(value));
				return true;
			},
		});
		expect(answers).toEqual([]);
	});

	it("ignores a reply to a DIFFERENT message", async () => {
		const answers: string[] = [];
		const fetchImpl = scriptedFetch([
			sent,
			{
				ok: true,
				result: [{ update_id: 1, message: { text: "nope", reply_to_message: { message_id: 999 } } }],
			},
		]);
		await watchingAdapter(fetchImpl as never).offerTextAnswer?.(request, {
			answer: (value) => {
				answers.push(String(value));
				return true;
			},
		});
		expect(answers).toEqual([]);
	});

	it("asks the client to compose a reply, which is what makes the binding natural", async () => {
		const fetchImpl = scriptedFetch([sent, { ok: true, result: [] }]);
		await watchingAdapter(fetchImpl as never).offerTextAnswer?.(request, { answer: () => true });
		const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit)?.body ?? "{}"));
		expect(body.reply_markup).toEqual({ force_reply: true });
	});

	it("treats sent-and-unanswered as delivered, because it was", async () => {
		const fetchImpl = scriptedFetch([sent, { ok: true, result: [] }]);
		const outcome = await watchingAdapter(fetchImpl as never).offerTextAnswer?.(request, {
			answer: () => true,
		});
		// The question REACHED the operator. What happens next is the asker's timeout to decide.
		expect(outcome?.status).toBe("delivered");
		expect(outcome?.detail).toContain("no reply");
	});
});
