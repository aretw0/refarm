import { describe, expect, it, vi } from "vitest";

import type { CallbackServer } from "./callback-server.js";
import { waitForOAuthCallback } from "./callback-wait.js";

describe("waitForOAuthCallback", () => {
	it("reports waiting and received states for browser callbacks", async () => {
		const onCallbackWait = vi.fn();
		const server: CallbackServer = {
			listening: true,
			url: "http://127.0.0.1:1455/auth/callback",
			waitForCode: async () => ({ code: "code-1", state: "state-1" }),
			cancelWait: vi.fn(),
			close: vi.fn(),
		};

		await expect(waitForOAuthCallback(server, { callbacks: { onCallbackWait } })).resolves.toEqual({
			code: "code-1",
			state: "state-1",
		});

		expect(onCallbackWait).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "callback-waiting",
				callbackUrl: "http://127.0.0.1:1455/auth/callback",
			}),
		);
		expect(onCallbackWait).toHaveBeenCalledWith(
			expect.objectContaining({ phase: "callback-received" }),
		);
	});

	it("reports unavailable callback servers before falling back", async () => {
		const onCallbackWait = vi.fn();
		const server: CallbackServer = {
			listening: false,
			unavailableReason: "port 1455 is already in use",
			waitForCode: async () => null,
			cancelWait: vi.fn(),
			close: vi.fn(),
		};

		await expect(
			waitForOAuthCallback(server, { callbacks: { onCallbackWait } }),
		).resolves.toBeNull();

		expect(onCallbackWait).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "callback-unavailable",
				message: expect.stringContaining("port 1455 is already in use"),
			}),
		);
	});
});
