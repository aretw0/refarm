import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

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
