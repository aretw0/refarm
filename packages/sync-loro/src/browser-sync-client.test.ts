import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSyncClient } from "./browser-sync-client";
import type { LoroCRDTStorage } from "./loro-crdt-storage";

describe("BrowserSyncClient", () => {
	const originalWebSocket = globalThis.WebSocket;
	let sockets: MockWebSocket[];

	beforeEach(() => {
		sockets = [];
		globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
		MockWebSocket.onCreate = (socket) => sockets.push(socket);
	});

	afterEach(() => {
		globalThis.WebSocket = originalWebSocket;
		MockWebSocket.onCreate = undefined;
		vi.restoreAllMocks();
	});

	it("connects to the default tractor endpoint and exchanges binary Loro updates", async () => {
		const localUpdate = new Uint8Array([1, 2, 3]);
		const remoteSnapshot = new Uint8Array([4, 5, 6]);
		let localUpdateHandler: ((bytes: Uint8Array) => void) | undefined;
		const storage = {
			getUpdate: vi.fn(async () => localUpdate),
			applyUpdate: vi.fn(async (_bytes: Uint8Array) => {}),
			onUpdate: vi.fn((handler: (bytes: Uint8Array) => void) => {
				localUpdateHandler = handler;
				return vi.fn();
			}),
		} as unknown as LoroCRDTStorage;

		const onEvent = vi.fn();
		const client = new BrowserSyncClient(storage, { onEvent });
		client.connect();

		const socket = sockets[0]!;
		expect(socket.url).toBe("ws://localhost:42000");
		expect(socket.binaryType).toBe("arraybuffer");
		expect(onEvent).toHaveBeenCalledWith({
			type: "connecting",
			wsUrl: "ws://localhost:42000",
		});

		socket.open();
		await Promise.resolve();
		expect(storage.getUpdate).toHaveBeenCalled();
		expect(socket.sent).toEqual([localUpdate]);
		expect(storage.onUpdate).toHaveBeenCalledWith(expect.any(Function));
		expect(onEvent).toHaveBeenCalledWith({
			type: "open",
			wsUrl: "ws://localhost:42000",
		});
		expect(onEvent).toHaveBeenCalledWith({
			type: "local-state-sent",
			byteLength: localUpdate.byteLength,
			wsUrl: "ws://localhost:42000",
		});

		const localDelta = new Uint8Array([7, 8, 9]);
		localUpdateHandler?.(localDelta);
		expect(socket.sent).toEqual([localUpdate, localDelta]);
		expect(onEvent).toHaveBeenCalledWith({
			type: "local-update-sent",
			byteLength: localDelta.byteLength,
			wsUrl: "ws://localhost:42000",
		});

		socket.receive(remoteSnapshot);
		await Promise.resolve();
		expect(storage.applyUpdate).toHaveBeenCalledWith(remoteSnapshot);
		expect(onEvent).toHaveBeenCalledWith({
			type: "remote-update-received",
			byteLength: remoteSnapshot.byteLength,
			wsUrl: "ws://localhost:42000",
		});
		expect(onEvent).toHaveBeenCalledWith({
			type: "remote-update-applied",
			byteLength: remoteSnapshot.byteLength,
			wsUrl: "ws://localhost:42000",
		});

		client.disconnect();
		expect(socket.close).toHaveBeenCalled();
	});

	it("emits a failure event when a remote update cannot be applied", async () => {
		const remoteSnapshot = new Uint8Array([4, 5, 6]);
		const storage = {
			getUpdate: vi.fn(async () => new Uint8Array([1])),
			applyUpdate: vi.fn(async () => {
				throw new Error("bad snapshot");
			}),
			onUpdate: vi.fn(() => vi.fn()),
		} as unknown as LoroCRDTStorage;
		const onEvent = vi.fn();

		const client = new BrowserSyncClient(storage, { onEvent });
		client.connect();
		const socket = sockets[0]!;
		socket.open();
		await Promise.resolve();

		socket.receive(remoteSnapshot);
		await Promise.resolve();
		await Promise.resolve();

		expect(onEvent).toHaveBeenCalledWith({
			type: "remote-update-failed",
			byteLength: remoteSnapshot.byteLength,
			error: "bad snapshot",
			wsUrl: "ws://localhost:42000",
		});

		client.disconnect();
	});
});

class MockWebSocket {
	static readonly OPEN = 1;
	static onCreate: ((socket: MockWebSocket) => void) | undefined;

	readonly close = vi.fn();
	readonly sent: Uint8Array[] = [];
	binaryType: BinaryType = "blob";
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onopen: (() => void) | null = null;
	readyState = MockWebSocket.OPEN;

	constructor(readonly url: string) {
		MockWebSocket.onCreate?.(this);
	}

	open(): void {
		this.onopen?.();
	}

	receive(bytes: Uint8Array): void {
		this.onmessage?.({ data: bytes.buffer } as MessageEvent);
	}

	send(bytes: Uint8Array): void {
		this.sent.push(bytes);
	}
}
