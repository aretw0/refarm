import type { LoroCRDTStorage } from "./loro-crdt-storage.js";

export type BrowserSyncClientEvent =
  | { type: "connecting"; wsUrl: string }
  | { type: "open"; wsUrl: string }
  | { type: "local-state-sent"; byteLength: number; wsUrl: string }
  | { type: "local-update-sent"; byteLength: number; wsUrl: string }
  | { type: "remote-update-received"; byteLength: number; wsUrl: string }
  | { type: "remote-update-applied"; byteLength: number; wsUrl: string }
  | { type: "closed"; reconnectInMs: number; wsUrl: string }
  | { type: "error"; wsUrl: string }
  | { type: "connect-failed"; wsUrl: string };

export interface BrowserSyncClientOptions {
  wsUrl?: string;
  onEvent?: (event: BrowserSyncClientEvent) => void;
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

  constructor(
    private readonly storage: LoroCRDTStorage,
    options: string | BrowserSyncClientOptions = {},
  ) {
    this.wsUrl = typeof options === "string"
      ? options
      : options.wsUrl ?? "ws://localhost:42000";
    this.onEvent = typeof options === "string" ? () => {} : options.onEvent ?? (() => {});
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
      this.ws = new WebSocket(this.wsUrl);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = (): void => {
        this.onEvent({ type: "open", wsUrl: this.wsUrl });
        // Push local state to farmhand on connect
        void this.storage.getUpdate().then((bytes) => {
          if (this.ws?.readyState === WebSocket.OPEN) {
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
          if (this.ws?.readyState === WebSocket.OPEN) {
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
        void this.storage.applyUpdate(bytes).then(() => {
          this.onEvent({
            type: "remote-update-applied",
            byteLength: bytes.byteLength,
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

      this.ws.onerror = (): void => {
        // Farmhand not running — suppress error, onclose will handle reconnect
        this.onEvent({ type: "error", wsUrl: this.wsUrl });
      };
    } catch {
      // WebSocket constructor can throw in some environments
      // Remain in local-only mode
      this.onEvent({ type: "connect-failed", wsUrl: this.wsUrl });
    }
  }
}
