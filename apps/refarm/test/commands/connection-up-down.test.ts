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

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(
			["up", "serpro-vpn", "--json"],
			{ from: "user" },
		);

		// The second arg is the computed sidecar request timeout — see the
		// CRITICAL-1 block below for what happens when it is silently dropped.
		expect(connectionUp).toHaveBeenCalledWith("serpro-vpn", expect.any(Number));
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

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(
			["up", "serpro-vpn"],
			{ from: "user" },
		);

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("serpro-vpn");
		expect(output).toContain("connecting");
		expect(output).toContain("claims: 1");
	});

	it("an unrecognised (forward-compatible) sidecar status survives parsing AS ITSELF, never coerced to 'down'", async () => {
		// D12 Minor, and a re-review catch on the FIRST version of this test: it built a
		// test-local literal `ConnectionOperatorState` and read the field straight back,
		// which passes whether or not the production parser coerces anything — it never
		// called `asConnectionOperatorState` at all. This drives the REAL sidecar
		// response parser (`requestConnectionUp`, via a stubbed `fetch`) with a status
		// D13 plans to introduce (`needs-attention`) but this CLI does not know about
		// yet — coercing it to "down" would be exactly the D12 lie this exists to catch.
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					name: "serpro-vpn",
					status: "needs-attention",
					sinceNs: null,
					claims: 1,
					claim: 3,
				}),
			),
		);

		const result = await requestConnectionUp("serpro-vpn", 2_000);
		expect(result).toMatchObject({ outcome: "ok", state: { status: "needs-attention" } });
	});

	it("an unrecognised status also survives the human print path, never rendered as 'down'", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "ok",
			state: operatorState({ status: "needs-attention" }),
		}));

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(
			["up", "serpro-vpn"],
			{ from: "user" },
		);

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("needs-attention");
		expect(output).not.toMatch(/:\s*down\b/);
	});

	// ─── up: sidecar request timeout — CRITICAL-1 ────────────────────────────
	//
	// `POST /connections/:name/up` SYNCHRONOUSLY awaits the host's establish, which can
	// legitimately run for as long as the declaration's `readyTimeoutMs` (120s default —
	// the Serpro VPN this feature exists for waits on a phone-approval push). The sidecar
	// client's own default request timeout is 500ms. `up` must never let that bare
	// default reach `fetchSidecarWithTimeout` — see `requestConnectionUp`'s own real-HTTP
	// regression test further below for the version of this proven against the real
	// timeout machinery; these two prove the COMMAND computes the right value to pass it.

	it("up computes its sidecar request timeout from the connection's declared readyTimeoutMs", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "ok",
			state: operatorState({ status: "up" }),
		}));

		await createConnectionCommand({
			connectionUp,
			loadConfig: () => ({
				connections: {
					"serpro-vpn": {
						establish: ["/usr/bin/true"],
						probe: { run: ["/usr/bin/true"] },
						readyTimeoutMs: 30_000,
					},
				},
			}),
		}).parseAsync(["up", "serpro-vpn", "--json"], { from: "user" });

		// declared readyTimeoutMs (30_000) + the fixed round-trip headroom (5_000).
		expect(connectionUp).toHaveBeenCalledWith("serpro-vpn", 35_000);
		void logSpy;
	});

	it("up falls back to a generous default timeout when the connection is not declared locally", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "ok",
			state: operatorState({ status: "up" }),
		}));

		// Nothing declared locally at all — the HOST is still the authority on whether
		// "serpro-vpn" exists; the local catalog read here is diagnostic-only sizing.
		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(
			["up", "serpro-vpn", "--json"],
			{ from: "user" },
		);

		// DEFAULT_READY_TIMEOUT_MS (120_000) + the fixed round-trip headroom (5_000).
		expect(connectionUp).toHaveBeenCalledWith("serpro-vpn", 125_000);
		void logSpy;
	});

	it("up still attempts the request when the local config cannot be loaded at all, using the generous default", async () => {
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "ok",
			state: operatorState({ status: "up" }),
		}));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createConnectionCommand({
			connectionUp,
			loadConfig: () => {
				throw new Error("boom: config unreadable");
			},
		}).parseAsync(["up", "serpro-vpn", "--json"], { from: "user" });

		// A local config-read failure is diagnostic-only for `up` — it must not block the
		// attempt (unlike `status`, which genuinely needs the catalog to probe anything).
		expect(connectionUp).toHaveBeenCalledWith("serpro-vpn", 125_000);
		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output.ok).toBe(true);
	});

	// ─── up: undeclared name surfaces a clean error, not a stack trace ───────

	it("up on an undeclared name surfaces the sidecar's error clearly, not a stack trace", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => ({
			outcome: "undeclared",
			message: "no connection named 'nope' is declared in .refarm/config.json",
		}));

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(["up", "nope"], {
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

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(["up", "nope", "--json"], {
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

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(["up", "serpro-vpn"], {
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

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(["up", "serpro-vpn"], {
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

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(
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

	// ─── an aborted request is an honest timeout, never "the runtime is down" ────

	function abortError(): Error {
		return Object.assign(new Error("This operation was aborted."), { name: "AbortError" });
	}

	it("up: a request that ran past ITS OWN generous timeout reports an honest message — never a claim about whether it cancelled anything", async () => {
		// Re-review regression: the message used to assert "this request did not cancel
		// it" — stated as fact, when it is NOT knowable from the CLI: whether the
		// establish is still alive on the host cannot be determined from an aborted HTTP
		// request. The honest message says what IS actionable — check status, or force
		// it down — and claims nothing about cancellation either way.
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => {
			throw abortError();
		});

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(
			["up", "serpro-vpn"],
			{ from: "user" },
		);

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("may or may not still be establishing");
		expect(output).toContain("refarm connection status");
		expect(output).toContain("refarm connection down serpro-vpn");
		expect(output).not.toContain("did not cancel");
		expect(output).not.toContain("Refarm runtime is not running");
		expect(process.exitCode).toBe(1);
	});

	it("up: an aborted request reports connection-request-timed-out as JSON, with a real nextCommand and an honest message", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const connectionUp = vi.fn(async (): Promise<ConnectionOperatorOutcome> => {
			throw abortError();
		});

		await createConnectionCommand({ connectionUp, loadConfig: () => ({}) }).parseAsync(
			["up", "serpro-vpn", "--json"],
			{ from: "user" },
		);

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			ok: false,
			command: "connection",
			operation: "up",
			error: "connection-request-timed-out",
			nextCommand: "refarm connection status --json",
		});
		expect(output.message).toContain("may or may not still be establishing");
		expect(output.message).toContain("refarm connection down serpro-vpn");
		expect(output.message).not.toContain("did not cancel");
		expect(process.exitCode).toBe(1);
	});

	it("down: an aborted request also reports an honest timeout, not runtime-unavailable", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const connectionDown = vi.fn(async (): Promise<ConnectionDownOutcome> => {
			throw abortError();
		});

		await createConnectionCommand({ connectionDown }).parseAsync(["down", "serpro-vpn"], {
			from: "user",
		});

		const output = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("timed out");
		expect(output).not.toContain("Refarm runtime is not running");
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

			const result = await requestConnectionUp("serpro-vpn", 2_000);
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

			const result = await requestConnectionUp("nope", 2_000);
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

			const result = await requestConnectionUp("serpro-vpn", 2_000);
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

			await expect(requestConnectionUp("serpro-vpn", 2_000)).rejects.toThrow("fetch failed");
		});

		/** A `fetch` stand-in that resolves after `delayMs`, but honours `init.signal`
		 * exactly like real `fetch`/undici: an abort during the delay rejects immediately
		 * with an `AbortError`-shaped error, instead of the canned response. Needed
		 * because a plain `vi.fn().mockResolvedValue(...)` ignores the signal entirely,
		 * which would make a timeout regression invisible to a test built on one. */
		function delayedJsonFetch(delayMs: number, body: unknown, status = 200) {
			return vi.fn((_url: unknown, init?: RequestInit) => {
				return new Promise((resolve, reject) => {
					const timer = setTimeout(() => resolve(jsonResponse(body, status)), delayMs);
					const signal = init?.signal;
					if (!signal) return;
					const onAbort = () => {
						clearTimeout(timer);
						const reason: unknown = (signal as { reason?: unknown }).reason;
						reject(
							reason instanceof Error
								? reason
								: Object.assign(new Error("This operation was aborted."), {
										name: "AbortError",
									}),
						);
					};
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				});
			});
		}

		it(
			"CRITICAL-1 regression: does not abort a slow establish just because it runs past the sidecar client's bare 500ms default",
			async () => {
				// The OLD code called `fetchSidecarWithTimeout` for `up` with no `timeoutMs`
				// override, silently inheriting the sidecar client's own 500ms default
				// (`DEFAULT_SIDE_REQUEST_TIMEOUT_MS`) — far too short for
				// `POST /connections/:name/up`, which synchronously awaits the host's
				// establish (up to a declaration's `readyTimeoutMs`, 120s by default for a
				// phone-approval VPN). This fetch resolves at 600ms — well past that old
				// 500ms default. With an explicit, generous `timeoutMs` passed through (as
				// `printConnectionUp` now does via `resolveConnectionUpTimeoutMs`), this must
				// still succeed; against the old code (no override reaching
				// `fetchSidecarWithTimeout`) the real `AbortController` fires at 500ms first
				// and this exact test fails with an AbortError.
				vi.stubGlobal(
					"fetch",
					delayedJsonFetch(600, {
						name: "serpro-vpn",
						status: "up",
						sinceNs: 1,
						claims: 1,
						claim: 9,
					}),
				);

				const result = await requestConnectionUp("serpro-vpn", 5_000);
				expect(result).toEqual({
					outcome: "ok",
					state: { name: "serpro-vpn", status: "up", sinceNs: 1, claims: 1, claim: 9 },
				});
			},
			10_000,
		);
	});
});
