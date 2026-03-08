import { vi } from "vitest";

/**
 * Creates a reusable mock of the Tractor engine for testing plugins and adapters.
 */
export function createTractorMock() {
  return {
    observe: vi.fn(),
    emitTelemetry: vi.fn(),
    emit: vi.fn(),
    setPluginState: vi.fn(),
    queryNodes: vi.fn().mockResolvedValue([]),
    l8n: {
      t: vi.fn((key: string) => key), // identity fallback for tests
    },
    plugins: {
      getAllPlugins: vi.fn(() => []),
    }
  };
}

import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";

export class MockStorageAdapter implements StorageAdapter {
  private nodes: any[] = [];
  
  async ensureSchema(): Promise<void> {}
  
  async storeNode(
    id: string,
    type: string,
    context: string,
    payload: any,
    sourcePlugin: string | null,
  ): Promise<void> {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.nodes.push({ id, type, context, payload: data });
  }
  
  queryNodes = vi.fn().mockImplementation(async (query: string) => {
    // If it's a type query (like "WebPage")
    if (!query.includes("SELECT")) {
      return this.nodes.filter(n => n.type === query);
    }
    // If it's the Antenna's URL SQL query
    if (query.includes("WHERE url =")) {
      const match = query.match(/url = '([^']+)'/);
      if (match) {
        return this.nodes.filter(n => {
          try {
            const parsed = JSON.parse(n.payload);
            return parsed.url === match[1];
          } catch { return false; }
        });
      }
    }
    return [];
  });
  
  execute = vi.fn().mockResolvedValue(null);
  query = vi.fn().mockImplementation(async (sql: string) => {
    // A fallback mock for direct SQL queries mapping to our nodes via URL path
    if (sql.includes("SELECT * WHERE url =")) {
      const match = sql.match(/url = '([^']+)'/);
      if (match) return this.nodes.filter(n => n.url === match[1]);
    }
    return [];
  });
  
  async transaction<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
  async close(): Promise<void> {}
}

export class MockIdentityAdapter implements IdentityAdapter {
  publicKey?: string = "did:mock:123";
}
