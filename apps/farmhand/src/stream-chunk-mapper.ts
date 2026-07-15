import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

const AGENT_RESPONSE_STREAM_PREFIX = "urn:tractor:stream:response:";

function isAgentResponseStream(streamRef: string): boolean {
	return streamRef.startsWith(AGENT_RESPONSE_STREAM_PREFIX);
}

/**
 * Whether a host StreamChunk CRDT node should be projected to the ndjson/SSE/WS
 * transports.
 *
 * Every host chunk is projected. The historical concern was double-counting the
 * agent-response FINAL: on the Rust host the guest writes the final ndjson line
 * itself (via `std::fs`), so the host's is_final observation was dropped to avoid
 * filing the answer twice. But on the tractor-ts host (farmhand) the guest's
 * `wasi:filesystem`/`wasi:cli/environment` are inert stubs — the guest CANNOT
 * write the ndjson file, so dropping the host's final left the stream with no
 * terminal line at all (see `projectStreamChunk`, which now blanks the final's
 * content instead of dropping it, mirroring the guest's own end-marker rule).
 */
export function shouldProjectStreamChunk(_chunk: StreamChunk): boolean {
	return true;
}

/**
 * Normalize a host StreamChunk before it is projected to the ndjson/SSE/WS spine.
 *
 * Mirrors the guest's single-owner final-line rule (see the Rust
 * `final_stream_chunk_ndjson`): a CLI accumulates `content += chunk.content` over
 * EVERY projected line, so the agent-response FINAL must carry the whole answer
 * only when NO partials preceded it (single-shot, sequence 0). When partials
 * already carried the deltas (sequence > 0), the final is emitted as a pure
 * end-marker with empty content so `sum(partials) + final.content` equals the
 * answer exactly once. Non-final and non-agent-response chunks pass through
 * unchanged.
 */
export function projectStreamChunk(chunk: StreamChunk): StreamChunk {
	if (
		chunk.is_final &&
		isAgentResponseStream(chunk.stream_ref) &&
		chunk.sequence > 0 &&
		chunk.content.length > 0
	) {
		return { ...chunk, content: "" };
	}
	return chunk;
}

export function toStreamChunk(node: Record<string, unknown>): StreamChunk {
	return {
		stream_ref: typeof node.stream_ref === "string" ? node.stream_ref : "",
		content: typeof node.content === "string" ? node.content : "",
		sequence: typeof node.sequence === "number" ? node.sequence : 0,
		is_final: node.is_final === true,
		payload_kind:
			typeof node.payload_kind === "string"
				? (node.payload_kind as StreamChunk["payload_kind"])
				: undefined,
		metadata: node.metadata,
	};
}
