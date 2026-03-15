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
            t: vi.fn((key) => key), // identity fallback for tests
        },
        plugins: {
            getAllPlugins: vi.fn(() => []),
        }
    };
}
export class MockStorageAdapter {
    nodes = [];
    async ensureSchema() { }
    async storeNode(id, type, context, payload, sourcePlugin) {
        const data = typeof payload === "string" ? payload : JSON.stringify(payload);
        this.nodes.push({ id, type, context, payload: data });
    }
    queryNodes = vi.fn().mockImplementation(async (query) => {
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
                    }
                    catch {
                        return false;
                    }
                });
            }
        }
        return [];
    });
    execute = vi.fn().mockResolvedValue(null);
    query = vi.fn().mockImplementation(async (sql) => {
        // A fallback mock for direct SQL queries mapping to our nodes via URL path
        if (sql.includes("SELECT * WHERE url =")) {
            const match = sql.match(/url = '([^']+)'/);
            if (match)
                return this.nodes.filter(n => n.url === match[1]);
        }
        return [];
    });
    async transaction(fn) { return fn(); }
    async close() { }
}
export class MockIdentityAdapter {
    publicKey = "did:mock:123";
    async sign(data) {
        return {
            signature: "delegated",
            algorithm: "external"
        };
    }
}
//# sourceMappingURL=test-utils.js.map