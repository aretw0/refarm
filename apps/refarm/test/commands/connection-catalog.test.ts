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
