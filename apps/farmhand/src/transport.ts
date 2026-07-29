import { assertBindAllowed, DEFAULT_BIND_HOST } from "@refarm.dev/std";
import { authPolicyPresent } from "@refarm.dev/std/node";
import { WebSocketServer, WebSocket } from "ws";

/**
 * WebSocketSyncTransport
 *
 * Pure binary relay transport for Loro CRDT updates.
 * Sends and receives Uint8Array frames — no JSON serialization.
 *
 * When a peer sends a binary CRDT update:
 *   1. The update is broadcast to all OTHER connected peers (relay mode).
 *   2. The local message handler is notified (applies to local LoroCRDTStorage).
 *
 * Architecture: ADR-045 — Loro binary delta over WebSocket.
 * Replaces the JSON CRDTOperation transport from @refarm.dev/sync-crdt (stub).
 *
 * BIND SAFETY: `new WebSocketServer({ port })` binds EVERY interface — that is the `ws`
 * default, and it is what this did, on port 42000, for an UNAUTHENTICATED CRDT relay. Any
 * peer that could route here could read the whole document and write into it. The Rust
 * daemon closed exactly this port on exactly this reasoning; this is the same close for the
 * Node relay. The bind is loopback by default and a wider one is refused unless an auth
 * policy is configured — the shared guard in `@refarm.dev/std`, one rule for both runtimes.
 */
export class WebSocketSyncTransport {
	private readonly wss: WebSocketServer;
	private readonly clients = new Set<WebSocket>();
	private _msgHandler: ((bytes: Uint8Array) => void) | null = null;
	/** The host actually bound — so callers log the truth instead of guessing "localhost". */
	readonly host: string;

	constructor(port: number, host: string = DEFAULT_BIND_HOST) {
		// Throws before the socket exists when the bind is not allowed. A relay with no
		// credential check must not be reachable from off-box just because nobody passed a
		// host.
		this.host = assertBindAllowed(
			host,
			authPolicyPresent(),
			"the farmhand CRDT sync relay",
		).host;
		this.wss = new WebSocketServer({ port, host: this.host });

		this.wss.on("connection", (ws: WebSocket) => {
			this.clients.add(ws);

			ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
				const bytes = toUint8Array(data);
				// Relay to all other peers
				this.broadcast(bytes, ws);
				// Notify local CRDT storage
				this._msgHandler?.(bytes);
			});

			ws.on("close", () => {
				this.clients.delete(ws);
			});

			ws.on("error", (err: Error) => {
				console.error("[farmhand] WebSocket error:", err);
				this.clients.delete(ws);
			});
		});
	}

	/**
	 * Broadcast binary bytes to all connected peers.
	 * @param except - Optionally skip one client (the sender).
	 */
	broadcast(bytes: Uint8Array, except?: WebSocket): void {
		for (const client of this.clients) {
			if (client !== except && client.readyState === WebSocket.OPEN) {
				client.send(bytes);
			}
		}
	}

	/**
	 * Register a handler for incoming binary messages from remote peers.
	 * Wire this to LoroCRDTStorage.applyUpdate.
	 */
	onMessage(handler: (bytes: Uint8Array) => void): void {
		this._msgHandler = handler;
	}

	async disconnect(): Promise<void> {
		for (const client of this.clients) {
			client.close();
		}
		await new Promise<void>((resolve) => this.wss.close(() => resolve()));
	}

	get port(): number {
		const addr = this.wss.address();
		return typeof addr === "object" && addr !== null ? (addr as { port: number }).port : 0;
	}
}

function toUint8Array(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
	if (Array.isArray(data)) {
		return Buffer.concat(data);
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	// Node.js Buffer
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
