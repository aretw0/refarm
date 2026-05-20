import type { SyncChange, SyncProvider, SyncSession } from "./types.js";
import { SYNC_CAPABILITY } from "./types.js";

export function createInMemorySyncProvider(): SyncProvider {
  const changes: SyncChange[] = [];
  let sessionCounter = 0;

  return {
    pluginId: "@refarm.dev/sync-memory-test",
    capability: SYNC_CAPABILITY,

    async connect(_endpoint: string): Promise<SyncSession> {
      return {
        sessionId: `session-${++sessionCounter}`,
        peerId: "test-peer",
        startedAt: new Date().toISOString(),
      };
    },

    async push(incoming: SyncChange[]): Promise<void> {
      changes.push(...incoming);
    },

    async pull(): Promise<SyncChange[]> {
      return [...changes];
    },

    async disconnect(_sessionId: string): Promise<void> {},
  };
}
