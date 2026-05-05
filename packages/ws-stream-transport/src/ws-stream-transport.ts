import type http from "node:http";
import type { Duplex } from "node:stream";
import type { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import {
	STREAM_CAPABILITY,
	type StreamChunk,
	type StreamTransportAdapter,
} from "@refarm.dev/stream-contract-v1";
import { WebSocket, WebSocketServer } from "ws";

export class WsStreamTransport implements StreamTransportAdapter {
	readonly capability = STREAM_CAPABILITY;
	private readonly wss: WebSocketServer;
	private readonly wsSubscribers = new Map<string, Set<WebSocket>>();
	private readonly inProcess = new Map<string, Set<(chunk: StreamChunk) => void>>();
	private readonly stored = new Map<string, StreamChunk[]>();

	constructor(
		server: http.Server,
		private readonly fileTransport: FileStreamTransport | null,
	) {
		this.wss = new WebSocketServer({ noServer: true });

		server.on("upgrade", (request, socket, head) => {
			if (request.url !== "/ws/stream") return;
			this.wss.handleUpgrade(request, socket as Duplex, head, (ws) => {
				this.wss.emit("connection", ws, request);
			});
		});

		this.wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString()) as {
						action?: string;
						stream_ref?: string;
					};
					if (message.action !== "subscribe" || !message.stream_ref) return;
					const stream_ref = message.stream_ref;

					const replaySource = this.fileTransport
						? this.fileTransport.replay(stream_ref)
						: this.stored.get(stream_ref) ?? [];
					for (const chunk of replaySource) {
						ws.send(JSON.stringify(chunk));
					}

					const set = this.wsSubscribers.get(stream_ref) ?? new Set();
					set.add(ws);
					this.wsSubscribers.set(stream_ref, set);

					ws.on("close", () => {
						set.delete(ws);
					});
				} catch {
					// ignore malformed ws messages
				}
			});
		});
	}

	write(chunk: StreamChunk): void {
		const stream = this.stored.get(chunk.stream_ref) ?? [];
		stream.push(chunk);
		this.stored.set(chunk.stream_ref, stream);

		const payload = JSON.stringify(chunk);
		for (const ws of this.wsSubscribers.get(chunk.stream_ref) ?? []) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(payload);
				if (chunk.is_final) ws.close(1000);
			}
		}
		if (chunk.is_final) {
			this.wsSubscribers.delete(chunk.stream_ref);
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
}
