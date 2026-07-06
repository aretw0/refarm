import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

const AGENT_RESPONSE_STREAM_PREFIX = "urn:tractor:stream:agent-response:";

/**
 * Whether a host StreamChunk CRDT node should be projected to the ndjson/SSE/WS
 * transports. Drops the host's WHOLE-ANSWER final observation for agent-response
 * streams: for those, the guest writes the single final ndjson line (an empty
 * end-marker when partials preceded it), while the host ALSO emits an is_final
 * StreamChunk carrying the whole assembled answer. Projecting both files the
 * answer twice into {stream_ref}.ndjson, so a CLI that accumulates
 * `content += chunk.content` would double it. Project the host's PARTIALS only;
 * the guest owns the final line. Non-agent-response streams project as before.
 */
export function shouldProjectStreamChunk(chunk: StreamChunk): boolean {
	return !(
		chunk.is_final &&
		chunk.stream_ref.startsWith(AGENT_RESPONSE_STREAM_PREFIX)
	);
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
