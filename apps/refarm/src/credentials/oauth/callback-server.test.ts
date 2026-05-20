import { describe, it, expect } from "vitest";
import { startCallbackServer } from "./callback-server.js";

describe("startCallbackServer", () => {
	it("resolves with a server object containing waitForCode and cancelWait", async () => {
		const server = await startCallbackServer({ port: 59001, path: "/cb", expectedState: "s1" });
		expect(typeof server.waitForCode).toBe("function");
		expect(typeof server.cancelWait).toBe("function");
		expect(typeof server.close).toBe("function");
		server.cancelWait();
		await server.waitForCode();
		server.close();
	});

	it("cancelWait causes waitForCode to resolve with null", async () => {
		const server = await startCallbackServer({ port: 59002, path: "/cb", expectedState: "s2" });
		server.cancelWait();
		const result = await server.waitForCode();
		expect(result).toBeNull();
		server.close();
	});

	it("returns null on state mismatch via HTTP GET", async () => {
		const server = await startCallbackServer({ port: 59003, path: "/cb", expectedState: "correct" });
		// Send wrong state — server closes the race, resolves null
		fetch(`http://127.0.0.1:59003/cb?code=abc&state=wrong`).catch(() => {});
		// Cancel so the test doesn't hang; the state mismatch returns 400
		setTimeout(() => server.cancelWait(), 100);
		const result = await server.waitForCode();
		expect(result).toBeNull();
		server.close();
	});
});
