import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	createConnectionCommand,
	requestConnectionDown,
	requestConnectionUp,
	type ConnectionDownOutcome,
	type ConnectionOperatorOutcome,
	type ConnectionOperatorState,
} from "../../src/commands/connection.js";

function jsonResponse(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	};
}

function operatorState(overrides: Partial<ConnectionOperatorState> = {}): ConnectionOperatorState {
	return {
		name: "serpro-vpn",
		status: "up",
		sinceNs: 123,
		claims: 1,
		claim: 42,
		...overrides,
	};
}

describe("refarm connection up / down (hermetic — an injected sidecar client, no network, no runtime)", () => {
	beforeEach(() => {
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		process.exitCode = undefined;
	});

	// ─── up: declared connection reports state ───────────────────────────────

	it("up on a declared connection reports the resulting state as JSON (ok, command, operation)", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionUp = vi.fn(
			async (name: string): Promise<ConnectionOperatorOutcome> => ({
				outcome: "ok",
				state: operatorState({ name, status: "up", claims: 2, claim: 7 }),
			}),
		);

		await createConnectionCommand({ connectionUp }).parseAsync(
			["up", "serpro-vpn", "--json"],
			{ from: "user" },
		);

		expect(connectionUp).toHaveBeenCalledWith("serpro-vpn");
		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			ok: true,
			command: "connection",
			operation: "up",
			name: "serpro-vpn",
			status: "up",
			claims: 2,
			claim: 7,
		});
		expect(process.exitCode).toBeUndefined();
	});

	it("up on a declared connection reports the state in human output", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "ok",
			state: operatorState({ status: "connecting", claims: 1 }),
		}));

		await createConnectionCommand({ connectionUp }).parseAsync(["up", "serpro-vpn"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("serpro-vpn");
		expect(output).toContain("connecting");
		expect(output).toContain("claims: 1");
	});

	// ─── up: undeclared name surfaces a clean error, not a stack trace ───────

	it("up on an undeclared name surfaces the sidecar's error clearly, not a stack trace", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "undeclared",
			message: "no connection named 'nope' is declared in .refarm/config.json",
		}));

		await createConnectionCommand({ connectionUp }).parseAsync(["up", "nope"], {
			from: "user",
		});

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("no connection named 'nope' is declared");
		expect(output).not.toContain("Error:");
		expect(output).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-trace frame
		expect(process.exitCode).toBe(1);
	});

	it("up on an undeclared name reports a clean connection-undeclared JSON envelope with a real nextCommand", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "undeclared",
			message: "no connection named 'nope' is declared in .refarm/config.json",
		}));

		await createConnectionCommand({ connectionUp }).parseAsync(["up", "nope", "--json"], {
			from: "user",
		});

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			ok: false,
			command: "connection",
			operation: "up",
			error: "connection-undeclared",
			message: "no connection named 'nope' is declared in .refarm/config.json",
			nextCommand: "refarm connection status --json",
		});
		expect(process.exitCode).toBe(1);
	});

	it("up surfaces a host-side failure (not undeclared) through the generic runtime error path", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "failed",
			message: "registry refused the attempt",
		}));

		await createConnectionCommand({ connectionUp }).parseAsync(["up", "serpro-vpn"], {
			from: "user",
		});

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("registry refused the attempt");
		expect(process.exitCode).toBe(1);
	});

	// ─── down: reports the active-claim count ────────────────────────────────

	it("down reports the active-claim count in JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionDown = vi.fn(
			async (name: string): Promise<ConnectionDownOutcome> => ({
				outcome: "ok",
				state: operatorState({ name, status: "down", claims: 0, claim: null, sinceNs: null }),
				claimsActive: 3,
			}),
		);

		await createConnectionCommand({ connectionDown }).parseAsync(
			["down", "serpro-vpn", "--json"],
			{ from: "user" },
		);

		expect(connectionDown).toHaveBeenCalledWith("serpro-vpn");
		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			ok: true,
			command: "connection",
			operation: "down",
			name: "serpro-vpn",
			status: "down",
			claimsActive: 3,
		});
	});

	it("down reports the active-claim count in human output — never swallowed (D12)", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionDown = vi.fn(async (): Promise<ConnectionDownOutcome> => ({
			outcome: "ok",
			state: operatorState({ status: "down", claims: 0, claim: null, sinceNs: null }),
			claimsActive: 2,
		}));

		await createConnectionCommand({ connectionDown }).parseAsync(["down", "serpro-vpn"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("claims active when stopped: 2");
	});

	it("down reports zero active claims plainly, not omitted", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionDown = vi.fn(async (): Promise<ConnectionDownOutcome> => ({
			outcome: "ok",
			state: operatorState({ status: "down", claims: 0, claim: null, sinceNs: null }),
			claimsActive: 0,
		}));

		await createConnectionCommand({ connectionDown }).parseAsync(
			["down", "serpro-vpn", "--json"],
			{ from: "user" },
		);

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output.claimsActive).toBe(0);
	});

	// ─── unreachable sidecar → runtime-recovery message, not a raw connection error ───

	it("up: an unreachable sidecar produces the runtime-recovery message, not a raw connection error", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => {
			throw new Error("fetch failed");
		});

		await createConnectionCommand({ connectionUp }).parseAsync(["up", "serpro-vpn"], {
			from: "user",
		});

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime is not running");
		expect(output).not.toContain("fetch failed");
		expect(process.exitCode).toBe(1);
	});

	it("up: an unreachable sidecar reports runtime-unavailable as JSON with the ensure recovery command", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => {
			throw new Error("ECONNREFUSED");
		});

		await createConnectionCommand({ connectionUp }).parseAsync(
			["up", "serpro-vpn", "--json"],
			{ from: "user" },
		);

		expect(errorSpy).not.toHaveBeenCalled();
		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			ok: false,
			command: "connection",
			operation: "up",
			error: "runtime-unavailable",
			nextCommand: "refarm runtime ensure --wait --next-command",
		});
		expect(process.exitCode).toBe(1);
	});

	it("down: an unreachable sidecar produces the runtime-recovery message, not a raw connection error", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionDown = vi.fn(async (): Promise<ConnectionDownOutcome> => {
			throw new Error("fetch failed");
		});

		await createConnectionCommand({ connectionDown }).parseAsync(["down", "serpro-vpn"], {
			from: "user",
		});

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime is not running");
		expect(process.exitCode).toBe(1);
	});

	// ─── The real HTTP adapter — the default when no client is injected ──────
	// Stubs the global `fetch` (the same technique `test/commands/tasks.test.ts`
	// uses) so this stays hermetic: no real network call, no real runtime.

	describe("requestConnectionUp / requestConnectionDown (the real sidecar adapter)", () => {
		it("classifies a 200 response as ok and parses the state", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(
					jsonResponse({ name: "serpro-vpn", status: "up", sinceNs: 999, claims: 1, claim: 5 }),
				),
			);

			const result = await requestConnectionUp("serpro-vpn");
			expect(result).toEqual({
				outcome: "ok",
				state: { name: "serpro-vpn", status: "up", sinceNs: 999, claims: 1, claim: 5 },
			});
		});

		it("classifies a 404 response as undeclared", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(
					jsonResponse({ error: "no connection named 'nope' is declared" }, 404),
				),
			);

			const result = await requestConnectionUp("nope");
			expect(result).toEqual({
				outcome: "undeclared",
				message: "no connection named 'nope' is declared",
			});
		});

		it("classifies a non-404 error response as failed", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(jsonResponse({ error: "spawn failed" }, 500)),
			);

			const result = await requestConnectionUp("serpro-vpn");
			expect(result).toEqual({ outcome: "failed", message: "spawn failed" });
		});

		it("extracts claimsActive from a down response", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(
					jsonResponse({
						name: "serpro-vpn",
						status: "down",
						sinceNs: null,
						claims: 0,
						claim: null,
						claimsActive: 4,
					}),
				),
			);

			const result = await requestConnectionDown("serpro-vpn");
			expect(result).toEqual({
				outcome: "ok",
				state: { name: "serpro-vpn", status: "down", sinceNs: null, claims: 0, claim: null },
				claimsActive: 4,
			});
		});

		it("propagates a network failure as a thrown error, not a result", async () => {
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

			await expect(requestConnectionUp("serpro-vpn")).rejects.toThrow("fetch failed");
		});
	});
});
