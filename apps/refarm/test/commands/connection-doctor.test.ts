import { accessSync, constants as fsConstants } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildConnectionDoctorRecommendations } from "../../src/commands/connection-doctor.js";

/** `buildConnectionDoctorRecommendations` resolves binaries against the REAL PATH (via
 * `resolveBinary`), so a "fully resolvable" test must not silently pass by asserting on
 * a binary that happens to be missing on this host. Same doctrine as
 * `connection-status.test.ts`: fail loudly up front rather than let a missing binary
 * make an unrelated assertion pass for the wrong reason. */
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

describe("buildConnectionDoctorRecommendations", () => {
	it("produces no findings when no connections are declared — an absent catalog is not a defect", () => {
		expect(buildConnectionDoctorRecommendations({})).toEqual([]);
	});

	it("produces no findings for a fully-resolvable declaration with no catalog issues", () => {
		const findings = buildConnectionDoctorRecommendations({
			connections: {
				vpn: { establish: ["/usr/bin/true"], probe: { run: ["/usr/bin/true"] } },
			},
		});
		expect(findings).toEqual([]);
	});

	it("produces exactly one warning naming the connection and the missing establish binary", () => {
		const findings = buildConnectionDoctorRecommendations({
			connections: {
				vpn: {
					establish: ["definitely-not-a-real-binary-xyz"],
					probe: { run: ["/usr/bin/true"] },
				},
			},
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			severity: "warning",
			command: "refarm connection status --json",
		});
		expect(findings[0]!.summary).toContain("vpn");
		expect(findings[0]!.summary).toContain("definitely-not-a-real-binary-xyz");
	});

	it("produces exactly one warning naming the connection and the missing probe binary", () => {
		const findings = buildConnectionDoctorRecommendations({
			connections: {
				vpn: {
					establish: ["/usr/bin/true"],
					probe: { run: ["definitely-not-a-real-binary-xyz"] },
				},
			},
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			severity: "warning",
			command: "refarm connection status --json",
		});
		expect(findings[0]!.summary).toContain("vpn");
		expect(findings[0]!.summary).toContain("definitely-not-a-real-binary-xyz");
	});

	it("produces a finding for a declaration with a catalog issue (non-zero idle linger)", () => {
		const findings = buildConnectionDoctorRecommendations({
			connections: {
				vpn: {
					establish: ["/usr/bin/true"],
					probe: { run: ["/usr/bin/true"] },
					linger: { idleMs: 5_000 },
				},
			},
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			severity: "warning",
			command: "refarm connection status --json",
		});
		expect(findings[0]!.summary).toContain("vpn");
		expect(findings[0]!.summary).toContain("linger");
	});

	it("never reports a missing-binary finding for an argv the catalog reader already flagged as empty", () => {
		// `establish: []` is a catalog issue on its own (`establish must be a non-empty
		// array of strings`) — resolving argv0 of an empty array must not ALSO produce a
		// second, redundant "binary missing" finding for the same root cause.
		const findings = buildConnectionDoctorRecommendations({
			connections: {
				broken: { establish: [], probe: { run: ["/usr/bin/true"] } },
			},
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]!.diagnostic).toContain("catalog-issue");
	});

	it("gives two issues on the SAME field distinct diagnostic ids", () => {
		// `connection:field` alone collides: two bad `env` entries on one connection used to
		// produce two byte-identical warnings, which render as a duplicate AND double-count
		// `warningCount` (buildRefarmDoctorReport appends every id to `warnings` un-deduped).
		const findings = buildConnectionDoctorRecommendations({
			connections: {
				vpn: {
					establish: ["/usr/bin/true"],
					probe: { run: ["/usr/bin/true"] },
					env: { GOOD: "x", "1BAD": "y", "2ALSO-BAD": "z" },
				},
			},
		});
		const envFindings = findings.filter((f) => f.diagnostic.includes(":env:"));
		expect(envFindings.length).toBeGreaterThan(1);
		expect(new Set(envFindings.map((f) => f.diagnostic)).size).toBe(envFindings.length);
	});

	it("names every declared connection, never dropping one just because another is fine", () => {
		const findings = buildConnectionDoctorRecommendations({
			connections: {
				ok: { establish: ["/usr/bin/true"], probe: { run: ["/usr/bin/true"] } },
				broken: {
					establish: ["definitely-not-a-real-binary-xyz"],
					probe: { run: ["/usr/bin/true"] },
				},
			},
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]!.summary).toContain("broken");
	});
});
