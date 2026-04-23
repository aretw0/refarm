import { describe, expect, it } from "vitest";

import {
	runSyncV1Conformance,
	SYNC_CAPABILITY,
	type SyncChange,
	type SyncProvider,
	type SyncSession,
} from "./index.js";

class InMemorySyncProvider implements SyncProvider {
	readonly pluginId = "@refarm.dev/sync-memory-test";
	readonly capability = SYNC_CAPABILITY;

	private readonly changes: SyncChange[] = [];
	private sessionCounter = 0;

	async connect(_endpoint: string): Promise<SyncSession> {
		return {
			sessionId: `session-${++this.sessionCounter}`,
			peerId: "test-peer",
			startedAt: new Date().toISOString(),
		};
	}

	async push(changes: SyncChange[]): Promise<void> {
		this.changes.push(...changes);
	}

	async pull(): Promise<SyncChange[]> {
		return [...this.changes];
	}

	async disconnect(_sessionId: string): Promise<void> {
		// no-op
	}
}

describe("sync:v1 conformance", () => {
	it("passes for a compatible provider", async () => {
		const provider = new InMemorySyncProvider();
		const result = await runSyncV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("reports failure when provider capability is invalid", async () => {
		const provider = new InMemorySyncProvider() as SyncProvider & {
			capability: string;
		};
		provider.capability = "sync:v0";

		const result = await runSyncV1Conformance(provider as SyncProvider);

		expect(result.pass).toBe(false);
		expect(result.failures).toContain("provider.capability must be 'sync:v1'");
	});
});
