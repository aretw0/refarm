import { describe, expect, it } from "vitest";

import { mergeClocks, SyncEngine, tickClock, type CRDTOperation, type SyncTransport } from "../src/index";

class InMemoryTransport implements SyncTransport {
  private receiver: ((op: CRDTOperation) => void) | null = null;
  public sent: CRDTOperation[] = [];

  async send(op: CRDTOperation): Promise<void> {
    this.sent.push(op);
  }

  onReceive(handler: (op: CRDTOperation) => void): void {
    this.receiver = handler;
  }

  async disconnect(): Promise<void> {
    return;
  }

  receive(op: CRDTOperation): void {
    if (this.receiver) this.receiver(op);
  }
}

describe("@refarm/sync-crdt smoke", () => {
  it("merges and increments vector clocks deterministically", () => {
    expect(mergeClocks({ a: 1 }, { a: 2, b: 1 })).toEqual({ a: 2, b: 1 });
    expect(tickClock({ peer: 3 }, "peer")).toEqual({ peer: 4 });
  });

  it("dispatches local operations and consumes remote ones", async () => {
    const engine = new SyncEngine("local");
    const transport = new InMemoryTransport();
    const observed: CRDTOperation[] = [];

    engine.addTransport(transport);
    engine.onOperation((op) => observed.push(op));

    await engine.dispatch({ type: "set", key: "name", value: "alice" });
    expect(transport.sent).toHaveLength(1);
    expect(observed).toHaveLength(1);

    transport.receive({
      id: "remote/1",
      peerId: "remote",
      clock: { remote: 1 },
      timestamp: Date.now(),
      op: { type: "set", key: "status", value: "ok" },
    });

    expect(observed).toHaveLength(2);
    expect(observed[1].peerId).toBe("remote");
  });
});
