import { toPendingPrompt } from "@refarm.dev/prompt-contract-v1";
import { describe, expect, it } from "vitest";

import { createAttendClient, type AttendFetch } from "./client.js";

const NOW = 1_800_000_000_000;

const listBody = {
	wire: "pending-prompt.v1",
	pollIntervalMs: 3_000,
	prompts: [
		toPendingPrompt(
			{ type: "confirm", question: "Apply?" },
			{ id: "p-1", asker: { command: "refarm auth enrol" }, askedAt: NOW },
		),
	],
};

interface Call {
	url: string;
	init: RequestInit | undefined;
}

/** A fetch that records what it was asked for and replies from a script. */
function scripted(reply: (url: string, init?: RequestInit) => Response | Promise<Response>): {
	fetch: AttendFetch;
	calls: Call[];
} {
	const calls: Call[] = [];
	return {
		calls,
		fetch: async (url, init) => {
			calls.push({ url, init });
			return reply(url, init);
		},
	};
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("the two requests", () => {
	it("lists prompts and reports the cadence the node advertised", async () => {
		const { fetch, calls } = scripted(() => json(200, listBody));
		const client = createAttendClient({ fetch, token: () => "tok" });
		const outcome = await client.list();
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.prompts).toHaveLength(1);
		expect(outcome.prompts[0]?.id).toBe("p-1");
		expect(outcome.pollIntervalMs).toBe(3_000);
		expect(calls[0]?.url).toBe("/prompts");
	});

	it("puts the bearer in Authorization and NOWHERE else", async () => {
		const { fetch, calls } = scripted(() => json(200, { outcome: "answered", device: "d" }));
		const client = createAttendClient({ fetch, token: () => "s3cret-bearer" });
		await client.list();
		await client.answer("p-1", true);
		for (const call of calls) {
			expect(call.url).not.toContain("s3cret-bearer");
			const headers = call.init?.headers as Record<string, string>;
			expect(headers.authorization).toBe("Bearer s3cret-bearer");
			expect(String(call.init?.body ?? "")).not.toContain("s3cret-bearer");
		}
	});

	it("sends no Authorization at all when there is no credential", async () => {
		const { fetch, calls } = scripted(() => json(401, { error: "unauthorized" }));
		const client = createAttendClient({ fetch, token: () => null });
		await client.list();
		expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBeUndefined();
	});

	it("reads the token afresh on every call, so a re-handshake takes effect immediately", async () => {
		let token = "old";
		const { fetch, calls } = scripted(() => json(200, listBody));
		const client = createAttendClient({ fetch, token: () => token });
		await client.list();
		token = "new";
		await client.list();
		expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe("Bearer old");
		expect((calls[1]?.init?.headers as Record<string, string>).authorization).toBe("Bearer new");
	});

	it("sends `value` and nothing else — a claimed device would be a lie either way", async () => {
		const { fetch, calls } = scripted(() => json(200, { outcome: "answered", device: "browser" }));
		const client = createAttendClient({ fetch, token: () => "tok" });
		const outcome = await client.answer("p/1", "hello");
		expect(outcome).toEqual({ ok: true, device: "browser" });
		expect(calls[0]?.url).toBe("/prompts/p%2F1/answer");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ value: "hello" });
	});

	it("honours a baseUrl for a client that is not the page", async () => {
		const { fetch, calls } = scripted(() => json(200, listBody));
		await createAttendClient({ fetch, baseUrl: "http://127.0.0.1:43911", token: () => null }).list();
		expect(calls[0]?.url).toBe("http://127.0.0.1:43911/prompts");
	});
});

describe("the client keeps the three refusals apart", () => {
	it("401 on the list becomes `credential-expired`", async () => {
		const { fetch } = scripted(() => json(401, { error: "unauthorized" }));
		const outcome = await createAttendClient({ fetch, token: () => "stale" }).list();
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.refusal).toEqual({ reason: "credential-expired", status: 401 });
	});

	it("409 on an answer names the winner", async () => {
		const { fetch } = scripted(() => json(409, { error: "already-settled", outcome: "answered", device: "my-phone" }));
		const outcome = await createAttendClient({ fetch, token: () => "tok" }).answer("p-1", true);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.refusal).toMatchObject({ reason: "settled-elsewhere" });
	});

	it("a thrown fetch becomes `unreachable` on BOTH routes, never an exception", async () => {
		const { fetch } = scripted(() => {
			throw new TypeError("Failed to fetch");
		});
		const client = createAttendClient({ fetch, token: () => "tok" });
		const listed = await client.list();
		expect(listed).toEqual({ ok: false, refusal: { reason: "unreachable", detail: "Failed to fetch" } });
		const answered = await client.answer("p-1", true);
		expect(answered).toEqual({ ok: false, refusal: { reason: "unreachable", detail: "Failed to fetch" } });
	});

	it("an HTML error page from a proxy is classified by STATUS, not by a parse crash", async () => {
		const { fetch } = scripted(
			() => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
		);
		const client = createAttendClient({ fetch, token: () => "tok" });
		expect(await client.list()).toEqual({ ok: false, refusal: { reason: "http", status: 502 } });
		expect(await client.answer("p-1", true)).toEqual({ ok: false, refusal: { reason: "http", status: 502 } });
	});

	it("a 200 whose body is not JSON yields an empty list rather than a crash", async () => {
		const { fetch } = scripted(() => new Response("not json", { status: 200 }));
		const outcome = await createAttendClient({ fetch, token: () => "tok" }).list();
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.prompts).toEqual([]);
		expect(outcome.pollIntervalMs).toBe(2_000);
	});

	it("passes an abort signal through, so a closed page stops asking", async () => {
		const controller = new AbortController();
		const { fetch, calls } = scripted(() => json(200, listBody));
		await createAttendClient({ fetch, token: () => null }).list(controller.signal);
		expect(calls[0]?.init?.signal).toBe(controller.signal);
	});
});

describe("the client honours the wire version the node declares", () => {
	it("proceeds on the version it speaks, and reports the verdict", async () => {
		const { fetch } = scripted(() => json(200, listBody));
		const outcome = await createAttendClient({ fetch, token: () => "tok" }).list();
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.wire.verdict).toBe("compatible");
		expect(outcome.prompts).toHaveLength(1);
	});

	it("refuses a version it does not speak, instead of reading an empty list", async () => {
		// Without the check the reader would drop every entry and this would come back
		// `ok: true` with `prompts: []` — a page confidently showing "Nothing pending".
		const moved = {
			...listBody,
			wire: "pending-prompt.v2",
			prompts: listBody.prompts.map((p) => ({ ...p, wire: "pending-prompt.v2" })),
		};
		const outcome = await createAttendClient({
			fetch: scripted(() => json(200, moved)).fetch,
			token: () => "tok",
		}).list();
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.refusal).toEqual({
			reason: "wire-incompatible",
			declared: "pending-prompt.v2",
			expected: "pending-prompt.v1",
		});
	});

	it("proceeds on a node that declared nothing, and says which case that was", async () => {
		// The operator's frozen surfaces, still working. `unknown` never becomes
		// `compatible`, and it never becomes a refusal either.
		const { wire: _dropped, ...undeclared } = listBody;
		const { fetch } = scripted(() => json(200, undeclared));
		const outcome = await createAttendClient({ fetch, token: () => "tok" }).list();
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.wire.verdict).toBe("unknown");
		expect(outcome.wire.verdict).not.toBe("compatible");
		// Still fully usable: the prompts themselves declare their own wire, and they do
		// speak this one.
		expect(outcome.prompts).toHaveLength(1);
		expect(outcome.prompts[0]?.id).toBe("p-1");
	});
});
