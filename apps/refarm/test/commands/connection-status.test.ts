import { accessSync, constants as fsConstants } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
	createConnectionCommand,
	reportConnections,
	runProbeProcess,
} from "../../src/commands/connection.js";
import type { DeclaredConnection } from "../../src/commands/connection-catalog.js";

/** These tests assert against the REAL system, so they must not silently pass by never
 * actually exercising `runProbeProcess` against something real. If any binary is
 * missing, fail loudly with a clear message rather than a cryptic spawn error deep in
 * a `close`/`error` handler. */
function requireBinary(path: string): void {
	try {
		accessSync(path, fsConstants.X_OK);
	} catch {
		throw new Error(
			`${path} is required for this test but is not present/executable on this host`,
		);
	}
}
requireBinary("/usr/bin/true");
requireBinary("/usr/bin/false");
requireBinary("/usr/bin/echo");
// `env` prints its own received environment with no args and no shell — the binary this
// suite uses to prove env-parity with the host's `run_probe` (env_clear + declared env
// only). Verified present rather than assumed, same as the three binaries above.
requireBinary("/usr/bin/env");

/** A minimal, otherwise-valid `DeclaredConnection` — every test overrides just the
 * field(s) it's exercising, so nothing here needs to change when unrelated fields do. */
function connection(overrides: Partial<DeclaredConnection> = {}): DeclaredConnection {
	return {
		name: "c",
		establish: ["/usr/bin/true"],
		probe: { run: ["/usr/bin/true"] },
		env: {},
		readyTimeoutMs: 1_000,
		probeIntervalMs: 100,
		linger: "operator",
		...overrides,
	};
}

const REAL_PROBE_TIMEOUT_MS = 2_000;

describe("reportConnections (hermetic — an injected probe runner, no process ever spawned)", () => {
	it("reports up when the injected probe succeeds", async () => {
		const { connections: reports } = await reportConnections({
			config: {
				connections: {
					vpn: { establish: ["serpro-vpn", "connect"], probe: { run: ["ip", "link"] } },
				},
			},
			runProbe: async () => ({ ok: true }),
		});
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ name: "vpn", state: "up" });
		expect(reports[0]!.detail).toBeUndefined();
	});

	it("reports down when the injected probe runs and fails", async () => {
		const { connections: reports } = await reportConnections({
			config: {
				connections: {
					vpn: { establish: ["serpro-vpn", "connect"], probe: { run: ["ip", "link"] } },
				},
			},
			runProbe: async () => ({ ok: false, detail: "interface exists but is DOWN" }),
		});
		expect(reports[0]).toMatchObject({
			name: "vpn",
			state: "down",
			detail: "interface exists but is DOWN",
		});
	});

	it("reports unknown, and never calls the probe, when the probe binary does not resolve", async () => {
		let probeCalled = false;
		const { connections: reports } = await reportConnections({
			config: {
				connections: {
					vpn: {
						establish: ["serpro-vpn", "connect"],
						probe: { run: ["definitely-not-a-real-binary-xyz"] },
					},
				},
			},
			runProbe: async () => {
				probeCalled = true;
				return { ok: true };
			},
		});
		expect(probeCalled).toBe(false);
		expect(reports[0]).toMatchObject({ name: "vpn", state: "unknown", probeBinary: null });
		expect(reports[0]!.detail).toMatch(/binary not found/);
	});

	it("lists a declaration with issues, with its issues attached, instead of dropping it — and does NOT let a non-probe issue block probing", async () => {
		const { connections: reports } = await reportConnections({
			config: {
				connections: {
					// `establish` is empty — a catalog issue — but it is not a PROBE issue, so
					// the connection must still be probed normally: an unrelated issue must not
					// silently collapse the state to `unknown`.
					broken: { establish: [], probe: { run: ["/usr/bin/true"] } },
				},
			},
			runProbe: async () => ({ ok: true }),
		});
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ name: "broken", state: "up" });
		expect(reports[0]!.issues).toContainEqual(
			expect.objectContaining({ connection: "broken", field: "establish" }),
		);
	});

	it("reports unknown, without calling the probe, when the declaration's probe itself is unrunnable", async () => {
		// probe.run is empty — a catalog issue on the field the probe would need to spawn.
		let probeCalled = false;
		const { connections: reports } = await reportConnections({
			config: {
				connections: { broken: { establish: ["/usr/bin/true"], probe: { run: [] } } },
			},
			runProbe: async () => {
				probeCalled = true;
				return { ok: true };
			},
		});
		expect(probeCalled).toBe(false);
		expect(reports[0]).toMatchObject({ name: "broken", state: "unknown" });
		expect(reports[0]!.issues).toContainEqual(
			expect.objectContaining({ connection: "broken", field: "probe.run" }),
		);
	});

	it("reports unknown, without calling the probe, for a shell-like probe binary even if it resolves", async () => {
		// `sh` resolves on PATH just fine — the catalog reader flags it as a shell escape,
		// and probing it anyway would run exactly the shell invocation this exists to
		// prevent. This is the case `BLOCKING_PROBE_ISSUE_FIELDS` exists for.
		let probeCalled = false;
		const { connections: reports } = await reportConnections({
			config: {
				connections: {
					broken: {
						establish: ["/usr/bin/true"],
						probe: { run: ["sh", "-c", "echo up"] },
					},
				},
			},
			runProbe: async () => {
				probeCalled = true;
				return { ok: true };
			},
		});
		expect(probeCalled).toBe(false);
		expect(reports[0]).toMatchObject({ name: "broken", state: "unknown" });
	});

	it("reports a connection whose establish binary is missing, rather than omitting it", async () => {
		const { connections: reports } = await reportConnections({
			config: {
				connections: {
					vpn: {
						establish: ["definitely-not-a-real-binary-xyz"],
						probe: { run: ["/usr/bin/true"] },
					},
				},
			},
			runProbe: async () => ({ ok: true }),
		});
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			name: "vpn",
			establishBinary: null,
			// The establish binary being missing does not block PROBING — the probe asks
			// whether the connection is already up, independent of whether it could be
			// (re-)established right now.
			state: "up",
		});
	});

	it("reports an empty catalog cleanly", async () => {
		const report = await reportConnections({ config: {}, runProbe: async () => ({ ok: true }) });
		expect(report).toEqual({ connections: [], catalogIssues: [] });
	});

	it("surfaces a catalog-level issue (too many declared connections) even though no single connection owns it", async () => {
		const manyConnections = Object.fromEntries(
			Array.from({ length: 33 }, (_, i) => [
				`c${i}`,
				{ establish: ["/usr/bin/true"], probe: { run: ["/usr/bin/true"] } },
			]),
		);
		const { connections, catalogIssues } = await reportConnections({
			config: { connections: manyConnections },
			runProbe: async () => ({ ok: true }),
		});
		// Every declared connection is STILL listed — the cap issue is additional
		// information, not a reason to drop anything.
		expect(connections).toHaveLength(33);
		expect(catalogIssues).toContainEqual(
			expect.objectContaining({ connection: "(connections)", field: "connections" }),
		);
	});

	it("surfaces a catalog-level issue when the `connections` block itself is malformed", async () => {
		const { connections, catalogIssues } = await reportConnections({
			config: { connections: "not-an-object" },
			runProbe: async () => {
				throw new Error("must not be called — there is nothing valid to probe");
			},
		});
		expect(connections).toEqual([]);
		expect(catalogIssues).toContainEqual(
			expect.objectContaining({ connection: "(connections)", field: "connections" }),
		);
	});
});

describe("runProbeProcess (the real adapter — exercised against real binaries, bounded by a timeout)", () => {
	it("resolves ok:true for a probe that exits 0", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/true"] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.ok).toBe(true);
	});

	it("resolves ok:false for a probe that exits non-zero", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/false"] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.ok).toBe(false);
		expect(result.detail).toMatch(/exited with code/);
	});

	it("resolves ok:false when the process exits 0 but the expected pattern does not match", async () => {
		// This is the exact case the design calls out: an interface that EXISTS still
		// exits zero even while printing DOWN — exit-code-only would misreport this as up.
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/echo", "DOWN"], expect: "\\bUP\\b" } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.ok).toBe(false);
		expect(result.detail).toMatch(/did not match/);
	});

	it("resolves ok:true when the process exits 0 and the expected pattern matches combined output", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/echo", "tunnel is UP"], expect: "\\bUP\\b" } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.ok).toBe(true);
	});

	it("resolves ok:false, rather than throwing or hanging, for a missing binary", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["definitely-not-a-real-binary-xyz"] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.ok).toBe(false);
	});

	// --- Env parity with the host's `run_probe` (core.rs's `spawn_process` does
	// `.env_clear().envs(env)` — the child gets ONLY the declared env, nothing
	// inherited). A probe whose verdict depends on an inherited-but-undeclared variable
	// must behave identically here and on the host, or this command's entire purpose
	// (telling the operator what the host would find) is defeated. `true`/`false`/`echo`
	// don't read the environment, so this gap needed its own binary: `env` with no
	// arguments prints exactly the environment IT received, with no shell involved.

	it("does NOT leak an inherited-but-undeclared env var into the probe (parity with the host's env_clear)", async () => {
		const marker = "REFARM_CONNECTION_TEST_ENV_LEAK_MARKER";
		const previous = process.env[marker];
		process.env[marker] = "leaked-from-parent";
		try {
			const result = await runProbeProcess(
				connection({
					probe: { run: ["/usr/bin/env"], expect: marker },
					env: {}, // deliberately does NOT declare the marker
				}),
				REAL_PROBE_TIMEOUT_MS,
			);
			// Under the old `{ ...process.env, ...connection.env }` merge, `env` would print
			// this inherited variable and `expect` would match — reporting `up` for a probe
			// the host's env_clear()'d run_probe would report `down` for. That disagreement
			// with the engine is exactly what this test guards against.
			expect(result.ok).toBe(false);
		} finally {
			if (previous === undefined) delete process.env[marker];
			else process.env[marker] = previous;
		}
	});

	it("makes the DECLARED env visible to the probe — env is passed through, not just cleared", async () => {
		const result = await runProbeProcess(
			connection({
				probe: { run: ["/usr/bin/env"], expect: "REFARM_CONNECTION_TEST_ENV_MARKER=hello" },
				env: { REFARM_CONNECTION_TEST_ENV_MARKER: "hello" },
			}),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.ok).toBe(true);
	});
});

describe("createConnectionCommand (the full command — JSON envelope + injected deps)", () => {
	it("prints a JSON envelope with ok, command:'connection', operation:'status', and a connections array", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await createConnectionCommand({
				loadConfig: () => ({
					connections: {
						vpn: { establish: ["/usr/bin/true"], probe: { run: ["/usr/bin/true"] } },
					},
				}),
				runProbe: async () => ({ ok: true }),
			}).parseAsync(["status", "--json"], { from: "user" });

			expect(logSpy).toHaveBeenCalledTimes(1);
			const output: unknown = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
			expect(output).toMatchObject({
				ok: true,
				command: "connection",
				operation: "status",
				connections: [expect.objectContaining({ name: "vpn", state: "up" })],
			});
		} finally {
			logSpy.mockRestore();
		}
	});

	it("prints an empty connections array cleanly when nothing is declared", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await createConnectionCommand({
				loadConfig: () => ({}),
				runProbe: async () => ({ ok: true }),
			}).parseAsync(["status", "--json"], { from: "user" });

			const output: unknown = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
			expect(output).toMatchObject({ ok: true, connections: [] });
		} finally {
			logSpy.mockRestore();
		}
	});
});
