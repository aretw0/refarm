/**
 * Creates a reusable mock of the Tractor engine for testing plugins and adapters.
 */
export declare function createTractorMock(): {
    observe: import("vitest").Mock<import("@vitest/spy").Procedure>;
    emitTelemetry: import("vitest").Mock<import("@vitest/spy").Procedure>;
    emit: import("vitest").Mock<import("@vitest/spy").Procedure>;
    setPluginState: import("vitest").Mock<import("@vitest/spy").Procedure>;
    queryNodes: import("vitest").Mock<import("@vitest/spy").Procedure>;
    l8n: {
        t: import("vitest").Mock<(key: string) => string>;
    };
    plugins: {
        getAllPlugins: import("vitest").Mock<() => never[]>;
    };
};
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
export declare class MockStorageAdapter implements StorageAdapter {
    private nodes;
    ensureSchema(): Promise<void>;
    storeNode(id: string, type: string, context: string, payload: any, sourcePlugin: string | null): Promise<void>;
    queryNodes: import("vitest").Mock<import("@vitest/spy").Procedure>;
    execute: import("vitest").Mock<import("@vitest/spy").Procedure>;
    query: import("vitest").Mock<import("@vitest/spy").Procedure>;
    transaction<T>(fn: () => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
export declare class MockIdentityAdapter implements IdentityAdapter {
    publicKey?: string;
    sign(data: string): Promise<{
        signature: string;
        algorithm: string;
    }>;
}
//# sourceMappingURL=test-utils.d.ts.map