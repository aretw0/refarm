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

		const client = new BrowserSyncClient(storage);
		client.connect();

		const socket = sockets[0]!;
		expect(socket.url).toBe("ws://localhost:42000");
		expect(socket.binaryType).toBe("arraybuffer");

		socket.open();
		await Promise.resolve();
		expect(storage.getUpdate).toHaveBeenCalled();
		expect(socket.sent).toEqual([localUpdate]);
		expect(storage.onUpdate).toHaveBeenCalledWith(expect.any(Function));

		const localDelta = new Uint8Array([7, 8, 9]);
		localUpdateHandler?.(localDelta);
		expect(socket.sent).toEqual([localUpdate, localDelta]);

		socket.receive(remoteSnapshot);
		await Promise.resolve();
		expect(storage.applyUpdate).toHaveBeenCalledWith(remoteSnapshot);

		client.disconnect();
		expect(socket.close).toHaveBeenCalled();
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
