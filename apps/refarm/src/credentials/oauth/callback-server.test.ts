import net from "node:net";

import { describe, expect, it } from "vitest";
import { startCallbackServer } from "./callback-server.js";

describe("startCallbackServer", () => {
	it("resolves with a server object containing waitForCode and cancelWait", async () => {
		const server = await startCallbackServer({ port: 59001, path: "/cb", expectedState: "s1" });
		expect(server.listening).toBe(true);
		expect(server.url).toBe("http://127.0.0.1:59001/cb");
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
		const server = await startCallbackServer({
			port: 59003,
			path: "/cb",
			expectedState: "correct",
		});
		// Send wrong state — server closes the race, resolves null
		fetch(`http://127.0.0.1:59003/cb?code=abc&state=wrong`).catch(() => {});
		// Cancel so the test doesn't hang; the state mismatch returns 400
		setTimeout(() => server.cancelWait(), 100);
		const result = await server.waitForCode();
		expect(result).toBeNull();
		server.close();
	});

	/**
	 * A REGRESSION PIN FOR A HYPOTHESIS THAT WAS WRONG, KEPT BECAUSE IT WOULD BECOME RIGHT.
	 *
	 * The operator reported 2026-08-13 that `refarm sow --model-provider openai-codex` printed
	 * everything, including "Credentials stored at …", and then sat there for about a minute before
	 * exiting on its own. The obvious suspect was this file: `server.close()` famously stops the
	 * server ACCEPTING connections without closing the ones already open, and the browser that just
	 * completed the callback holds a keep-alive socket for a long time (Firefox ~115s, Chrome ~300s).
	 *
	 * MEASURED, AND THE SUSPECT WAS INNOCENT. Against this module, on Node 22, the client socket
	 * dies 0–1ms after `close()`, on both the 200 and the 400 path. The experiment that seemed to
	 * incriminate it was measuring the probe's OWN undestroyed client socket holding the loop, not
	 * the server's.
	 *
	 * The test stays because the behaviour it pins is load-bearing and not guaranteed by the code —
	 * it comes from the runtime. The day it changes, or the day someone gives this server a
	 * long-lived connection, the hang becomes real and this fails instead of an operator waiting.
	 */
	it("closes a live keep-alive connection, so the CLI can exit instead of looking hung", async () => {
		const server = await startCallbackServer({ port: 59004, path: "/cb", expectedState: "s4" });
		const socket = net.connect(59004, "127.0.0.1");
		await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
		socket.write("GET /cb HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
		await new Promise<void>((resolve) => socket.once("data", () => resolve()));

		const closed = new Promise<"closed">((resolve) => socket.once("close", () => resolve("closed")));
		server.close();
		// Generous, and still far below any browser's keep-alive: the point is that it does not wait
		// for the CLIENT to lose interest.
		const outcome = await Promise.race([
			closed,
			new Promise<"still-open">((resolve) => setTimeout(() => resolve("still-open"), 2000)),
		]);
		expect(outcome).toBe("closed");
		server.cancelWait();
		await server.waitForCode();
	});
});
