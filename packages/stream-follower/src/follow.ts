import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

import type {
	ChunkSource,
	FollowStreamOptions,
	FollowStreamResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Follow a stream to completion: subscribe to `source` for `streamRef`, collect the
 * chunks, and resolve when the final chunk (`is_final: true`) arrives — or reject on
 * timeout / source error. This is the transport-AGNOSTIC follow machine; the source
 * (file poll, SSE, test array) supplies the chunks.
 *
 * Chunks are de-duplicated by `sequence` (a polling file source re-reads the same
 * lines each tick, and a late subscribe replays past chunks — both can re-deliver).
 * `onChunk` (option) fires once per NEW chunk, in the order it first arrives, for
 * incremental consumers. The resolved `content` concatenates chunk `content` in
 * ascending `sequence` order, so it is stable regardless of arrival races.
 */
export function followStream(
	source: ChunkSource,
	streamRef: string,
	options: FollowStreamOptions = {},
): Promise<FollowStreamResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return new Promise<FollowStreamResult>((resolve, reject) => {
		const seen = new Set<number>();
		const chunks: StreamChunk[] = [];
		let settled = false;
		let handle: { stop: () => void } | null = null;
		let stopRequested = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			if (timer) clearTimeout(timer);
			// The source may deliver a final chunk SYNCHRONOUSLY inside `follow()`, before
			// `handle` is assigned below. Record the intent so the assignment site stops it.
			if (handle) handle.stop();
			else stopRequested = true;
		};
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};

		const onChunk = (chunk: StreamChunk) => {
			if (settled) return;
			// De-dupe re-delivered chunks (poll re-reads, replay-on-subscribe).
			if (typeof chunk.sequence === "number") {
				if (seen.has(chunk.sequence)) return;
				seen.add(chunk.sequence);
			}
			chunks.push(chunk);
			options.onChunk?.(chunk);
			if (chunk.is_final) {
				const ordered = [...chunks].sort((a, b) => a.sequence - b.sequence);
				const content = ordered.map((c) => c.content).join("");
				finish(() => resolve({ content, final: chunk, chunks: ordered }));
			}
		};

		const onError = (error: Error) => {
			options.onError?.(error);
			finish(() => reject(error));
		};

		timer = setTimeout(() => {
			finish(() =>
				reject(
					new Error(
						`stream '${streamRef}' did not reach a final chunk within ${timeoutMs}ms`,
					),
				),
			);
		}, timeoutMs);

		try {
			handle = source.follow(streamRef, onChunk, onError);
			// If the source settled us synchronously (final chunk during follow), honour
			// the stop it couldn't run yet because `handle` was still null.
			if (stopRequested) handle.stop();
		} catch (error) {
			finish(() => reject(error instanceof Error ? error : new Error(String(error))));
		}
	});
}
