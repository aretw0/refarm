import type { StorageProvider, StorageQuery, StorageRecord } from "./types.js";
import { STORAGE_CAPABILITY } from "./types.js";

export function createInMemoryStorageProvider(): StorageProvider {
  const rows = new Map<string, StorageRecord>();

  return {
    pluginId: "@refarm.dev/storage-memory-test",
    capability: STORAGE_CAPABILITY,

    async get(id: string): Promise<StorageRecord | null> {
      return rows.get(id) ?? null;
    },

    async put(record: StorageRecord): Promise<void> {
      rows.set(record.id, record);
    },

    async putMany(records: StorageRecord[]): Promise<void> {
      for (const r of records) rows.set(r.id, r);
    },

    async delete(id: string): Promise<void> {
      rows.delete(id);
    },

    async deleteMany(ids: string[]): Promise<void> {
      for (const id of ids) rows.delete(id);
    },

    async query(query: StorageQuery): Promise<StorageRecord[]> {
      let values = [...rows.values()];
      if (query.type) values = values.filter((r) => r.type === query.type);
      const offset = query.offset ?? 0;
      const limit = query.limit ?? values.length;
      return values.slice(offset, offset + limit);
    },
  };
}
