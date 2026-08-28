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
