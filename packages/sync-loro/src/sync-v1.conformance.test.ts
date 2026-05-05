import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import {
	runSyncV1Conformance,
	SYNC_CAPABILITY,
	type SyncChange,
	type SyncProvider,
	type SyncSession,
} from "@refarm.dev/sync-contract-v1";
import { afterEach, describe, expect, it } from "vitest";

import { LoroCRDTStorage } from "./loro-crdt-storage.js";

type ReadModelNode = {
	id: string;
	type: string;
	context: string;
	payload: string;
	sourcePlugin: string | null;
	updatedAt: string;
};

function createTestReadModel(): StorageAdapter {
	const store = new Map<string, ReadModelNode>();

	return {
		async ensureSchema() {},
		async storeNode(id, type, context, payload, sourcePlugin) {
			store.set(id, {
				id,
				type,
				context,
				payload,
				sourcePlugin,
				updatedAt: new Date().toISOString(),
			});
		},
		async queryNodes(type) {
			return Array.from(store.values()).filter((row) => row.type === type);
		},
		async execute(_sql, _args) {
			return [];
		},
		async query<T>(_sql: string, _args?: unknown): Promise<T[]> {
			return [];
		},
		async transaction<T>(fn: () => Promise<T>) {
			return fn();
		},
		async close() {},
	};
}

class InMemorySyncHub {
	private readonly endpoints = new Map<string, Map<string, LoroSyncProvider>>();

	register(
		endpoint: string,
		sessionId: string,
		provider: LoroSyncProvider,
	): void {
		if (!this.endpoints.has(endpoint)) {
			this.endpoints.set(endpoint, new Map());
		}
		this.endpoints.get(endpoint)?.set(sessionId, provider);
	}

	unregister(endpoint: string, sessionId: string): void {
		const peers = this.endpoints.get(endpoint);
		if (!peers) return;

		peers.delete(sessionId);
		if (peers.size === 0) {
			this.endpoints.delete(endpoint);
		}
	}

	broadcast(endpoint: string, fromSessionId: string, update: Uint8Array): void {
		const peers = this.endpoints.get(endpoint);
		if (!peers) return;

		for (const [sessionId, provider] of peers.entries()) {
			if (sessionId === fromSessionId) continue;
			void provider.receiveRemoteUpdate(update);
		}
	}

	reset(): void {
		this.endpoints.clear();
	}
}

class LoroSyncProvider implements SyncProvider {
	readonly pluginId: string;
	readonly capability = SYNC_CAPABILITY;

	private static readonly hub = new InMemorySyncHub();
	private static providerCounter = 0;
	private static sessionCounter = 0;

	private readonly storage: LoroCRDTStorage;
	private readonly peerId: string;

	private endpoint: string | null = null;
	private sessionId: string | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(seed = 10_000n) {
		const instance = BigInt(++LoroSyncProvider.providerCounter);
		this.peerId = String(seed + instance);
		this.pluginId = `@refarm.dev/sync-loro-conformance-${this.peerId}`;
		this.storage = new LoroCRDTStorage(createTestReadModel(), seed + instance);
	}

	static resetForTests(): void {
		LoroSyncProvider.hub.reset();
		LoroSyncProvider.providerCounter = 0;
		LoroSyncProvider.sessionCounter = 0;
	}

	async connect(endpoint: string): Promise<SyncSession> {
		const sessionId = `session-${++LoroSyncProvider.sessionCounter}`;

		this.endpoint = endpoint;
		this.sessionId = sessionId;

		this.unsubscribe = this.storage.onUpdate((update) => {
			if (!this.endpoint || !this.sessionId) return;
			LoroSyncProvider.hub.broadcast(
				this.endpoint,
				this.sessionId,
				new Uint8Array(update),
			);
		});

		LoroSyncProvider.hub.register(endpoint, sessionId, this);

		return {
			sessionId,
			peerId: this.peerId,
			startedAt: new Date().toISOString(),
		};
	}

	async push(changes: SyncChange[]): Promise<void> {
		if (!this.endpoint || !this.sessionId) {
			throw new Error("provider not connected");
		}

		for (const change of changes) {
			await this.storage.storeNode(
				change.id,
				"conformance:sync-change",
				"sync:v1",
				JSON.stringify(change),
				this.pluginId,
			);
		}
	}

	async pull(): Promise<SyncChange[]> {
		const rows = await this.storage.queryNodes("conformance:sync-change");

		return rows
			.map((row) => {
				if (
					typeof row === "object" &&
					row !== null &&
					"payload" in row &&
					typeof (row as { payload?: unknown }).payload === "string"
				) {
					return JSON.parse((row as { payload: string }).payload) as SyncChange;
				}
				return null;
			})
			.filter((row): row is SyncChange => row !== null)
			.sort((a, b) =>
				a.timestamp === b.timestamp
					? a.id.localeCompare(b.id)
					: a.timestamp.localeCompare(b.timestamp),
			);
	}

	async disconnect(sessionId: string): Promise<void> {
		if (!this.endpoint || !this.sessionId) return;
		if (sessionId !== this.sessionId) return;

		LoroSyncProvider.hub.unregister(this.endpoint, this.sessionId);
		this.unsubscribe?.();

		this.unsubscribe = null;
		this.endpoint = null;
		this.sessionId = null;
	}

	async receiveRemoteUpdate(update: Uint8Array): Promise<void> {
		await this.storage.applyUpdate(new Uint8Array(update));
	}
}

function createChange(
	id: string,
	author: string,
	resourceId: string,
	status: string,
): SyncChange {
	return {
		id,
		timestamp: new Date().toISOString(),
		author,
		operation: "update",
		resourceId,
		data: { status },
	};
}

async function flushProjection(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => {
	LoroSyncProvider.resetForTests();
});

describe("@refarm.dev/sync-loro sync:v1 conformance", () => {
	it("passes sync:v1 conformance through provider bridge", async () => {
		const provider = new LoroSyncProvider();
		const result = await runSyncV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("maps conflict scenario with concurrent updates from two peers", async () => {
		const endpoint = "memory://sync-loro-conformance";
		const peerA = new LoroSyncProvider(20_000n);
		const peerB = new LoroSyncProvider(30_000n);

		const [sessionA, sessionB] = await Promise.all([
			peerA.connect(endpoint),
			peerB.connect(endpoint),
		]);

		await Promise.all([
			peerA.push([createChange("change-a", "peer-a", "task-1", "from-a")]),
			peerB.push([createChange("change-b", "peer-b", "task-1", "from-b")]),
		]);

		await flushProjection();

		const [changesA, changesB] = await Promise.all([
			peerA.pull(),
			peerB.pull(),
		]);
		const idsA = changesA.map((change) => change.id).sort();
		const idsB = changesB.map((change) => change.id).sort();

		expect(idsA).toEqual(["change-a", "change-b"]);
		expect(idsB).toEqual(["change-a", "change-b"]);

		await Promise.all([
			peerA.disconnect(sessionA.sessionId),
			peerB.disconnect(sessionB.sessionId),
		]);
	});
});
