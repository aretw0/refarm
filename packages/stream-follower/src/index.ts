// The client-side stream follower: consume a StreamChunk stream to its final chunk,
// from an injectable source (local file poll, or the sidecar's SSE endpoint). This is
// the reusable CLIENT half of the stream transports — the SDK composes on top of it.

export { followStream } from "./follow.js";
export { createFileChunkSource } from "./file-source.js";
export { createSseChunkSource } from "./sse-source.js";
export type {
	ChunkSource,
	FollowStreamOptions,
	FollowStreamResult,
} from "./types.js";
export type { FileChunkSourceOptions } from "./file-source.js";
export type { SseChunkSourceOptions } from "./sse-source.js";
