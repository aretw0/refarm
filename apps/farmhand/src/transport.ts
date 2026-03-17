import { WebSocketServer, WebSocket } from "ws";
import type { CRDTOperation, SyncTransport } from "@refarm.dev/sync-crdt";

/**
 * WebSocketSyncTransport
 *
 * Implements SyncTransport over WebSocket connections.
 * Acts as a server hub: when a CRDT operation arrives from one client,
 * it's broadcast to all other connected clients.
 */
export class WebSocketSyncTransport implements SyncTransport {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private _receiveHandler: ((op: CRDTOperation) => void) | null = null;

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const op: CRDTOperation = JSON.parse(data.toString());
          if (this._receiveHandler) {
            this._receiveHandler(op);
          }
        } catch (e) {
          console.warn("[farmhand] Invalid CRDT message:", e);
        }
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

  async send(op: CRDTOperation): Promise<void> {
    const payload = JSON.stringify(op);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  onReceive(handler: (op: CRDTOperation) => void): void {
    this._receiveHandler = handler;
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
