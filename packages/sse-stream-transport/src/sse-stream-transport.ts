import type http from "node:http";
import type { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import {
	STREAM_CAPABILITY,
	type StreamChunk,
	type StreamTransportAdapter,
} from "@refarm.dev/stream-contract-v1";

export type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
) => boolean;

export class SseStreamTransport implements StreamTransportAdapter {
	readonly capability = STREAM_CAPABILITY;
	private readonly connections = new Map<string, Set<http.ServerResponse>>();
	private readonly inProcess = new Map<
		string,
		Set<(chunk: StreamChunk) => void>
	>();
	private readonly stored = new Map<string, StreamChunk[]>();

	constructor(private readonly fileTransport: FileStreamTransport | null) {}

	write(chunk: StreamChunk): void {
		const stream = this.stored.get(chunk.stream_ref) ?? [];
		stream.push(chunk);
		this.stored.set(chunk.stream_ref, stream);
		const frame = `data: ${JSON.stringify(chunk)}\n\n`;
		for (const response of this.connections.get(chunk.stream_ref) ?? []) {
			response.write(frame);
			if (chunk.is_final) {
				response.write("data: [DONE]\n\n");
				response.end();
			}
		}
		if (chunk.is_final) {
			this.connections.delete(chunk.stream_ref);
		}
		for (const callback of this.inProcess.get(chunk.stream_ref) ?? []) {
			callback(chunk);
		}
	}

	subscribe(
		stream_ref: string,
		onChunk: (chunk: StreamChunk) => void,
	): () => void {
		const replaySource = this.fileTransport
			? this.fileTransport.replay(stream_ref)
			: this.stored.get(stream_ref) ?? [];
		for (const chunk of replaySource) {
			onChunk(chunk);
		}
		const set = this.inProcess.get(stream_ref) ?? new Set();
		set.add(onChunk);
		this.inProcess.set(stream_ref, set);
		return () => set.delete(onChunk);
	}

	getRouteHandler(): RouteHandler {
		return (req, res) => {
			const match = req.url?.match(/^\/stream\/(.+)$/);
			if (!match || req.method !== "GET") return false;
			const stream_ref = decodeURIComponent(match[1]);

			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});

			if (this.fileTransport) {
				for (const chunk of this.fileTransport.replay(stream_ref)) {
					res.write(`data: ${JSON.stringify(chunk)}\n\n`);
				}
			}

			const set = this.connections.get(stream_ref) ?? new Set();
			set.add(res);
			this.connections.set(stream_ref, set);

			const heartbeat = setInterval(() => {
				res.write(": heartbeat\n\n");
			}, 15_000);

			req.on("close", () => {
				clearInterval(heartbeat);
				this.connections.get(stream_ref)?.delete(res);
			});

			return true;
		};
	}
}
