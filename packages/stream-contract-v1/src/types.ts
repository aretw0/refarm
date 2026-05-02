export const STREAM_CAPABILITY = "stream:v1" as const;

export interface StreamChunk {
	stream_ref: string;
	content: string;
	sequence: number;
	is_final: boolean;
	payload_kind?:
		| "text_delta"
		| "final_text"
		| "final_tool_call"
		| "final_empty";
	metadata?: unknown;
}

export interface StreamProducer {
	write(chunk: StreamChunk): void;
}

export interface StreamConsumer {
	subscribe(stream_ref: string, onChunk: (chunk: StreamChunk) => void): () => void;
}

export interface StreamTransportAdapter extends StreamProducer, StreamConsumer {
	readonly capability: typeof STREAM_CAPABILITY;
}
