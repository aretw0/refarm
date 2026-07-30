import { parseSurfaces, type SurfaceCatalog } from "@refarm.dev/std";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/** The `surfaces` catalog a test declares, through the SAME parser production uses — so a
 *  combination the parser refuses can never be smuggled into a bind test by hand. */
function declare(surfaces: Record<string, unknown>): SurfaceCatalog {
	return parseSurfaces({ surfaces });
}

const UNDECLARED: SurfaceCatalog = parseSurfaces({});

describe("WebSocketSyncTransport bind safety — the `daemon-ws` declaration decides (O5)", () => {
	// `ws` is mocked in this file, so every case below is PURE: the host that WOULD be bound
	// is asserted from the options object, and no socket is ever opened. The catalog is always
	// INJECTED, so no test depends on what this machine's `.refarm/config.json` happens to say.

	it("binds loopback when `daemon-ws` is undeclared (S1)", () => {
		// Mutation guard for the original defect: `new WebSocketServer({ port })` with no host
		// binds EVERY interface — an unauthenticated CRDT relay on 42000 reachable from the
		// whole network. Dropping the host from the options makes this fail.
		const transport = new WebSocketSyncTransport(42000, undefined, { surfaces: UNDECLARED });
		expect(transport.host).toBe("127.0.0.1");
		expect(mockState.wssOptions.at(-1)).toEqual({ port: 42000, host: "127.0.0.1" });
	});

	it("refuses a non-loopback host when `daemon-ws` is undeclared — and constructs nothing", () => {
		expect(() => new WebSocketSyncTransport(42000, "0.0.0.0", { surfaces: UNDECLARED })).toThrow(
			/no `surfaces.daemon-ws` declaration is present/,
		);
		// The guard runs BEFORE the server is constructed, so no relay exists to leak.
		expect(mockState.wssOptions).toHaveLength(0);
	});

	it("refuses a tailnet-shaped host too — a 100.64/10 literal is not evidence of admission", () => {
		expect(() => new WebSocketSyncTransport(42000, "100.64.0.1", { surfaces: UNDECLARED })).toThrow(
			/refusing to bind/,
		);
	});

	it("names the farmhand relay in the refusal so the operator knows which listener said no", () => {
		expect(() => new WebSocketSyncTransport(42000, "0.0.0.0", { surfaces: UNDECLARED })).toThrow(
			/farmhand CRDT sync relay/,
		);
	});

	it("an auth policy existing somewhere no longer permits ANY bind (O5)", () => {
		// The criterion this replaced. `REFARM_AUTH_POLICY` naming a file that exists was the
		// whole permission to open an UNAUTHENTICATED CRDT relay to the network — a policy
		// belonging to the sidecar and to the Rust WS handshake, neither of which this relay
		// reads. Mutation guard: restore `authPolicyPresent()` as the criterion and this passes
		// a bind it must refuse.
		process.env.REFARM_AUTH_POLICY = fileURLToPath(import.meta.url);
		expect(() => new WebSocketSyncTransport(42000, "0.0.0.0", { surfaces: UNDECLARED })).toThrow(
			/refusing to bind/,
		);
		expect(mockState.wssOptions).toHaveLength(0);
	});

	it("honours the declared ceiling: a declared host binds with no flag at all (S5)", () => {
		// `daemon-ws` CAN be declared beyond loopback — the RUST daemon enforces ADR-093's
		// handshake — so the vocabulary parses this. What happens next is the point of the
		// test below it.
		const surfaces = declare({
			"daemon-ws": { expose: "host:10.0.0.4", gate: "device-token" },
		});
		expect(surfaces.get("daemon-ws")).toEqual({
			expose: { kind: "host", host: "10.0.0.4" },
			gate: "device-token",
		});
	});

	it("REFUSES a declared gate this listener cannot enforce (S3), even though the surface can", () => {
		// The defect that made the per-SURFACE capability table wrong here: `daemon-ws` really
		// does have a gate — in the Rust daemon. This relay verifies nothing. Binding the
		// declaration anyway would be the appearance of a gate without a gate.
		expect(
			() =>
				new WebSocketSyncTransport(42000, undefined, {
					surfaces: declare({ "daemon-ws": { expose: "host:10.0.0.4", gate: "device-token" } }),
				}),
		).toThrow(/this listener verifies no credential at all/);
		expect(mockState.wssOptions).toHaveLength(0);
	});

	it("refuses a declared `tailnet` LOUDLY instead of quietly narrowing to loopback", () => {
		// The defaulted-flag defect one layer down: an unresolved `tailnet` falls back to
		// loopback, so without the enforceability clause this relay would bind 127.0.0.1 and
		// say nothing while the operator believed their declaration took effect.
		expect(
			() =>
				new WebSocketSyncTransport(42000, undefined, {
					surfaces: declare({ "daemon-ws": { expose: "tailnet", gate: "device-token" } }),
				}),
		).toThrow(/cannot be honoured HERE/);
		expect(mockState.wssOptions).toHaveLength(0);
	});

	it("an explicit loopback host narrows the declaration and is allowed (S5)", () => {
		// The operator narrowed it themselves: nothing is exposed, so there is no unenforceable
		// claim left to refuse.
		const transport = new WebSocketSyncTransport(42000, "127.0.0.1", {
			surfaces: declare({ "daemon-ws": { expose: "tailnet", gate: "device-token" } }),
		});
		expect(transport.host).toBe("127.0.0.1");
	});

	it("a declared `expose: loopback` is a CEILING no host may widen (S5)", () => {
		expect(
			() =>
				new WebSocketSyncTransport(42000, "0.0.0.0", {
					surfaces: declare({ "daemon-ws": { expose: "loopback" } }),
				}),
		).toThrow(/a flag may narrow that declaration, never widen it/);
	});

	it("the parser refuses `gate: none` for `daemon-ws` beyond loopback (O2, read-only)", () => {
		// The other half of why this relay can never be open: deliberate openness is admissible
		// only for a read-only surface that grants nothing, and a CRDT relay accepts writes.
		expect(() => declare({ "daemon-ws": { expose: "tailnet", gate: "none" } })).toThrow(
			/accepts mutations and HAS a credential gate/,
		);
	});

	it("a malformed declaration THROWS rather than degrading to loopback (fail-shut)", () => {
		expect(() => declare({ "daemon-ws": { expose: "host:not-an-ip" } })).toThrow(
			/is not a valid, fully-specified IP/,
		);
	});
});
