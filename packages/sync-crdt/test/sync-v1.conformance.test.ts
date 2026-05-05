import {
	runSyncV1Conformance,
	SYNC_CAPABILITY,
	type SyncChange,
	type SyncProvider,
	type SyncSession,
} from "@refarm.dev/sync-contract-v1";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CRDTOperation,
	SyncEngine,
	type SyncTransport,
} from "../src/index";

class InMemorySyncHub {
	private readonly endpoints = new Map<
		string,
		Map<string, InMemoryTransport>
	>();

	register(
		endpoint: string,
		peerId: string,
		transport: InMemoryTransport,
	): void {
		if (!this.endpoints.has(endpoint)) {
			this.endpoints.set(endpoint, new Map());
		}
		this.endpoints.get(endpoint)?.set(peerId, transport);
	}

	unregister(endpoint: string, peerId: string): void {
		const peers = this.endpoints.get(endpoint);
		if (!peers) return;

		peers.delete(peerId);
		if (peers.size === 0) {
			this.endpoints.delete(endpoint);
		}
	}

	broadcast(endpoint: string, fromPeerId: string, op: CRDTOperation): void {
		const peers = this.endpoints.get(endpoint);
		if (!peers) return;

		for (const [peerId, transport] of peers.entries()) {
			if (peerId === fromPeerId) continue;
			transport.receive(op);
		}
	}

	reset(): void {
		this.endpoints.clear();
	}
}

class InMemoryTransport implements SyncTransport {
	private receiver: ((op: CRDTOperation) => void) | null = null;

	constructor(
		private readonly hub: InMemorySyncHub,
		private readonly endpoint: string,
		private readonly peerId: string,
	) {
		this.hub.register(endpoint, peerId, this);
	}

	async send(op: CRDTOperation): Promise<void> {
		this.hub.broadcast(this.endpoint, this.peerId, op);
	}

	onReceive(handler: (op: CRDTOperation) => void): void {
		this.receiver = handler;
	}

	async disconnect(): Promise<void> {
		this.hub.unregister(this.endpoint, this.peerId);
		this.receiver = null;
	}

	receive(op: CRDTOperation): void {
		this.receiver?.(op);
	}
}

class SyncCRDTProvider implements SyncProvider {
	readonly capability = SYNC_CAPABILITY;
	readonly pluginId: string;

	private static readonly hub = new InMemorySyncHub();
	private static providerCounter = 0;
	private static sessionCounter = 0;

	private readonly peerId: string;
	private readonly engine: SyncEngine;
	private readonly changes = new Map<string, SyncChange>();

	private transport: InMemoryTransport | null = null;
	private activeSessionId: string | null = null;

	constructor() {
		const ordinal = ++SyncCRDTProvider.providerCounter;
		this.peerId = `peer-${ordinal}`;
		this.pluginId = `@refarm.dev/sync-crdt-conformance-${ordinal}`;
		this.engine = new SyncEngine(this.peerId);

		this.engine.onOperation((operation) => {
			const payload = operation.op;
			if (isSyncChange(payload)) {
				this.changes.set(payload.id, payload);
			}
		});
	}

	static resetForTests(): void {
		SyncCRDTProvider.hub.reset();
		SyncCRDTProvider.providerCounter = 0;
		SyncCRDTProvider.sessionCounter = 0;
	}

	async connect(endpoint: string): Promise<SyncSession> {
		const sessionId = `session-${++SyncCRDTProvider.sessionCounter}`;
		this.transport = new InMemoryTransport(
			SyncCRDTProvider.hub,
			endpoint,
			this.peerId,
		);
		this.engine.addTransport(this.transport);
		this.activeSessionId = sessionId;

		return {
			sessionId,
			peerId: this.peerId,
			startedAt: new Date().toISOString(),
		};
	}

	async push(changes: SyncChange[]): Promise<void> {
		if (!this.activeSessionId) {
			throw new Error("provider not connected");
		}

		for (const change of changes) {
			await this.engine.dispatch(change);
		}
	}

	async pull(): Promise<SyncChange[]> {
		return Array.from(this.changes.values()).sort((a, b) =>
			a.timestamp === b.timestamp
				? a.id.localeCompare(b.id)
				: a.timestamp.localeCompare(b.timestamp),
		);
	}

	async disconnect(sessionId: string): Promise<void> {
		if (sessionId !== this.activeSessionId) return;

		await this.transport?.disconnect();
		this.transport = null;
		this.activeSessionId = null;
	}
}

function isSyncChange(value: unknown): value is SyncChange {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Partial<SyncChange>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.timestamp === "string" &&
		typeof candidate.author === "string" &&
		typeof candidate.resourceId === "string" &&
		(candidate.operation === "put" ||
			candidate.operation === "update" ||
			candidate.operation === "delete")
	);
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

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 10));
}

afterEach(() => {
	SyncCRDTProvider.resetForTests();
});

describe("@refarm.dev/sync-crdt sync:v1 conformance", () => {
	it("passes sync:v1 conformance", async () => {
		const provider = new SyncCRDTProvider();
		const result = await runSyncV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("converges concurrent updates from two peers", async () => {
		const endpoint = "memory://sync-crdt-conformance";
		const peerA = new SyncCRDTProvider();
		const peerB = new SyncCRDTProvider();

		const [sessionA, sessionB] = await Promise.all([
			peerA.connect(endpoint),
			peerB.connect(endpoint),
		]);

		await Promise.all([
			peerA.push([createChange("change-a", "peer-a", "task-1", "from-a")]),
			peerB.push([createChange("change-b", "peer-b", "task-1", "from-b")]),
		]);

		await flush();

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
