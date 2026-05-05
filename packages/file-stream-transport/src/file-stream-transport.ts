import fs from "node:fs";
import path from "node:path";
import {
	STREAM_CAPABILITY,
	type StreamChunk,
	type StreamTransportAdapter,
} from "@refarm.dev/stream-contract-v1";

export class FileStreamTransport implements StreamTransportAdapter {
	readonly capability = STREAM_CAPABILITY;
	private readonly subscribers = new Map<
		string,
		Set<(chunk: StreamChunk) => void>
	>();

	constructor(private readonly baseDir: string) {
		fs.mkdirSync(baseDir, { recursive: true });
	}

	private filePath(stream_ref: string): string {
		return path.join(this.baseDir, `${stream_ref}.ndjson`);
	}

	write(chunk: StreamChunk): void {
		fs.appendFileSync(this.filePath(chunk.stream_ref), `${JSON.stringify(chunk)}\n`);
		for (const callback of this.subscribers.get(chunk.stream_ref) ?? []) {
			callback(chunk);
		}
	}

	subscribe(
		stream_ref: string,
		onChunk: (chunk: StreamChunk) => void,
	): () => void {
		for (const chunk of this.replay(stream_ref)) {
			onChunk(chunk);
		}
		const set = this.subscribers.get(stream_ref) ?? new Set();
		set.add(onChunk);
		this.subscribers.set(stream_ref, set);
		return () => set.delete(onChunk);
	}

	replay(stream_ref: string): StreamChunk[] {
		const filePath = this.filePath(stream_ref);
		if (!fs.existsSync(filePath)) return [];
		return fs
			.readFileSync(filePath, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as StreamChunk);
	}
}
