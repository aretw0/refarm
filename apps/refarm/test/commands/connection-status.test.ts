import { accessSync, constants as fsConstants } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
	connectionStatusNextActions,
	connectionStatusNextCommands,
	createConnectionCommand,
	printConnectionReports,
	reportConnections,
	runProbeProcess,
	type ConnectionReport,
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
// The probe-timeout test needs a binary that reliably outlives a short deadline.
requireBinary("/usr/bin/sleep");
// The output-cap test needs a binary that emits more than 1 MiB and then exits cleanly.
requireBinary("/usr/bin/dd");

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
			runProbe: async () => ({ outcome: "up" }),
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
			runProbe: async () => ({ outcome: "down", detail: "interface exists but is DOWN" }),
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
				return { outcome: "up" };
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
			runProbe: async () => ({ outcome: "up" }),
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
				return { outcome: "up" };
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
				return { outcome: "up" };
			},
		});
		expect(probeCalled).toBe(false);
		expect(reports[0]).toMatchObject({ name: "broken", state: "unknown" });
	});

	it("reports unknown, without probing, when a spawn-time guard the HOST enforces is violated", async () => {
		// `enforce_spawn_env` refuses this env key before the host ever forks, and
		// `run_probe` swallows that into `false` — so the host is permanently `down` here.
		// Spawning it locally (Node has no such guard) and reporting `up` is the lie that
		// runs the dangerous way. `unknown` is the honest answer and points at the fix.
		let probeCalled = false;
		const { connections: reports } = await reportConnections({
			config: {
				connections: {
					vpn: {
						establish: ["/usr/bin/true"],
						probe: { run: ["/usr/bin/true"] },
						env: { "1BAD": "x" },
					},
				},
			},
			runProbe: async () => {
				probeCalled = true;
				return { outcome: "up" };
			},
		});
		expect(probeCalled).toBe(false);
		expect(reports[0]).toMatchObject({ name: "vpn", state: "unknown" });
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
			runProbe: async () => ({ outcome: "up" }),
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
		const report = await reportConnections({ config: {}, runProbe: async () => ({ outcome: "up" }) });
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
			runProbe: async () => ({ outcome: "up" }),
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
	it("resolves up for a probe that exits 0", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/true"] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("up");
	});

	it("resolves down for a probe that exits non-zero", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/false"] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("down");
		expect(result.detail).toMatch(/exited with code/);
	});

	it("resolves down when the process exits 0 but the expected pattern does not match", async () => {
		// This is the exact case the design calls out: an interface that EXISTS still
		// exits zero even while printing DOWN — exit-code-only would misreport this as up.
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/echo", "DOWN"], expect: "\\bUP\\b" } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("down");
		expect(result.detail).toMatch(/did not match/);
	});

	it("resolves up when the process exits 0 and the expected pattern matches combined output", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["/usr/bin/echo", "tunnel is UP"], expect: "\\bUP\\b" } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("up");
	});

	it("resolves unknown — not down — rather than throwing or hanging, for a missing binary", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: ["definitely-not-a-real-binary-xyz"] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		// "I could not ask" — never `down`, which would send the operator to re-establish a
		// tunnel that may be perfectly up.
		expect(result.outcome).toBe("unknown");
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
			expect(result.outcome).toBe("down");
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
		expect(result.outcome).toBe("up");
	});

	// --- The three states must not collapse at spawn time. `child.on("error")` fires for
	// everything that stops the process from EXISTING; none of it says anything about the
	// tunnel, so none of it may report `down`.

	it("resolves unknown when the spawn itself fails — a cwd that does not exist", async () => {
		// The operator's most likely version of this is a typo in `cwd`. Reporting `down`
		// would paint every connection red and point them at a re-establish they do not need.
		const result = await runProbeProcess(
			connection({
				probe: { run: ["/usr/bin/true"] },
				cwd: "/definitely/not/a/real/directory/xyz",
			}),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("unknown");
		expect(result.detail).toMatch(/could not be started/);
	});

	it("resolves unknown, not down, when probe.run is empty — there is nothing to ask", async () => {
		const result = await runProbeProcess(
			connection({ probe: { run: [] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("unknown");
	});

	it("caps probe output at 1 MiB per stream, with the host's own truncation marker", async () => {
		// `read_spawn_pipe_limited` in the host keeps the first MAX_SPAWN_STDIO_LEN bytes and
		// appends this exact marker. Without a cap here, a runaway probe grows this process's
		// heap for as long as the timeout allows.
		const result = await runProbeProcess(
			connection({
				probe: {
					run: ["/usr/bin/dd", "if=/dev/zero", "bs=1024", "count=2048"],
					expect: "truncated: spawn output exceeded limit",
				},
			}),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("up");
	});

	it("resolves DOWN on timeout — matching the host, where a timed-out probe is not healthy", async () => {
		// `run_probe` folds `timed_out` into the same `false` a non-zero exit produces. This
		// is the one non-answer that is deliberately NOT `unknown`.
		const result = await runProbeProcess(connection({ probe: { run: ["/usr/bin/sleep", "5"] } }), 150);
		expect(result.outcome).toBe("down");
		expect(result.detail).toMatch(/timed out/);
	});

	it("resolves DOWN — not up — when the probe process is killed by a signal (host parity: unwrap_or(-1))", async () => {
		// No timeout involved: this process kills ITSELF with SIGKILL, so `close` reports
		// `code: null`. The boundary must fall back to a non-zero `exitCode` (mirroring the
		// host's `status.code().unwrap_or(-1)`), never `0` — a `0` fallback here would make
		// an exited-via-signal probe (e.g. OOM-killed, segfaulted) look like a clean,
		// healthy exit and report `up` for a connection that answered nothing.
		const args = ["-e", "process.kill(process.pid, 'SIGKILL')"];
		const result = await runProbeProcess(
			connection({ probe: { run: [process.execPath, ...args] } }),
			REAL_PROBE_TIMEOUT_MS,
		);
		expect(result.outcome).toBe("down");
		expect(result.detail).toMatch(/exited with code/);
	});
});

describe("connectionStatusNextCommands / connectionStatusNextActions (the operator handoff)", () => {
	function report(overrides: Partial<ConnectionReport> = {}): ConnectionReport {
		return {
			name: "vpn",
			establish: ["serpro-vpn", "connect"],
			establishBinary: null,
			probeBinary: "/usr/bin/true",
			state: "up",
			issues: [],
			...overrides,
		};
	}

	// CLAUDE.md §4 makes `nextCommands` a promise that the command RUNS. Nothing this
	// surface can name today keeps that promise, so it emits nothing — for every state.

	it("emits no next-command for an up connection", () => {
		expect(connectionStatusNextCommands([report({ state: "up" })])).toEqual([]);
	});

	it("emits no next-command for a down connection — there is no generic re-establish command", () => {
		// The old code emitted `refarm workspace run <workspace> serpro-vpn connect`, which
		// cannot run: `workspace run` resolves a NAMED entry from a workspace's declared
		// command allowlist, not an argv, and `<workspace>` was never filled in.
		expect(connectionStatusNextCommands([report({ state: "down" })])).toEqual([]);
	});

	it("emits no next-command for an unknown connection", () => {
		expect(connectionStatusNextCommands([report({ state: "unknown" })])).toEqual([]);
	});

	it("emits no next-command for a mixed report, and none for an empty one", () => {
		expect(
			connectionStatusNextCommands([
				report({ name: "a", state: "up" }),
				report({ name: "b", state: "down" }),
				report({ name: "c", state: "unknown" }),
			]),
		).toEqual([]);
		expect(connectionStatusNextCommands([])).toEqual([]);
	});

	it("never emits a `workspace run` handoff, which is the command that could not run", () => {
		const commands = connectionStatusNextCommands([
			report({ state: "down" }),
			report({ state: "unknown" }),
		]);
		expect(commands.some((c) => c.includes("workspace run"))).toBe(false);
		expect(commands.some((c) => c.includes("<workspace>"))).toBe(false);
	});

	// The remedy still has to reach the operator — as prose, which is read, not executed.

	it("says nothing for an up connection", () => {
		expect(connectionStatusNextActions([report({ state: "up" })])).toEqual([]);
	});

	it("names the declared establish argv for a down connection, as information", () => {
		const [action] = connectionStatusNextActions([report({ state: "down" })]);
		expect(action).toContain("vpn");
		expect(action).toContain("serpro-vpn connect");
	});

	it("gives an unknown connection the install/PATH/declaration remedy", () => {
		const [action] = connectionStatusNextActions([report({ state: "unknown" })]);
		expect(action).toMatch(/could not be probed/);
		expect(action).toMatch(/install the binary/);
		expect(action).toMatch(/PATH/);
		expect(action).toMatch(/config\.json/);
	});
});

describe("printConnectionReports (the human output — the surface an operator actually reads)", () => {
	function capture(fn: () => void): string {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			fn();
			return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		} finally {
			logSpy.mockRestore();
		}
	}

	function report(overrides: Partial<ConnectionReport> = {}): ConnectionReport {
		return {
			name: "vpn",
			establish: ["serpro-vpn", "connect"],
			establishBinary: null,
			probeBinary: "/usr/bin/true",
			state: "up",
			issues: [],
			...overrides,
		};
	}

	it("prints an up connection with no reason and no remedy — there is nothing to fix", () => {
		const output = capture(() =>
			printConnectionReports({ connections: [report({ state: "up" })], catalogIssues: [] }),
		);
		expect(output).toContain("vpn");
		expect(output).toContain("up");
		expect(output).not.toMatch(/fix:/);
	});

	it("prints a down connection with the reason the probe gave", () => {
		const output = capture(() =>
			printConnectionReports({
				connections: [report({ state: "down", detail: "probe exited with code 1" })],
				catalogIssues: [],
			}),
		);
		expect(output).toContain("down");
		expect(output).toContain("probe exited with code 1");
		// `down` means the tunnel, not the setup — it must not carry the setup remedy.
		expect(output).not.toMatch(/install the binary/);
	});

	it("gives an unknown connection a one-line remedy — accurate but terminal is not enough", () => {
		// This is the FIRST state the operator meets: on their machine `serpro-vpn` is not
		// on PATH. Without this line they get a colour and no move.
		const output = capture(() =>
			printConnectionReports({
				connections: [
					report({ state: "unknown", detail: "probe binary not found: serpro-vpn" }),
				],
				catalogIssues: [],
			}),
		);
		expect(output).toContain("unknown");
		expect(output).toContain("probe binary not found: serpro-vpn");
		expect(output).toMatch(/install the binary/);
		expect(output).toMatch(/PATH/);
		expect(output).toMatch(/config\.json/);
	});

	it("prints declaration issues and catalog-level issues alongside the states", () => {
		const output = capture(() =>
			printConnectionReports({
				connections: [
					report({
						state: "unknown",
						issues: [{ connection: "vpn", field: "env", message: "env['V'] must be ASCII" }],
					}),
				],
				catalogIssues: [
					{ connection: "(connections)", field: "connections", message: "too many connections" },
				],
			}),
		);
		expect(output).toContain("env['V'] must be ASCII");
		expect(output).toContain("too many connections");
	});

	it("says so when nothing is declared, instead of printing an empty list", () => {
		const output = capture(() =>
			printConnectionReports({ connections: [], catalogIssues: [] }),
		);
		expect(output).toMatch(/none declared/);
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
				runProbe: async () => ({ outcome: "up" }),
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
				runProbe: async () => ({ outcome: "up" }),
			}).parseAsync(["status", "--json"], { from: "user" });

			const output: unknown = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
			expect(output).toMatchObject({ ok: true, connections: [] });
		} finally {
			logSpy.mockRestore();
		}
	});

	it("emits an EMPTY nextCommands and a prose nextAction for a down connection", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await createConnectionCommand({
				loadConfig: () => ({
					connections: {
						vpn: { establish: ["/usr/bin/true", "connect"], probe: { run: ["/usr/bin/true"] } },
					},
				}),
				runProbe: async () => ({ outcome: "down", detail: "interface is DOWN" }),
			}).parseAsync(["status", "--json"], { from: "user" });

			const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
				nextCommand: string | null;
				nextCommands: string[];
				nextAction: string | null;
			};
			// Nothing runnable exists — an agent following CLAUDE.md §4 must not be handed a
			// command that fails.
			expect(output.nextCommands).toEqual([]);
			expect(output.nextCommand).toBeNull();
			// The remedy still reaches the operator, as prose.
			expect(output.nextAction).toContain("vpn");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("prints the human report, with the unknown remedy, when --json is absent", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await createConnectionCommand({
				loadConfig: () => ({
					connections: {
						vpn: {
							establish: ["definitely-not-a-real-binary-xyz"],
							probe: { run: ["definitely-not-a-real-binary-xyz"] },
						},
					},
				}),
				runProbe: async () => ({ outcome: "up" }),
			}).parseAsync(["status"], { from: "user" });

			const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
			expect(output).toContain("vpn");
			expect(output).toContain("unknown");
			expect(output).toMatch(/install the binary/);
		} finally {
			logSpy.mockRestore();
		}
	});
});
