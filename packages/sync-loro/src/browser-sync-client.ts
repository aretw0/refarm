import type { LoroCRDTStorage } from "./loro-crdt-storage.js";

export type BrowserSyncClientEvent =
	| { type: "connecting"; wsUrl: string }
	| { type: "open"; wsUrl: string }
	| { type: "local-state-sent"; byteLength: number; wsUrl: string }
	| { type: "local-update-sent"; byteLength: number; wsUrl: string }
	| { type: "remote-update-received"; byteLength: number; wsUrl: string }
	| { type: "remote-update-applied"; byteLength: number; wsUrl: string }
	| {
			type: "remote-update-failed";
			byteLength: number;
			error: string;
			wsUrl: string;
	  }
	| { type: "closed"; reconnectInMs: number; wsUrl: string }
	| { type: "error"; error: string; wsUrl: string }
	| { type: "connect-failed"; wsUrl: string };

export interface BrowserSyncClientOptions {
	wsUrl?: string;
	/**
	 * The per-device bearer credential (from `refarm auth enroll`), if the daemon's WS is
	 * gated (ADR-093). Absent ⇒ no `Sec-WebSocket-Protocol` is offered at all — behavior
	 * is unchanged from before ADR-093. Present ⇒ offered alongside `WS_SYNC_PROTOCOL`; see
	 * that constant's doc for the full convention.
	 */
	token?: string;
	onEvent?: (event: BrowserSyncClientEvent) => void;
	webSocketConstructor?: typeof WebSocket;
}

/**
 * ADR-093's WS credential handshake convention
 * (`specs/ADRs/ADR-093-device-auth-gate-and-browser-websocket-credential-channel.md`): a
 * browser cannot set an `Authorization` header on a WebSocket, so when a token is present
 * this client offers TWO `Sec-WebSocket-Protocol` entries via the `WebSocket` constructor's
 * second argument (works identically in the browser and in Node's `ws` package):
 *   - `WS_SYNC_PROTOCOL` — the protocol name.
 *   - `bearer.<token>`   — the bearer credential, verbatim.
 *
 * The server (`daemon::WsServer`) authenticates the `bearer.<token>` half against
 * `REFARM_AUTH_POLICY` and echoes back ONLY `WS_SYNC_PROTOCOL` in its handshake response —
 * the token half is never reflected. Absent token ⇒ no protocols are offered at all, and
 * behavior is byte-identical to before ADR-093 (no policy configured ⇒ the daemon accepts
 * regardless of what, if anything, is offered).
 */
export const WS_SYNC_PROTOCOL = "refarm-sync-v1";
const WS_TOKEN_PROTOCOL_PREFIX = "bearer.";

/**
 * BrowserSyncClient — connects the browser's LoroCRDTStorage to a Farmhand daemon
 * over a WebSocket at ws://localhost:42000.
 *
 * On connect: sends the local state to the daemon (full update).
 * On receive: applies the incoming binary update to LoroCRDTStorage.
 * On local change: forwards binary delta to the daemon.
 *
 * Gracefully no-ops if the daemon is not running — the browser stays in local-only mode.
 */
export class BrowserSyncClient {
	private ws: WebSocket | null = null;
	private unsubscribe: (() => void) | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly wsUrl: string;
	private readonly token: string | undefined;
	private readonly onEvent: (event: BrowserSyncClientEvent) => void;
	private readonly WebSocketCtor: typeof WebSocket;

	constructor(
		private readonly storage: LoroCRDTStorage,
		options: string | BrowserSyncClientOptions = {},
	) {
		this.wsUrl = typeof options === "string" ? options : (options.wsUrl ?? "ws://localhost:42000");
		this.token = typeof options === "string" ? undefined : options.token;
		this.onEvent = typeof options === "string" ? () => {} : (options.onEvent ?? (() => {}));
		this.WebSocketCtor =
			typeof options === "string" ? WebSocket : (options.webSocketConstructor ?? WebSocket);
	}

	connect(): void {
		this._connect();
	}

	disconnect(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.ws?.close();
		this.ws = null;
	}

	private _connect(): void {
		try {
			this.onEvent({ type: "connecting", wsUrl: this.wsUrl });
			// Absent token ⇒ omit the second argument entirely (not `undefined` explicitly,
			// though both behave the same in the DOM/`ws` constructors) — keeps the no-token
			// path byte-identical to before ADR-093.
			this.ws = this.token
				? new this.WebSocketCtor(this.wsUrl, [WS_SYNC_PROTOCOL, `${WS_TOKEN_PROTOCOL_PREFIX}${this.token}`])
				: new this.WebSocketCtor(this.wsUrl);
			this.ws.binaryType = "arraybuffer";

			this.ws.onopen = (): void => {
				this.onEvent({ type: "open", wsUrl: this.wsUrl });
				// Push local state to farmhand on connect
				void this.storage.getUpdate().then((bytes) => {
					if (this.ws?.readyState === this.WebSocketCtor.OPEN) {
						// TS6 DOM typings require ArrayBuffer-backed BufferSource.
						this.ws.send(new Uint8Array(bytes));
						this.onEvent({
							type: "local-state-sent",
							byteLength: bytes.byteLength,
							wsUrl: this.wsUrl,
						});
					}
				});

				// Subscribe to local CRDT changes and forward to farmhand
				this.unsubscribe = this.storage.onUpdate((bytes) => {
					if (this.ws?.readyState === this.WebSocketCtor.OPEN) {
						// Normalize potential SharedArrayBuffer-backed views for WebSocket.send.
						this.ws.send(new Uint8Array(bytes));
						this.onEvent({
							type: "local-update-sent",
							byteLength: bytes.byteLength,
							wsUrl: this.wsUrl,
						});
					}
				});
			};

			this.ws.onmessage = (event: MessageEvent): void => {
				const bytes = new Uint8Array(event.data as ArrayBuffer);
				this.onEvent({
					type: "remote-update-received",
					byteLength: bytes.byteLength,
					wsUrl: this.wsUrl,
				});
				void this.storage
					.applyUpdate(bytes)
					.then(() => {
						this.onEvent({
							type: "remote-update-applied",
							byteLength: bytes.byteLength,
							wsUrl: this.wsUrl,
						});
					})
					.catch((error: unknown) => {
						this.onEvent({
							type: "remote-update-failed",
							byteLength: bytes.byteLength,
							error: browserSyncErrorMessage(error),
							wsUrl: this.wsUrl,
						});
					});
			};

			this.ws.onclose = (): void => {
				this.unsubscribe?.();
				this.unsubscribe = null;
				// Silent reconnect after 5 seconds (farmhand may restart)
				const reconnectInMs = 5_000;
				this.onEvent({
					type: "closed",
					reconnectInMs,
					wsUrl: this.wsUrl,
				});
				this.reconnectTimer = setTimeout(() => this._connect(), reconnectInMs);
			};

			this.ws.onerror = (event: Event): void => {
				// Farmhand not running — suppress error, onclose will handle reconnect
				this.onEvent({
					type: "error",
					error: browserSyncEventErrorMessage(event),
					wsUrl: this.wsUrl,
				});
			};
		} catch {
			// WebSocket constructor can throw in some environments
			// Remain in local-only mode
			this.onEvent({ type: "connect-failed", wsUrl: this.wsUrl });
		}
	}
}

function browserSyncErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" && error.length > 0 ? error : "unknown error";
}

function browserSyncEventErrorMessage(event: Event): string {
	const candidate = event as Event & { error?: unknown; message?: unknown };
	if (candidate.error) return browserSyncErrorMessage(candidate.error);
	if (typeof candidate.message === "string" && candidate.message.length > 0) {
		return candidate.message;
	}
	return "unknown error";
}
