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
  onEvent?: (event: BrowserSyncClientEvent) => void;
  webSocketConstructor?: typeof WebSocket;
}

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
  private readonly onEvent: (event: BrowserSyncClientEvent) => void;
  private readonly WebSocketCtor: typeof WebSocket;

  constructor(
    private readonly storage: LoroCRDTStorage,
    options: string | BrowserSyncClientOptions = {},
  ) {
    this.wsUrl = typeof options === "string"
      ? options
      : options.wsUrl ?? "ws://localhost:42000";
    this.onEvent = typeof options === "string" ? () => {} : options.onEvent ?? (() => {});
    this.WebSocketCtor =
      typeof options === "string"
        ? WebSocket
        : options.webSocketConstructor ?? WebSocket;
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
      this.ws = new this.WebSocketCtor(this.wsUrl);
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
