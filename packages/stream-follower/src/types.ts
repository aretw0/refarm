import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

/**
 * A source of stream chunks for one `stream_ref` — the injectable half of the
 * follower. It abstracts WHERE the chunks come from (a local NDJSON file polled on
 * an interval, the sidecar's SSE endpoint over HTTP, a test array) so the follow
 * machine itself is transport-agnostic.
 *
 * `follow` delivers each chunk to `onChunk` as it arrives (including any already-
 * written chunks it can replay), and returns a `stop()` to release resources. The
 * source does NOT decide when the stream ends — the follower watches for `is_final`.
 * The source SHOULD surface a transport error via `onError` so the follower can
 * reject rather than hang.
 */
export interface ChunkSource {
	follow(
		streamRef: string,
		onChunk: (chunk: StreamChunk) => void,
		onError: (error: Error) => void,
	): { stop: () => void };
}

/** Options for {@link followStream}. */
export interface FollowStreamOptions {
	/** Give up (reject) if no final chunk arrives within this many ms. Default 45s. */
	timeoutMs?: number;
	/** Called for every chunk as it arrives (for incremental/streaming consumers). */
	onChunk?: (chunk: StreamChunk) => void;
	/**
	 * Called once if the stream ends before a final chunk for a reason the SOURCE
	 * knows (e.g. the effort failed) — lets a caller distinguish a real error from a
	 * timeout. The follower still rejects; this is an early, labelled signal.
	 */
	onError?: (error: Error) => void;
}

/** The resolved result of following a stream to its final chunk. */
export interface FollowStreamResult {
	/** The concatenated `content` of the delivered chunks, in sequence order. */
	content: string;
	/** The final chunk (the one with `is_final: true`). */
	final: StreamChunk;
	/** Every chunk delivered, in arrival order. */
	chunks: StreamChunk[];
}
