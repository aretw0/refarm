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

/**
 * The host runs three guards BEFORE it spawns anything (`enforce_shell_allowlist`,
 * `enforce_spawn_env`, `enforce_spawn_cwd` in `host_effects_bridge`), and `run_probe`
 * swallows their error into `false`. A declaration that trips one of them is permanently
 * down on the host — so it must not read as clean here, or `connection status` reports
 * `up` for something the engine can never even ask about.
 */
describe("spawn-time policy parity with the host", () => {
	/** Build a config around one connection, overriding just the field under test. */
	function declare(overrides: Record<string, unknown>): Record<string, unknown> {
		return {
			connections: {
				c: { establish: ["true"], probe: { run: ["true"] }, ...overrides },
			},
		};
	}

	function fieldIssues(config: Record<string, unknown>, field: string): string[] {
		return readConnectionCatalog(config)
			.issues.filter((issue) => issue.field === field)
			.map((issue) => issue.message);
	}

	it("accepts a declaration that satisfies every spawn guard", () => {
		const { issues } = readConnectionCatalog(
			declare({ env: { OVPN_PROFILE: "serpro" }, cwd: "/tmp" }),
		);
		expect(issues).toEqual([]);
	});

	// ── env keys ──────────────────────────────────────────────────────────────

	it("reports an env key outside [A-Za-z_][A-Za-z0-9_]*", () => {
		expect(fieldIssues(declare({ env: { "1BAD": "x" } }), "env")).toEqual([
			expect.stringContaining("not a valid spawn env key"),
		]);
		expect(fieldIssues(declare({ env: { "WITH-DASH": "x" } }), "env")).toEqual([
			expect.stringContaining("not a valid spawn env key"),
		]);
	});

	it("reports an env key over 128 bytes", () => {
		expect(fieldIssues(declare({ env: { ["A".repeat(129)]: "x" } }), "env")).toEqual([
			expect.stringContaining("not a valid spawn env key"),
		]);
		// 128 is the cap, not a violation.
		expect(fieldIssues(declare({ env: { ["A".repeat(128)]: "x" } }), "env")).toEqual([]);
	});

	it("reports env keys that differ only in case — the host compares them case-insensitively", () => {
		expect(fieldIssues(declare({ env: { PATH: "/usr/bin", Path: "/bin" } }), "env")).toEqual([
			expect.stringContaining("duplicate keys"),
		]);
	});

	it("reports more than 128 env vars", () => {
		const env = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`V${i}`, "x"]));
		expect(fieldIssues(declare({ env }), "env")).toEqual([
			expect.stringContaining("too many variables"),
		]);
	});

	// ── env values ────────────────────────────────────────────────────────────

	it("reports an env value over 4096 bytes", () => {
		expect(fieldIssues(declare({ env: { V: "x".repeat(4097) } }), "env")).toEqual([
			expect.stringContaining("exceeds max length"),
		]);
	});

	it("reports a non-ASCII env value", () => {
		expect(fieldIssues(declare({ env: { V: "conexão" } }), "env")).toEqual([
			expect.stringContaining("must be ASCII"),
		]);
	});

	it("reports an env value with surrounding whitespace", () => {
		expect(fieldIssues(declare({ env: { V: " padded" } }), "env")).toEqual([
			expect.stringContaining("surrounding whitespace"),
		]);
	});

	it("reports an env value with interior whitespace — the host forbids any at all", () => {
		expect(fieldIssues(declare({ env: { V: "two words" } }), "env")).toEqual([
			expect.stringContaining("must not contain whitespace"),
		]);
	});

	it("reports an env value with control characters", () => {
		expect(fieldIssues(declare({ env: { V: "a\u0001b" } }), "env")).toEqual([
			expect.stringContaining("control characters"),
		]);
	});

	it("counts env length in BYTES, like the host's str::len(), not UTF-16 units", () => {
		// 2049 two-byte characters = 4098 bytes but only 2049 `String.length` units. Judged
		// by `String.length` this passes; judged by the host's ruler it does not.
		const value = "é".repeat(2049);
		expect(value.length).toBeLessThan(4096);
		expect(fieldIssues(declare({ env: { V: value } }), "env")).toContainEqual(
			expect.stringContaining("exceeds max length"),
		);
	});

	// ── argv ──────────────────────────────────────────────────────────────────

	it("reports an argv with more than 128 entries", () => {
		const run = ["true", ...Array.from({ length: 128 }, () => "-x")];
		expect(fieldIssues(declare({ probe: { run } }), "probe.run")).toContainEqual(
			expect.stringContaining("too many entries"),
		);
	});

	it("reports an argv entry over 4096 bytes", () => {
		expect(
			fieldIssues(declare({ probe: { run: ["true", "x".repeat(4097)] } }), "probe.run"),
		).toContainEqual(expect.stringContaining("exceeds max length"));
	});

	it("reports a non-ASCII argv[0]", () => {
		expect(fieldIssues(declare({ probe: { run: ["verificação"] } }), "probe.run")).toContainEqual(
			expect.stringContaining("must be ASCII"),
		);
	});

	it("reports whitespace in argv[0] — a binary and its args must be separate entries", () => {
		expect(fieldIssues(declare({ probe: { run: ["ip link"] } }), "probe.run")).toContainEqual(
			expect.stringContaining("contains whitespace"),
		);
		expect(fieldIssues(declare({ probe: { run: [" true"] } }), "probe.run")).toContainEqual(
			expect.stringContaining("surrounding whitespace"),
		);
	});

	it("reports control characters in argv[0]", () => {
		expect(fieldIssues(declare({ probe: { run: ["tr\u0001ue"] } }), "probe.run")).toContainEqual(
			expect.stringContaining("control characters"),
		);
	});

	it("applies the same argv guards to establish, which the host spawns through the same gate", () => {
		expect(fieldIssues(declare({ establish: ["serpro vpn"] }), "establish")).toContainEqual(
			expect.stringContaining("contains whitespace"),
		);
	});

	// ── cwd ───────────────────────────────────────────────────────────────────

	it("reports a cwd with whitespace, control characters, or non-ASCII", () => {
		expect(fieldIssues(declare({ cwd: "/tmp/my dir" }), "cwd")).toEqual([
			expect.stringContaining("must not contain whitespace"),
		]);
		expect(fieldIssues(declare({ cwd: "/tmp/x\u0001" }), "cwd")).toEqual([
			expect.stringContaining("control characters"),
		]);
		expect(fieldIssues(declare({ cwd: "/tmp/ação" }), "cwd")).toEqual([
			expect.stringContaining("must be ASCII"),
		]);
		expect(fieldIssues(declare({ cwd: "" }), "cwd")).toEqual([
			expect.stringContaining("must be non-empty"),
		]);
	});

	it("does NOT report a cwd that simply does not exist — that is environmental, not lexical", () => {
		// `readConnectionCatalog` is pure over a config object; a path this process cannot
		// see may exist perfectly well on the host. It surfaces as `unknown` at probe time.
		expect(fieldIssues(declare({ cwd: "/definitely/not/here/xyz" }), "cwd")).toEqual([]);
	});

	// ── the documented gap ────────────────────────────────────────────────────

	it("does NOT flag a sensitive env key — the host's blocklist is deliberately not copied", () => {
		// `is_blocked_spawn_env_key` -> `host::sensitive_aliases` refuses this, so the host
		// reports `down` while this surface can still report `up`. Copying that table here
		// would be its own drift; closing this needs the host to EXPORT its policy. This
		// test pins the KNOWN gap so it cannot be closed by accident and left undocumented.
		expect(fieldIssues(declare({ env: { AWS_SECRET_ACCESS_KEY: "abc" } }), "env")).toEqual([]);
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
