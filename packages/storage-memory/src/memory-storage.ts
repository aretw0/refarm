import {
    type StorageProvider,
    type StorageQuery,
    type StorageRecord,
    STORAGE_CAPABILITY
} from "@refarm.dev/storage-contract-v1";

export class MemoryStorage implements StorageProvider {
  readonly pluginId = "storage-memory";
  readonly capability = STORAGE_CAPABILITY;

  private memory = new Map<string, StorageRecord>();

  async get(id: string): Promise<StorageRecord | null> {
    return this.memory.get(id) || null;
  }

  async put(record: StorageRecord): Promise<void> {
    this.memory.set(record.id, {
      ...record,
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(id: string): Promise<void> {
    this.memory.delete(id);
  }

  async query(query: StorageQuery): Promise<StorageRecord[]> {
    let results = Array.from(this.memory.values());
    if (query.type) {
      results = results.filter(r => r.type === query.type);
    }
    return results.slice(query.offset || 0, (query.offset || 0) + (query.limit || 10));
  }
}
