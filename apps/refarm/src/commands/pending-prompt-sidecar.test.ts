import { describe, expect, it } from "vitest";

import { createSidecarPromptHub, SIDECAR_NOTICES_PATH } from "./pending-prompt-sidecar.js";

/**
 * The sidecar hub's ANNOUNCE half (N4).
 *
 * `POST /prompts` is covered by the node's own Rust suite over real sockets; what
 * cannot be asserted there is the property that only exists on this side: `say()` is
 * synchronous and total, so three notices said in a row become three POSTs, and
 * something has to keep them in order.
 */

const ASKER = { command: "refarm delivery add", pid: 7 };

/** A fetch that records every call and lets the test decide when each one settles. */
function recordingFetch(options: { delaysMs?: number[]; failAt?: number } = {}) {
	const paths: string[] = [];
	/** Bodies in the order the SERVER received them — the thing under test. */
	const received: string[] = [];
	let call = 0;

	// Typed off `globalThis.fetch` rather than off `RequestInfo`, which this package's
	// lib config does not carry — the same way the module under test builds its default.
	type FetchArgs = Parameters<typeof globalThis.fetch>;
	const fetchImpl = (async (input: FetchArgs[0], init?: FetchArgs[1]) => {
		const index = call++;
		const url = typeof input === "string" ? input : String(input);
		paths.push(new URL(url).pathname);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		const delay = options.delaysMs?.[index] ?? 0;
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		if (options.failAt === index) throw new Error("socket hang up");
		received.push(String(body.message ?? ""));
		return new Response(JSON.stringify({ ordinal: index + 1 }), { status: 200 });
	}) as typeof globalThis.fetch;

	return { fetch: fetchImpl, paths, received };
}

/** Let the internal queue drain. Generous relative to the delays used below. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

describe("the sidecar announces to the node (N4)", () => {
	it("posts a notice to /notices, not to /prompts", async () => {
		const spy = recordingFetch();
		const hub = createSidecarPromptHub({ baseUrl: "http://127.0.0.1:42001", fetch: spy.fetch });

		hub.announce(ASKER, "o bot é seu");
		await settle();

		expect(spy.paths).toEqual([SIDECAR_NOTICES_PATH]);
		expect(spy.received).toEqual(["o bot é seu"]);
	});

	it("keeps three rapid notices IN ORDER even when the first POST is slow", async () => {
		// THE assertion this whole mechanism exists for. `say()` cannot await, so
		// without an internal queue these three are concurrent — and the node stamps
		// `ordinal` ON ARRIVAL, so the operator's phone would show the preflight
		// shuffled. Framing out of order reads as incoherence, which is worse than
		// framing absent. Remove the queue and this test must fail.
		const spy = recordingFetch({ delaysMs: [60, 0, 0] });
		const hub = createSidecarPromptHub({ baseUrl: "http://127.0.0.1:42001", fetch: spy.fetch });

		hub.announce(ASKER, "precisa de um bot SEU");
		hub.announce(ASKER, "e do chatId");
		hub.announce(ASKER, "refarm não fala com o BotFather por você");
		await settle();

		expect(spy.received).toEqual([
			"precisa de um bot SEU",
			"e do chatId",
			"refarm não fala com o BotFather por você",
		]);
	});

	it("say() returns immediately — the queue must not make a wizard wait", () => {
		const spy = recordingFetch({ delaysMs: [1_000] });
		const hub = createSidecarPromptHub({ baseUrl: "http://127.0.0.1:42001", fetch: spy.fetch });

		const before = Date.now();
		hub.announce(ASKER, "não deve bloquear");
		expect(Date.now() - before).toBeLessThan(50);
	});

	it("a failed POST is swallowed and the next one still goes", async () => {
		const warned: string[] = [];
		const spy = recordingFetch({ failAt: 0 });
		const hub = createSidecarPromptHub({
			baseUrl: "http://127.0.0.1:42001",
			fetch: spy.fetch,
			warn: (message) => warned.push(message),
		});

		expect(() => hub.announce(ASKER, "esta falha")).not.toThrow();
		hub.announce(ASKER, "esta passa");
		await settle();

		// The framing that made it still made it: a broken notification arrangement
		// must not be why a wizard stops explaining itself.
		expect(spy.received).toEqual(["esta passa"]);
		expect(warned.length).toBeGreaterThan(0);
	});

	it("still records locally, so delivery and the terminal are unaffected by the node", async () => {
		const spy = recordingFetch({ failAt: 0 });
		const hub = createSidecarPromptHub({ baseUrl: "http://127.0.0.1:42001", fetch: spy.fetch });

		hub.announce(ASKER, "o enquadramento");
		await settle();

		expect(hub.notices().map((n) => n.message)).toEqual(["o enquadramento"]);
		expect(hub.noticesFor(ASKER.command).map((n) => n.message)).toEqual(["o enquadramento"]);
	});
});
