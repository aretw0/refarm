import { describe, expect, it } from "vitest";

import {
	readConnectionCatalog,
	resolveBinary,
} from "../../src/commands/connection-catalog.js";

const VPN = {
	connections: {
		"serpro-vpn": {
			establish: ["serpro-vpn", "connect"],
			probe: { run: ["ip", "-br", "link", "show", "ovpntun0"], expect: "UP" },
		},
	},
};

describe("reading the declared connection catalog", () => {
	it("reads a declaration and fills the documented defaults", () => {
		const { connections, issues } = readConnectionCatalog(VPN);
		expect(issues).toEqual([]);
		expect(connections).toHaveLength(1);
		const vpn = connections[0]!;
		expect(vpn.name).toBe("serpro-vpn");
		expect(vpn.establish).toEqual(["serpro-vpn", "connect"]);
		expect(vpn.probe.run[0]).toBe("ip");
		expect(vpn.probe.expect).toBe("UP");
		expect(vpn.readyTimeoutMs).toBe(120_000);
		expect(vpn.probeIntervalMs).toBe(1_000);
		expect(vpn.linger).toBe("operator");
	});

	it("returns an empty catalog when nothing is declared", () => {
		expect(readConnectionCatalog({})).toEqual({ connections: [], issues: [] });
	});

	it("reports a malformed declaration instead of dropping it", () => {
		// The host fails shut because it is about to RUN this. The operator surface
		// must still show the connection, or debugging it is impossible.
		const { connections, issues } = readConnectionCatalog({
			connections: { broken: { establish: [], probe: { run: ["true"] } } },
		});
		expect(connections.map((c) => c.name)).toContain("broken");
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "broken", field: "establish" }),
		);
	});

	it("reports a missing probe, because readiness is the probe", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"] } },
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "probe" }));
	});

	it("reports a shell-like probe binary by basename", () => {
		for (const shell of ["sh", "/bin/sh", "bash", "env"]) {
			const { issues } = readConnectionCatalog({
				connections: { c: { establish: ["bin"], probe: { run: [shell, "-c", "x | y"] } } },
			});
			expect(
				issues.some((i) => i.connection === "c" && /shell/i.test(i.message)),
				`expected a shell issue for ${shell}`,
			).toBe(true);
		}
	});

	it("reports a probe.shell key as needing an operator grant", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"], probe: { run: ["true"], shell: "a | b" } } },
		});
		expect(issues.some((i) => /grant/i.test(i.message))).toBe(true);
	});

	it("reports a non-zero idle linger as not implemented", () => {
		const { issues } = readConnectionCatalog({
			connections: {
				c: { establish: ["bin"], probe: { run: ["true"] }, linger: { idleMs: 60_000 } },
			},
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "linger" }));
	});

	it("reports a legacy `ready`/`fail` field as no longer supported", () => {
		const { issues } = readConnectionCatalog({
			connections: {
				c: { establish: ["bin"], probe: { run: ["true"] }, ready: "up", fail: "down" },
			},
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "ready" }));
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "fail" }));
	});

	it("reports a `prompts` block as not supported yet", () => {
		const { issues } = readConnectionCatalog({
			connections: {
				c: {
					establish: ["bin"],
					probe: { run: ["true"] },
					prompts: [{ match: "user:", answer: "operator" }],
				},
			},
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "prompts" }));
	});

	it("reports a connection name that exceeds the length cap", () => {
		const longName = "x".repeat(129);
		const { issues } = readConnectionCatalog({
			connections: { [longName]: { establish: ["bin"], probe: { run: ["true"] } } },
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: longName, field: "name" }));
	});

	it("reports too many declared connections, but still lists every one of them", () => {
		const connections = Object.fromEntries(
			Array.from({ length: 33 }, (_, i) => [
				`c${i}`,
				{ establish: ["bin"], probe: { run: ["true"] } },
			]),
		);
		const { connections: parsed, issues } = readConnectionCatalog({ connections });
		expect(parsed).toHaveLength(33);
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "(connections)", field: "connections" }),
		);
	});

	it("reports a non-array probe.run", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"], probe: { run: "true" } } },
		});
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "probe.run" }));
	});

	it("reports a probe.expect pattern that exceeds the length cap", () => {
		const longPattern = "a".repeat(513);
		const { connections, issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"], probe: { run: ["true"], expect: longPattern } } },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "probe.expect" }),
		);
		expect(connections[0]!.probe.expect).toBeUndefined();
	});

	it("reports a probe.expect pattern that does not compile as a regex", () => {
		const { connections, issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"], probe: { run: ["true"], expect: "(" } } },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "probe.expect" }),
		);
		expect(connections[0]!.probe.expect).toBeUndefined();
	});

	it("flags a probe.expect pattern using a JS-only regex construct the host's Rust engine rejects", () => {
		// Lookahead compiles fine in JS's RegExp but the host's Rust `regex` crate has no
		// lookaround support at all, so this would fail shut on the host.
		const { connections, issues } = readConnectionCatalog({
			connections: { c: { establish: ["bin"], probe: { run: ["true"], expect: "UP(?=d)" } } },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "probe.expect" }),
		);
		// Still usable locally — the value is kept for display since JS can compile it,
		// even though the host will refuse to run this connection.
		expect(connections[0]!.probe.expect).toBe("UP(?=d)");
	});
});

describe("validating notice rules (mirrors the Rust parser, but reports)", () => {
	const base = { establish: ["bin"], probe: { run: ["true"] } };

	it("reports a non-array notices block, but still lists the connection", () => {
		const { connections, issues } = readConnectionCatalog({
			connections: { c: { ...base, notices: "oops" } },
		});
		expect(connections.map((c) => c.name)).toContain("c");
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "notices" }));
	});

	it("reports a notice entry that is not an object", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { ...base, notices: ["not-an-object"] } },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "notices[0]" }),
		);
	});

	it("reports a notice entry missing a string pattern", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { ...base, notices: [{ message: "hi" }] } },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "notices[0].pattern" }),
		);
	});

	it("reports a notice entry missing a string message", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { ...base, notices: [{ pattern: "hi" }] } },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "notices[0].message" }),
		);
	});

	it("reports a notice pattern that exceeds the length cap", () => {
		const { issues } = readConnectionCatalog({
			connections: {
				c: { ...base, notices: [{ pattern: "a".repeat(513), message: "hi" }] },
			},
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "notices[0].pattern" }),
		);
	});

	it("reports a notice pattern that does not compile as a regex", () => {
		const { issues } = readConnectionCatalog({
			connections: { c: { ...base, notices: [{ pattern: "(", message: "hi" }] } },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ connection: "c", field: "notices[0].pattern" }),
		);
	});

	it("reports more than the max number of notice rules, but still lists the connection", () => {
		const notices = Array.from({ length: 17 }, (_, i) => ({ pattern: `p${i}`, message: `m${i}` }));
		const { connections, issues } = readConnectionCatalog({
			connections: { c: { ...base, notices } },
		});
		expect(connections.map((c) => c.name)).toContain("c");
		expect(issues).toContainEqual(expect.objectContaining({ connection: "c", field: "notices" }));
	});
});

describe("resolving a declared binary", () => {
	it("resolves an absolute path that exists", () => {
		expect(resolveBinary("/usr/bin/true")).toBe("/usr/bin/true");
	});

	it("returns null for an absolute path that does not exist", () => {
		expect(resolveBinary("/usr/bin/definitely-not-here-xyz")).toBeNull();
	});

	it("finds a bare name on PATH", () => {
		expect(resolveBinary("true", { PATH: "/usr/bin:/bin" } as NodeJS.ProcessEnv)).toBe(
			"/usr/bin/true",
		);
	});

	it("returns null for a bare name that is not on PATH", () => {
		expect(resolveBinary("definitely-not-here-xyz", { PATH: "/usr/bin" } as NodeJS.ProcessEnv))
			.toBeNull();
	});

	it("returns null rather than throwing when PATH is unset", () => {
		expect(resolveBinary("true", {} as NodeJS.ProcessEnv)).toBeNull();
	});
});
