import { describe, expect, it, vi } from "vitest";
import { createOperationClient } from "./client.js";

function response(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("operation web client", () => {
	it("puts the current bearer only in the authorization header", async () => {
		let token = "first";
		const fetch = vi.fn().mockResolvedValue(response(200, { catalog: { operations: [] } }));
		const client = createOperationClient({ fetch, token: () => token });
		await client.list();
		token = "second";
		await client.start("delivery add");
		expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer first" });
		expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer second" });
		expect(fetch.mock.calls[1]?.[0]).toBe("/operations");
		expect(fetch.mock.calls[1]?.[1]?.body).toBe('{"operation":"delivery add"}');
	});

	it("keeps authorization, ceiling and reachability distinct", async () => {
		for (const [result, kind] of [
			[response(401, {}), "unauthorized"],
			[response(409, { error: "already-running" }), "already-running"],
			[response(503, { error: "could-not-start" }), "unavailable"],
		] as const) {
			const client = createOperationClient({ fetch: async () => result, token: () => "token" });
			const outcome = await client.start("delivery add");
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) expect(outcome.refusal.kind).toBe(kind);
		}
		const unreachable = createOperationClient({
			fetch: async () => {
				throw new Error("offline");
			},
			token: () => "token",
		});
		const outcome = await unreachable.list();
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.refusal).toMatchObject({ kind: "unavailable", status: null });
	});

	it("reads a started run then its terminal lifecycle without command output", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				response(202, { started: true, operation: "delivery add", runId: "r-1", output: "secret" }),
			)
			.mockResolvedValueOnce(
				response(200, {
					operation: "delivery add",
					runId: "r-1",
					state: "succeeded",
					exitCode: 0,
					output: "secret",
				}),
			);
		const client = createOperationClient({ fetch, token: () => "token" });
		expect(await client.start("delivery add")).toEqual({
			ok: true,
			run: { operation: "delivery add", runId: "r-1", state: "running", exitCode: null },
		});
		expect(await client.status("r-1")).toEqual({
			ok: true,
			run: { operation: "delivery add", runId: "r-1", state: "succeeded", exitCode: 0 },
		});
	});
});
