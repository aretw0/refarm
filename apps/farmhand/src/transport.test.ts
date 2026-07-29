import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";

// Shared mock state — must be declared before vi.mock is hoisted
const mockState = vi.hoisted(() => {
	const wssClose = vi.fn((cb?: () => void) => cb && cb());
	const wssAddress = vi.fn().mockReturnValue({ port: 42000 });
	const wssOn = vi.fn();
	/** Every options object handed to `new WebSocketServer(...)`, so a test can assert the
	 *  HOST that would have been bound without binding anything. */
	const wssOptions: Array<{ port: number; host?: string }> = [];

	// A proper constructor mock: use a named function so `new` works
	function MockWebSocketServer(
		this: Record<string, unknown>,
		opts: { port: number; host?: string },
	) {
		wssOptions.push(opts);
		this.on = wssOn;
		this.close = wssClose;
		this.address = wssAddress;
	}

	return { wssClose, wssAddress, wssOn, wssOptions, MockWebSocketServer };
});

vi.mock("ws", () => ({
	WebSocketServer: mockState.MockWebSocketServer,
	WebSocket: { OPEN: 1 },
}));

import { WebSocketSyncTransport } from "./transport.js";

afterEach(() => {
	vi.clearAllMocks();
	mockState.wssOptions.length = 0;
	delete process.env.REFARM_AUTH_POLICY;
	// Restore address default after per-test override
	mockState.wssAddress.mockReturnValue({ port: 42000 });
});

describe("WebSocketSyncTransport", () => {
	it("creates a WebSocketServer on the given port (smoke)", () => {
		// Just verifying construction does not throw
		const transport = new WebSocketSyncTransport(42000);
		expect(transport).toBeDefined();
	});

	it("returns the port from the server address", () => {
		const transport = new WebSocketSyncTransport(42000);
		expect(transport.port).toBe(42000);
	});

	it("registers a connection handler on the WebSocketServer", () => {
		new WebSocketSyncTransport(42000);
		expect(mockState.wssOn).toHaveBeenCalledWith("connection", expect.any(Function));
	});

	it("onMessage registers a handler that is not called before connections", () => {
		const handler = vi.fn();
		const transport = new WebSocketSyncTransport(42000);
		transport.onMessage(handler);
		expect(handler).not.toHaveBeenCalled();
	});

	it("disconnect closes the server", async () => {
		const transport = new WebSocketSyncTransport(42000);
		await transport.disconnect();
		expect(mockState.wssClose).toHaveBeenCalled();
	});

	it("broadcast sends binary bytes to all open clients", () => {
		const transport = new WebSocketSyncTransport(42000);

		// Extract the connection handler registered with wss.on("connection", ...)
		const connectionCall = mockState.wssOn.mock.calls.find(
			(args: unknown[]) => args[0] === "connection",
		);
		const connectionHandler = connectionCall?.[1] as ((ws: unknown) => void) | undefined;

		const mockClientSend = vi.fn();
		const mockClientOn = vi.fn();
		const mockClient = {
			readyState: 1, // WebSocket.OPEN
			send: mockClientSend,
			on: mockClientOn,
		};

		connectionHandler?.(mockClient);

		const bytes = new Uint8Array([1, 2, 3, 4]);
		transport.broadcast(bytes);

		expect(mockClientSend).toHaveBeenCalledWith(bytes);
	});

	it("returns 0 for port when server address is null", () => {
		mockState.wssAddress.mockReturnValueOnce(null);
		const transport = new WebSocketSyncTransport(42000);
		expect(transport.port).toBe(0);
	});
});

describe("WebSocketSyncTransport bind safety", () => {
	// `ws` is mocked in this file, so every case below is PURE: the host that WOULD be bound
	// is asserted from the options object, and no socket is ever opened.

	it("binds loopback by default", () => {
		// Mutation guard for the original defect: `new WebSocketServer({ port })` with no host
		// binds EVERY interface — an unauthenticated CRDT relay on 42000 reachable from the
		// whole network. Dropping the host from the options makes this fail.
		const transport = new WebSocketSyncTransport(42000);
		expect(transport.host).toBe("127.0.0.1");
		expect(mockState.wssOptions.at(-1)).toEqual({ port: 42000, host: "127.0.0.1" });
	});

	it("refuses a non-loopback host with no auth policy — and constructs nothing", () => {
		expect(() => new WebSocketSyncTransport(42000, "0.0.0.0")).toThrow(
			/no auth policy configured/,
		);
		// The guard runs BEFORE the server is constructed, so no relay exists to leak.
		expect(mockState.wssOptions).toHaveLength(0);
	});

	it("refuses a tailnet-shaped host too", () => {
		expect(() => new WebSocketSyncTransport(42000, "100.64.0.1")).toThrow(/refusing to bind/);
	});

	it("names the farmhand relay in the refusal so the operator knows which listener said no", () => {
		expect(() => new WebSocketSyncTransport(42000, "0.0.0.0")).toThrow(
			/farmhand CRDT sync relay/,
		);
	});

	it("allows a wider bind once an auth policy is configured", () => {
		// The policy file must EXIST — a dangling REFARM_AUTH_POLICY is not an opt-in.
		process.env.REFARM_AUTH_POLICY = fileURLToPath(import.meta.url);
		const transport = new WebSocketSyncTransport(42000, "0.0.0.0");
		expect(transport.host).toBe("0.0.0.0");
		expect(mockState.wssOptions.at(-1)).toEqual({ port: 42000, host: "0.0.0.0" });
	});

	it("treats a REFARM_AUTH_POLICY pointing at nothing as no policy at all", () => {
		process.env.REFARM_AUTH_POLICY = "/nonexistent/policy.json";
		expect(() => new WebSocketSyncTransport(42000, "0.0.0.0")).toThrow(/refusing to bind/);
	});
});
