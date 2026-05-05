import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import { runConformanceTests } from "@refarm.dev/stream-contract-v1";
import { WsStreamTransport } from "./ws-stream-transport.js";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "ws-stream-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

runConformanceTests("WsStreamTransport (in-process)", () => {
	const server = http.createServer();
	return new WsStreamTransport(server, null);
});

describe("WsStreamTransport — WebSocket protocol", () => {
	it("delivers chunk to subscribed WS client", async () => {
		const server = http.createServer();
		const transport = new WsStreamTransport(server, null);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;

		const received: string[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
		await new Promise<void>((resolve) => ws.on("open", () => resolve()));
		ws.send(JSON.stringify({ action: "subscribe", stream_ref: "ws-ref1" }));
		ws.on("message", (data) => {
			received.push(data.toString());
		});

		await new Promise((resolve) => setTimeout(resolve, 30));
		transport.write({
			stream_ref: "ws-ref1",
			content: "hello",
			sequence: 0,
			is_final: false,
		});
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(received.some((message) => message.includes('"content":"hello"'))).toBe(
			true,
		);
		ws.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("closes WS connection with code 1000 on is_final", async () => {
		const server = http.createServer();
		const transport = new WsStreamTransport(server, null);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;

		let closeCode: number | undefined;
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
		await new Promise<void>((resolve) => ws.on("open", () => resolve()));
		ws.send(JSON.stringify({ action: "subscribe", stream_ref: "ws-ref2" }));
		ws.on("close", (code) => {
			closeCode = code;
		});

		await new Promise((resolve) => setTimeout(resolve, 30));
		transport.write({
			stream_ref: "ws-ref2",
			content: "last",
			sequence: 0,
			is_final: true,
		});
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(closeCode).toBe(1000);
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("replays past chunks from FileStreamTransport on subscribe", async () => {
		const fileTransport = new FileStreamTransport(tempDir);
		fileTransport.write({
			stream_ref: "ws-ref3",
			content: "past",
			sequence: 0,
			is_final: false,
		});

		const server = http.createServer();
		const transport = new WsStreamTransport(server, fileTransport);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;

		const received: string[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
		await new Promise<void>((resolve) => ws.on("open", () => resolve()));
		ws.on("message", (data) => {
			received.push(data.toString());
		});
		ws.send(JSON.stringify({ action: "subscribe", stream_ref: "ws-ref3" }));
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(received.some((message) => message.includes('"content":"past"'))).toBe(
			true,
		);
		ws.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
});
