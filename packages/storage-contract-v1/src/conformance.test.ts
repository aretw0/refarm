import { describe, expect, it } from "vitest";

import {
  STORAGE_CAPABILITY,
  runStorageV1Conformance,
  type StorageProvider,
  type StorageQuery,
  type StorageRecord,
} from "./index.js";

class InMemoryStorageProvider implements StorageProvider {
  readonly pluginId = "@refarm.dev/storage-memory-test";
  readonly capability = STORAGE_CAPABILITY;

  private readonly rows = new Map<string, StorageRecord>();

  async get(id: string): Promise<StorageRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async put(record: StorageRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async query(query: StorageQuery): Promise<StorageRecord[]> {
    let values = [...this.rows.values()];
    if (query.type) {
      values = values.filter((row) => row.type === query.type);
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? values.length;
    return values.slice(offset, offset + limit);
  }
}

describe("storage:v1 conformance", () => {
  it("passes for a compatible provider", async () => {
    const provider = new InMemoryStorageProvider();
    const result = await runStorageV1Conformance(provider);

    expect(result.pass).toBe(true);
    expect(result.failed).toBe(0);
  });

  it("reports actionable failures for an incompatible provider", async () => {
    const provider: StorageProvider = {
      pluginId: "broken-storage",
      capability: "storage:v0" as typeof STORAGE_CAPABILITY,
      get: async () => null,
      put: async () => {
        throw new Error("backend unavailable");
      },
      delete: async () => {},
      query: async () => [],
    };

    const result = await runStorageV1Conformance(provider);

    expect(result.pass).toBe(false);
    expect(result.failures).toContain("provider.capability must be 'storage:v1'");
    expect(result.failures.some((failure) => failure.includes("put() threw"))).toBe(true);
  });
});
