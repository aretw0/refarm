import { describe, it, expect, beforeEach } from "vitest";
import { LoroCRDTStorage } from "./loro-crdt-storage.js";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";

// Loro requires uint64-compatible peer IDs
const PEER_1 = 1n;
const PEER_2 = 2n;
const PEER_3 = 3n;

// Minimal in-memory StorageAdapter for testing
function createTestReadModel(): StorageAdapter {
  const store = new Map<string, { id: string; type: string; context: string; payload: string; sourcePlugin: string | null; updatedAt: string }>();
  return {
    async ensureSchema() {},
    async storeNode(id, type, context, payload, sourcePlugin) {
      store.set(id, { id, type, context, payload, sourcePlugin, updatedAt: new Date().toISOString() });
    },
    async queryNodes(type) {
      return Array.from(store.values()).filter(r => r.type === type);
    },
    async execute(_sql, _args?) { return []; },
    async query<T>(_sql: string, _args?: unknown): Promise<T[]> { return []; },
    async transaction<T>(fn: () => Promise<T>) { return fn(); },
    async close() {},
  };
}

describe("LoroCRDTStorage", () => {
  let peer1: LoroCRDTStorage;
  let peer2: LoroCRDTStorage;

  beforeEach(() => {
    peer1 = new LoroCRDTStorage(createTestReadModel(), PEER_1);
    peer2 = new LoroCRDTStorage(createTestReadModel(), PEER_2);
  });

  it("projects a stored node to the read model", async () => {
    await peer1.storeNode(
      "urn:presence:1",
      "FarmhandPresence",
      "https://schema.refarm.dev/",
      JSON.stringify({ status: "online" }),
      "farmhand",
    );

    const nodes = await peer1.queryNodes("FarmhandPresence");
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as { type: string }).type).toBe("FarmhandPresence");
  });

  it("syncs bidirectionally between two peers", async () => {
    // Wire peer1 → peer2 and peer2 → peer1
    peer1.onUpdate((bytes) => void peer2.applyUpdate(bytes));
    peer2.onUpdate((bytes) => void peer1.applyUpdate(bytes));

    await peer1.storeNode(
      "urn:presence:laptop",
      "FarmhandPresence",
      "https://schema.refarm.dev/",
      JSON.stringify({ status: "online" }),
      "farmhand",
    );

    // Give the projector time to run (it's async via subscribe)
    await new Promise((resolve) => setTimeout(resolve, 10));

    const nodesOnPeer2 = await peer2.queryNodes("FarmhandPresence");
    expect(nodesOnPeer2).toHaveLength(1);
    expect((nodesOnPeer2[0] as { id: string }).id).toBe("urn:presence:laptop");
  });

  it("merges concurrent edits from two offline peers", async () => {
    // Both peers create different nodes while offline (no sync wired yet)
    await peer1.storeNode(
      "urn:task:alpha",
      "FarmhandTask",
      "",
      JSON.stringify({ status: "pending" }),
      "farmhand",
    );
    await peer2.storeNode(
      "urn:task:beta",
      "FarmhandTask",
      "",
      JSON.stringify({ status: "pending" }),
      "farmhand",
    );

    // Simulate reconnect: exchange full states
    const bytes1 = await peer1.getUpdate();
    const bytes2 = await peer2.getUpdate();
    await peer1.applyUpdate(bytes2);
    await peer2.applyUpdate(bytes1);

    // Give projectors time to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Both peers should now see both tasks
    const tasks1 = await peer1.queryNodes("FarmhandTask");
    const tasks2 = await peer2.queryNodes("FarmhandTask");
    expect(tasks1).toHaveLength(2);
    expect(tasks2).toHaveLength(2);
  });

  it("exports and imports a snapshot", async () => {
    await peer1.storeNode(
      "urn:node:snap",
      "FarmhandPresence",
      "",
      JSON.stringify({ status: "online" }),
      "farmhand",
    );

    const snapshot = peer1.exportSnapshot();
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.length).toBeGreaterThan(0);

    // Import into fresh peer
    const peer3 = new LoroCRDTStorage(createTestReadModel(), PEER_3);
    peer3.importSnapshot(snapshot);
    await peer3.rebuildReadModel();

    const nodes = await peer3.queryNodes("FarmhandPresence");
    expect(nodes).toHaveLength(1);
  });

  it("getUpdate returns non-empty Uint8Array after a write", async () => {
    await peer1.storeNode("urn:x", "Test", "", "{}", null);
    const update = await peer1.getUpdate();
    expect(update).toBeInstanceOf(Uint8Array);
    expect(update.length).toBeGreaterThan(0);
  });

  it("start/stop lifecycle does not throw", async () => {
    await expect(peer1.start()).resolves.toBeUndefined();
    await expect(peer1.stop()).resolves.toBeUndefined();
  });
});
