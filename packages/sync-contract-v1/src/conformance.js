import { SYNC_CAPABILITY, } from "./types.js";
export async function runSyncV1Conformance(provider) {
    const failures = [];
    if (provider.capability !== SYNC_CAPABILITY) {
        failures.push("provider.capability must be 'sync:v1'");
    }
    if (!provider.pluginId || provider.pluginId.trim().length === 0) {
        failures.push("provider.pluginId must be a non-empty string");
    }
    const testEndpoint = "memory://test-sync";
    let sessionId = null;
    try {
        const session = await provider.connect(testEndpoint);
        sessionId = session.sessionId;
        if (!sessionId) {
            failures.push("connect() must return a session with sessionId");
        }
    }
    catch (error) {
        failures.push(`connect() threw: ${String(error)}`);
    }
    if (sessionId) {
        const sampleChange = {
            id: `change-${Date.now()}`,
            timestamp: new Date().toISOString(),
            author: "conformance-test",
            operation: "put",
            resourceId: "test-resource",
            data: { hello: "sync" },
        };
        try {
            await provider.push([sampleChange]);
        }
        catch (error) {
            failures.push(`push() threw: ${String(error)}`);
        }
        try {
            const changes = await provider.pull();
            if (!Array.isArray(changes)) {
                failures.push("pull() must return an array");
            }
        }
        catch (error) {
            failures.push(`pull() threw: ${String(error)}`);
        }
        try {
            await provider.disconnect(sessionId);
        }
        catch (error) {
            failures.push(`disconnect() threw: ${String(error)}`);
        }
    }
    const failed = failures.length;
    return {
        pass: failed === 0,
        total: 6,
        failed,
        failures,
    };
}
//# sourceMappingURL=conformance.js.map