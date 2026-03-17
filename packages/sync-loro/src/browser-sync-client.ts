import type { LoroCRDTStorage } from "./loro-crdt-storage.js";

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

  constructor(
    private readonly storage: LoroCRDTStorage,
    private readonly wsUrl = "ws://localhost:42000",
  ) {}

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
      this.ws = new WebSocket(this.wsUrl);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = (): void => {
        // Push local state to farmhand on connect
        void this.storage.getUpdate().then((bytes) => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(bytes);
          }
        });

        // Subscribe to local CRDT changes and forward to farmhand
        this.unsubscribe = this.storage.onUpdate((bytes) => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(bytes);
          }
        });
      };

      this.ws.onmessage = (event: MessageEvent): void => {
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        void this.storage.applyUpdate(bytes);
      };

      this.ws.onclose = (): void => {
        this.unsubscribe?.();
        this.unsubscribe = null;
        // Silent reconnect after 5 seconds (farmhand may restart)
        this.reconnectTimer = setTimeout(() => this._connect(), 5_000);
      };

      this.ws.onerror = (): void => {
        // Farmhand not running — suppress error, onclose will handle reconnect
      };
    } catch {
      // WebSocket constructor can throw in some environments
      // Remain in local-only mode
    }
  }
}
