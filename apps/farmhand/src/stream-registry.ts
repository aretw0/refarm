import type {
	StreamChunk,
	StreamProducer,
} from "@refarm.dev/stream-contract-v1";

export class StreamRegistry {
	private readonly adapters: StreamProducer[] = [];

	register(adapter: StreamProducer): void {
		this.adapters.push(adapter);
	}

	dispatch(chunk: StreamChunk): void {
		for (const adapter of this.adapters) {
			try {
				adapter.write(chunk);
			} catch {
				// adapter isolation: one broken transport must not silence others
			}
		}
	}
}
