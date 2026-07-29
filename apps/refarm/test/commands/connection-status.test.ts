import { accessSync, constants as fsConstants } from "node:fs";
import { describe, expect, it } from "vitest";

import { reportConnections, runProbeProcess } from "../../src/commands/connection.js";
import type { DeclaredConnection } from "../../src/commands/connection-catalog.js";

/** These tests assert against the REAL system, so they must not silently pass by never
 * actually exercising `runProbeProcess` against something real. If either binary is
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
		const reports = await reportConnections({
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
		const reports = await reportConnections({
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
		const reports = await reportConnections({
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

	it("lists a declaration with issues, with its issues attached, instead of dropping it", async () => {
		const reports = await reportConnections({
			config: {
				connections: {
					// `establish` is empty — a catalog issue — but the connection must still
					// appear so the operator can see and fix it.
					broken: { establish: [], probe: { run: ["/usr/bin/true"] } },
				},
			},
			runProbe: async () => ({ ok: true }),
		});
		expect(reports).toHaveLength(1);
		expect(reports[0]!.name).toBe("broken");
		expect(reports[0]!.issues).toContainEqual(
			expect.objectContaining({ connection: "broken", field: "establish" }),
		);
	});

	it("reports unknown, without calling the probe, when the declaration's probe itself is unrunnable", async () => {
		// probe.run is empty — a catalog issue on the field the probe would need to spawn.
		let probeCalled = false;
		const reports = await reportConnections({
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
		const reports = await reportConnections({
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
		const reports = await reportConnections({
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
		const reports = await reportConnections({ config: {}, runProbe: async () => ({ ok: true }) });
		expect(reports).toEqual([]);
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
});
