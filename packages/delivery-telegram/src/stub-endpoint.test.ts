import type { DeliveryRequest } from "@refarm.dev/delivery-contract-v1";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createTelegramDeliveryAdapter } from "./index.js";

/**
 * End-to-end against a LOCAL stub of the Bot API.
 *
 * The rest of the suite mocks `fetch`, which proves the adapter's decisions but
 * not its wire: a wrong URL shape, a missing header, or a body that does not
 * serialise would all pass a mock and fail against a server. This binds a real
 * `node:http` server on 127.0.0.1 and drives the adapter's real `fetch` through
 * it. No packet leaves the machine, and no real bot token exists — the stub
 * accepts any token and asserts on what it received.
 */

const TOKEN = "7654321:AAHstubTokenNotARealCredential";

interface Received {
	path: string;
	body: Record<string, unknown>;
	userAgent: string | undefined;
}

let server: http.Server | null = null;

afterEach(async () => {
	if (server) {
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = null;
	}
});

async function startStub(
	handler: (received: Received, all: Received[]) => unknown,
): Promise<{ base: string; received: Received[] }> {
	const received: Received[] = [];
	server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			const entry: Received = {
				path: req.url ?? "",
				body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
				userAgent: req.headers["user-agent"],
			};
			received.push(entry);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(handler(entry, received)));
		});
	});
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return { base: `http://127.0.0.1:${port}`, received };
}

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
	return {
		promptId: "p-e2e",
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

describe("end to end against a local Bot API stub", () => {
	it("announces over real HTTP, with the token in the path and not the body", async () => {
		const { base, received } = await startStub(() => ({ ok: true, result: { message_id: 11 } }));
		const adapter = createTelegramDeliveryAdapter({
			chatId: "424242",
			resolveToken: async () => TOKEN,
			apiBase: base,
			answerWatchMs: 0,
		});

		const outcome = await adapter.announce(request());

		expect(outcome.status).toBe("delivered");
		expect(outcome.detail).toContain("message 11");
		expect(received).toHaveLength(1);
		expect(received[0]!.path).toBe(`/bot${TOKEN}/sendMessage`);
		expect(received[0]!.userAgent).toContain("refarm-delivery-telegram");
		expect(received[0]!.body.chat_id).toBe("424242");
		expect(String(received[0]!.body.text)).toContain("Bring the VPN up?");
		expect(JSON.stringify(received[0]!.body)).not.toContain(TOKEN);
		expect(JSON.stringify(outcome)).not.toContain(TOKEN);
	});

	it("offers an inline keyboard and settles the prompt when the button comes back", async () => {
		const { base, received } = await startStub((entry) => {
			if (entry.path.endsWith("/sendMessage")) return { ok: true, result: { message_id: 12 } };
			if (entry.path.endsWith("/getUpdates")) {
				return {
					ok: true,
					result: [{ update_id: 1, callback_query: { id: "cb-e2e", data: "p-e2e|0" } }],
				};
			}
			return { ok: true, result: true };
		});

		const settled: Array<string | boolean> = [];
		const adapter = createTelegramDeliveryAdapter({
			chatId: "424242",
			resolveToken: async () => TOKEN,
			apiBase: base,
			answerWatchMs: 60_000,
			sleep: async () => {},
		});

		const outcome = await adapter.offerAnswer!(request(), {
			answer: (value) => {
				settled.push(value);
				return true;
			},
		});
		expect(outcome.status).toBe("delivered");
		expect(outcome.mode).toBe("answer");

		// The watch runs detached: sink.answer() settles `settled` synchronously,
		// then acknowledge() fires a SEPARATE, still-in-flight answerCallbackQuery
		// request. Wait for both signals this test asserts on below, not just the
		// first one to land — or the acknowledgement can still be in flight when
		// the assertion checks for it.
		const deadline = Date.now() + 2_000;
		while (
			(settled.length === 0 ||
				!received.some((r) => r.path.endsWith("/answerCallbackQuery"))) &&
			Date.now() < deadline
		) {
			await new Promise((r) => setTimeout(r, 10));
		}

		expect(settled).toEqual(["true"]);
		const send = received.find((r) => r.path.endsWith("/sendMessage"))!;
		expect(send.body.reply_markup).toEqual({
			inline_keyboard: [
				[{ text: "Yes", callback_data: "p-e2e|0" }],
				[{ text: "No", callback_data: "p-e2e|1" }],
			],
		});
		expect(received.some((r) => r.path.endsWith("/answerCallbackQuery"))).toBe(true);
	});

	it("a real 403 from the stub is a transport refusal, and leaks no token", async () => {
		const { base } = await startStub(() => ({
			ok: false,
			error_code: 403,
			description: `Forbidden: bot ${TOKEN} was blocked by the user`,
		}));
		// The stub answers HTTP 200 carrying `error_code: 403` — what an
		// intermediary that rewrites the status looks like. The verdict is still
		// Telegram's, so this must be a refusal and must NOT be retried.
		const adapter = createTelegramDeliveryAdapter({
			chatId: "424242",
			resolveToken: async () => TOKEN,
			apiBase: base,
			sleep: async () => {},
			answerWatchMs: 0,
		});
		const outcome = await adapter.announce(request());
		expect(outcome.status).toBe("refused");
		expect(JSON.stringify(outcome)).not.toContain(TOKEN);
		expect(outcome.detail).toContain("[redacted]");
	});
});
