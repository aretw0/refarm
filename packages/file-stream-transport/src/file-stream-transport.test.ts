import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConformanceTests } from "@refarm.dev/stream-contract-v1";
import { FileStreamTransport } from "./file-stream-transport.js";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "file-stream-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

runConformanceTests("FileStreamTransport", () => new FileStreamTransport(tempDir));

describe("FileStreamTransport — file persistence", () => {
	it("writes chunks to NDJSON file", () => {
		const transport = new FileStreamTransport(tempDir);
		transport.write({
			stream_ref: "s1",
			content: "hello",
			sequence: 0,
			is_final: false,
		});
		transport.write({
			stream_ref: "s1",
			content: "world",
			sequence: 1,
			is_final: true,
		});
		const chunks = transport.replay("s1");
		expect(chunks).toHaveLength(2);
		expect(chunks[0].content).toBe("hello");
		expect(chunks[1].content).toBe("world");
	});

	it("replay returns empty array for unknown stream_ref", () => {
		const transport = new FileStreamTransport(tempDir);
		expect(transport.replay("unknown")).toEqual([]);
	});

	it("late-subscribe replays persisted chunks in order", () => {
		const writer = new FileStreamTransport(tempDir);
		writer.write({
			stream_ref: "s2",
			content: "a",
			sequence: 0,
			is_final: false,
		});
		writer.write({
			stream_ref: "s2",
			content: "b",
			sequence: 1,
			is_final: false,
		});

		const reader = new FileStreamTransport(tempDir);
		const received: string[] = [];
		reader.subscribe("s2", (chunk) => {
			received.push(chunk.content);
		});
		expect(received).toEqual(["a", "b"]);
	});
});
