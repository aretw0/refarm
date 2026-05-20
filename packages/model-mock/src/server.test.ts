import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createModelMock, says } from "./index.js";
import type { ModelMockServer } from "./server.js";

let mock: ModelMockServer;

beforeEach(async () => {
	mock = await createModelMock();
});

afterEach(async () => {
	await mock.stop();
});

describe("ModelMockServer — non-streaming", () => {
	it("returns scripted text response as JSON", async () => {
		mock.queue(says("Olá do mock!"));

		const res = await fetch(`http://127.0.0.1:${mock.port}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer mock-key" },
			body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "oi" }] }),
		});

		expect(res.status).toBe(200);
		const body = await res.json() as { choices: Array<{ message: { content: string } }> };
		expect(body.choices[0].message.content).toBe("Olá do mock!");
	});

	it("captures the request for assertion", async () => {
		mock.queue(says("ok"));

		await fetch(`http://127.0.0.1:${mock.port}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer mock-key" },
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "qual é o sentido da vida?" }],
			}),
		});

		expect(mock.requests).toHaveLength(1);
		expect(mock.requests[0].messages.at(-1)?.content).toBe("qual é o sentido da vida?");
	});

	it("throws when queue is exhausted", async () => {
		// no responses queued
		const res = await fetch(`http://127.0.0.1:${mock.port}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer mock-key" },
			body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
		});

		expect(res.status).toBe(500);
		const body = await res.json() as { error: { type: string } };
		expect(body.error.type).toBe("mock_error");
	});
});

describe("ModelMockServer — SSE streaming", () => {
	it("returns scripted text as SSE chunks", async () => {
		mock.queue(says("Resposta via stream"));

		const res = await fetch(`http://127.0.0.1:${mock.port}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer mock-key" },
			body: JSON.stringify({
				model: "gpt-4o-mini",
				stream: true,
				messages: [{ role: "user", content: "stream?" }],
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");

		const text = await res.text();
		// Must contain a delta chunk and the [DONE] sentinel
		expect(text).toContain("Resposta via stream");
		expect(text).toContain("[DONE]");
	});

	it("marks streaming requests in captured requests", async () => {
		mock.queue(says("streamed"));

		await fetch(`http://127.0.0.1:${mock.port}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer mock-key" },
			body: JSON.stringify({ model: "gpt-4o-mini", stream: true, messages: [] }),
		});

		expect(mock.requests[0].stream).toBe(true);
	});
});

describe("ModelMockServer — repeatLast", () => {
	it("reuses last response when queue is exhausted", async () => {
		const repeatMock = await createModelMock({ repeatLast: true });
		repeatMock.queue(says("sempre essa"));

		// two calls, one queued response
		for (let i = 0; i < 2; i++) {
			const res = await fetch(`http://127.0.0.1:${repeatMock.port}/v1/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer mock-key" },
				body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
			});
			const body = await res.json() as { choices: Array<{ message: { content: string } }> };
			expect(body.choices[0].message.content).toBe("sempre essa");
		}

		await repeatMock.stop();
	});
});
