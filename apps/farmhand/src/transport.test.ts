import { describe, it, expect, vi, afterEach } from "vitest";

// Shared mock state — must be declared before vi.mock is hoisted
const mockState = vi.hoisted(() => {
  const wssClose = vi.fn((cb?: () => void) => cb && cb());
  const wssAddress = vi.fn().mockReturnValue({ port: 42000 });
  const wssOn = vi.fn();

  // A proper constructor mock: use a named function so `new` works
  function MockWebSocketServer(this: Record<string, unknown>, _opts: { port: number }) {
    this.on = wssOn;
    this.close = wssClose;
    this.address = wssAddress;
  }

  return { wssClose, wssAddress, wssOn, MockWebSocketServer };
});

vi.mock("ws", () => ({
  WebSocketServer: mockState.MockWebSocketServer,
  WebSocket: { OPEN: 1 },
}));

import { WebSocketSyncTransport } from "./transport.js";

afterEach(() => {
  vi.clearAllMocks();
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
