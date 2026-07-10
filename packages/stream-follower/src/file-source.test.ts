import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import { afterEach, describe, expect, it } from "vitest";

import { createFileChunkSource } from "./file-source.js";
import { followStream } from "./follow.js";

let dir: string | null = null;
afterEach(() => {
	if (dir) fs.rmSync(dir, { recursive: true, force: true });
	dir = null;
});

function makeDir(): string {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "stream-follower-"));
	return dir;
}

function appendChunk(streamsDir: string, ref: string, chunk: StreamChunk): void {
	fs.appendFileSync(path.join(streamsDir, `${ref}.ndjson`), `${JSON.stringify(chunk)}\n`);
}

describe("createFileChunkSource", () => {
	it("follows an NDJSON file written progressively by another process", async () => {
		const streamsDir = makeDir();
		const ref = "effort-1";
		const source = createFileChunkSource(streamsDir, { pollIntervalMs: 10 });

		// The 'other process' writes chunks over time while we follow.
		setTimeout(
			() =>
				appendChunk(streamsDir, ref, {
					stream_ref: ref,
					content: "Hel",
					sequence: 0,
					is_final: false,
				}),
			15,
		);
		setTimeout(
			() =>
				appendChunk(streamsDir, ref, {
					stream_ref: ref,
					content: "lo",
					sequence: 1,
					is_final: false,
				}),
			30,
		);
		setTimeout(
			() =>
				appendChunk(streamsDir, ref, {
					stream_ref: ref,
					content: "!",
					sequence: 2,
					is_final: true,
				}),
			45,
		);

		const result = await followStream(source, ref, { timeoutMs: 2_000 });
		expect(result.content).toBe("Hello!");
		expect(result.final.is_final).toBe(true);
	});

	it("replays chunks already written before the follow started", async () => {
		const streamsDir = makeDir();
		const ref = "effort-2";
		// File is already complete before we subscribe.
		appendChunk(streamsDir, ref, { stream_ref: ref, content: "done", sequence: 0, is_final: true });
		const source = createFileChunkSource(streamsDir, { pollIntervalMs: 10 });
		const result = await followStream(source, ref, { timeoutMs: 1_000 });
		expect(result.content).toBe("done");
	});

	it("times out when the final chunk never lands", async () => {
		const streamsDir = makeDir();
		const ref = "effort-3";
		appendChunk(streamsDir, ref, {
			stream_ref: ref,
			content: "partial",
			sequence: 0,
			is_final: false,
		});
		const source = createFileChunkSource(streamsDir, { pollIntervalMs: 10 });
		await expect(followStream(source, ref, { timeoutMs: 80 })).rejects.toThrow(
			/did not reach a final chunk/,
		);
	});
});
