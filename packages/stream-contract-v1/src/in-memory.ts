import { STREAM_CAPABILITY } from "./types.js";
import type { StreamChunk, StreamTransportAdapter } from "./types.js";

export class InMemoryStreamTransport implements StreamTransportAdapter {
	readonly capability = STREAM_CAPABILITY;
	private readonly stored = new Map<string, StreamChunk[]>();
	private readonly subscribers = new Map<
		string,
		Set<(chunk: StreamChunk) => void>
	>();

	write(chunk: StreamChunk): void {
		const stream = this.stored.get(chunk.stream_ref) ?? [];
		stream.push(chunk);
		this.stored.set(chunk.stream_ref, stream);
		for (const callback of this.subscribers.get(chunk.stream_ref) ?? []) {
			callback(chunk);
		}
	}

	subscribe(
		stream_ref: string,
		onChunk: (chunk: StreamChunk) => void,
	): () => void {
		for (const chunk of this.stored.get(stream_ref) ?? []) {
			onChunk(chunk);
		}
		const set = this.subscribers.get(stream_ref) ?? new Set();
		set.add(onChunk);
		this.subscribers.set(stream_ref, set);
		return () => set.delete(onChunk);
	}
}
