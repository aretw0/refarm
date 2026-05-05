import type http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import { runConformanceTests } from "@refarm.dev/stream-contract-v1";
import { SseStreamTransport } from "./sse-stream-transport.js";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "sse-stream-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

runConformanceTests("SseStreamTransport", () => new SseStreamTransport(null));

describe("SseStreamTransport — HTTP route handler", () => {
	it("returns false for non-matching routes", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		const request = { method: "GET", url: "/other" } as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: () => {},
			end: () => {},
		} as unknown as http.ServerResponse;
		expect(handler(request, response)).toBe(false);
	});

	it("returns true and writes SSE headers for /stream/:ref", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		let headers: Record<string, string> = {};
		const request = {
			method: "GET",
			url: "/stream/my-ref",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: (_code: number, values: Record<string, string>) => {
				headers = values;
			},
			write: () => {},
			end: () => {},
		} as unknown as http.ServerResponse;

		expect(handler(request, response)).toBe(true);
		expect(headers["Content-Type"]).toBe("text/event-stream");
	});

	it("pushes SSE data frame to connected client on write()", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		const written: string[] = [];
		const request = {
			method: "GET",
			url: "/stream/r1",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: (chunk: string) => {
				written.push(chunk);
			},
			end: () => {},
		} as unknown as http.ServerResponse;

		handler(request, response);
		transport.write({
			stream_ref: "r1",
			content: "tok",
			sequence: 0,
			is_final: false,
		});

		expect(written.some((value) => value.includes('"content":"tok"'))).toBe(
			true,
		);
	});

	it("sends [DONE] frame and closes on is_final", () => {
		const transport = new SseStreamTransport(null);
		const handler = transport.getRouteHandler();
		const written: string[] = [];
		let ended = false;
		const request = {
			method: "GET",
			url: "/stream/r2",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: (chunk: string) => {
				written.push(chunk);
			},
			end: () => {
				ended = true;
			},
		} as unknown as http.ServerResponse;

		handler(request, response);
		transport.write({
			stream_ref: "r2",
			content: "last",
			sequence: 0,
			is_final: true,
		});

		expect(written.some((value) => value.includes("[DONE]"))).toBe(true);
		expect(ended).toBe(true);
	});

	it("replays chunks from FileStreamTransport on SSE connect", () => {
		const fileTransport = new FileStreamTransport(tempDir);
		fileTransport.write({
			stream_ref: "r3",
			content: "past",
			sequence: 0,
			is_final: false,
		});

		const transport = new SseStreamTransport(fileTransport);
		const handler = transport.getRouteHandler();
		const written: string[] = [];
		const request = {
			method: "GET",
			url: "/stream/r3",
			on: () => {},
		} as unknown as http.IncomingMessage;
		const response = {
			writeHead: () => {},
			write: (chunk: string) => {
				written.push(chunk);
			},
			end: () => {},
		} as unknown as http.ServerResponse;

		handler(request, response);
		expect(written.some((value) => value.includes('"content":"past"'))).toBe(
			true,
		);
	});
});
