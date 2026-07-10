import fs from "node:fs";
import path from "node:path";

import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

import type { ChunkSource } from "./types.js";

export interface FileChunkSourceOptions {
	/** Poll interval in ms (how often the NDJSON file is re-read). Default 100ms. */
	pollIntervalMs?: number;
	/**
	 * When the exact `<streamRef>.ndjson` doesn't exist, fall back to the newest
	 * `*.ndjson` in the dir modified at/after this time (ms). Mirrors the CLI's
	 * behaviour where the runtime picks the stream file name. Omit to require the
	 * exact name.
	 */
	newestSinceMs?: number;
}

/**
 * A {@link ChunkSource} that follows a local NDJSON stream file written by ANOTHER
 * process (the runtime daemon / agent). It polls the file on an interval and emits
 * each newly-appended line as a {@link StreamChunk} — this is why it can't be the
 * in-process FileStreamTransport (whose subscribe only fires on same-process writes):
 * the writer is a different process, so we must poll.
 *
 * This is the extraction of apps/refarm's `followStreamFile` into a reusable,
 * transport-shaped client, with the follow/timeout/is_final logic moved to
 * {@link followStream}.
 */
export function createFileChunkSource(
	streamsDir: string,
	options: FileChunkSourceOptions = {},
): ChunkSource {
	const pollIntervalMs = options.pollIntervalMs ?? 100;

	return {
		follow(streamRef, onChunk, onError) {
			let resolvedPath: string | null = null;
			let lineOffset = 0;
			let polling = false;

			const resolvePath = (): string | null => {
				const exact = path.join(streamsDir, `${streamRef}.ndjson`);
				if (fs.existsSync(exact)) return exact;
				if (options.newestSinceMs === undefined || !fs.existsSync(streamsDir)) {
					return null;
				}
				const candidates = fs
					.readdirSync(streamsDir)
					.filter((name) => name.endsWith(".ndjson"))
					.map((name) => {
						const filePath = path.join(streamsDir, name);
						return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
					})
					.filter((e) => e.mtimeMs >= options.newestSinceMs! - 2_000)
					.sort((a, b) => b.mtimeMs - a.mtimeMs);
				return candidates[0]?.filePath ?? null;
			};

			const readNew = () => {
				if (polling) return;
				polling = true;
				try {
					if (!resolvedPath) resolvedPath = resolvePath();
					if (!resolvedPath || !fs.existsSync(resolvedPath)) return;
					const lines = fs
						.readFileSync(resolvedPath, "utf-8")
						.split("\n")
						.filter(Boolean);
					for (let i = lineOffset; i < lines.length; i++) {
						try {
							onChunk(JSON.parse(lines[i]!) as StreamChunk);
						} catch {
							continue; // a partially-written line; picked up next poll
						}
					}
					lineOffset = lines.length;
				} catch (error) {
					onError(error instanceof Error ? error : new Error(String(error)));
				} finally {
					polling = false;
				}
			};

			readNew();
			const timer = setInterval(readNew, pollIntervalMs);
			return { stop: () => clearInterval(timer) };
		},
	};
}
