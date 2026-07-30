import { describe, expect, it } from "vitest";

import {
	anySurfaceDeclaresDeviceTokenGate,
	parseSurfaces,
	refuseBindOutsideDeclaration,
	resolveDeclaredBindHost,
	SurfaceDeclarationError,
	surfaceEnforceableGate,
	type SurfaceDeclaration,
} from "./surfaces.js";

const web = (config: unknown): SurfaceDeclaration | undefined =>
	parseSurfaces(config).get("web") as SurfaceDeclaration | undefined;

describe("parseSurfaces — one vocabulary, mirrored from surfaces_decl.rs", () => {
	it("an absent block is S1's silence, not an error", () => {
		expect(parseSurfaces({}).size).toBe(0);
		expect(parseSurfaces(null).size).toBe(0);
		expect(parseSurfaces({ surfaces: null }).size).toBe(0);
	});

	it("parses the operator's live declaration shape unchanged", () => {
		// The shape actually in .refarm/config.json today. This slice must not disturb it.
		const parsed = parseSurfaces({
			surfaces: {
				"sidecar-http": { expose: "tailnet", gate: "device-token" },
				"daemon-ws": { expose: "loopback" },
			},
		});
		expect(parsed.get("sidecar-http")).toEqual({
			expose: { kind: "tailnet" },
			gate: "device-token",
		});
		expect(parsed.get("daemon-ws")).toEqual({ expose: { kind: "loopback" }, gate: null });
		expect(anySurfaceDeclaresDeviceTokenGate(parsed)).toBe(true);
	});

	it("refuses `dist-http` — the surface is named for the LISTENER (O6), and only once", () => {
		expect(() => parseSurfaces({ surfaces: { "dist-http": { expose: "tailnet" } } })).toThrow(
			/is not a surface any refarm runtime declares/,
		);
	});

	it("accepts `web` declared open over the tailnet — O1's whole point", () => {
		expect(web({ surfaces: { web: { expose: "tailnet", gate: "none" } } })).toEqual({
			expose: { kind: "tailnet" },
			gate: "open",
		});
	});

	it("S3 — `web` may not declare a gate it cannot enforce, at ANY expose", () => {
		for (const expose of ["loopback", "tailnet", "host:100.64.0.1"]) {
			expect(() => parseSurfaces({ surfaces: { web: { expose, gate: "device-token" } } })).toThrow(
				/verifies no bearer credential at all/,
			);
		}
	});

	it("O2 — openness is refused with a literal host, spelling out why 100.64/10 is not evidence", () => {
		expect(() =>
			parseSurfaces({ surfaces: { web: { expose: "host:100.64.0.1", gate: "none" } } }),
		).toThrow(/carrier-grade NAT/);
		expect(() =>
			parseSurfaces({ surfaces: { web: { expose: "host:0.0.0.0", gate: "none" } } }),
		).toThrow(/EVERY interface on this machine/);
		expect(() => parseSurfaces({ surfaces: { web: { expose: "host:[::]", gate: "none" } } })).toThrow(
			/EVERY interface on this machine/,
		);
	});

	it("O2 — a surface that HAS a gate may not declare itself open beyond loopback", () => {
		expect(() =>
			parseSurfaces({ surfaces: { "sidecar-http": { expose: "tailnet", gate: "none" } } }),
		).toThrow(/accepts mutations and HAS a credential gate/);
		// …but loopback + "none" parses and means nothing special.
		expect(
			parseSurfaces({ surfaces: { "daemon-ws": { expose: "loopback", gate: "none" } } }).get(
				"daemon-ws",
			),
		).toEqual({ expose: { kind: "loopback" }, gate: "open" });
	});

	it("S3 — a non-loopback expose on a gateless surface needs `gate: \"none\"` explicitly", () => {
		expect(() => parseSurfaces({ surfaces: { web: { expose: "tailnet" } } })).toThrow(
			/has no credential gate implemented at all/,
		);
	});

	it("refuses unknown gate values and unparseable expose shapes, fail-shut", () => {
		expect(() => parseSurfaces({ surfaces: { web: { expose: "tailnet", gate: "sso" } } })).toThrow(
			SurfaceDeclarationError,
		);
		expect(() => parseSurfaces({ surfaces: { web: { expose: "host:example.com" } } })).toThrow(
			/never a hostname/,
		);
		expect(() => parseSurfaces({ surfaces: { web: { expose: "public" } } })).toThrow(
			/is not a known value/,
		);
		expect(() => parseSurfaces({ surfaces: { web: {} } })).toThrow(/expose is required/);
		expect(() => parseSurfaces({ surfaces: { web: "tailnet" } })).toThrow(/must be an object/);
		expect(() => parseSurfaces({ surfaces: [] })).toThrow(/surfaces must be an object/);
	});

	it("anySurfaceDeclaresDeviceTokenGate answers NO to `gate: \"none\"` (O1)", () => {
		const open = parseSurfaces({ surfaces: { web: { expose: "tailnet", gate: "none" } } });
		expect(anySurfaceDeclaresDeviceTokenGate(open)).toBe(false);
	});

	it("surfaceEnforceableGate is the S3 capability table, identical to Rust's", () => {
		expect(surfaceEnforceableGate("sidecar-http")).toBe("device-token");
		expect(surfaceEnforceableGate("daemon-ws")).toBe("device-token");
		expect(surfaceEnforceableGate("web")).toBeNull();
		expect(surfaceEnforceableGate("capabilities")).toBeNull();
	});
});

describe("resolveDeclaredBindHost — an absent flag lets the declaration decide", () => {
	it("undeclared + absent flag ⇒ loopback (S1)", () => {
		expect(resolveDeclaredBindHost(undefined, undefined)).toBe("127.0.0.1");
	});

	it("a declared host + absent flag ⇒ the declared host", () => {
		// A `host:<ip>` + `gate: "none"` shape is refused AT PARSE (O2), so the resolver is fed
		// the declaration directly — this is the shape a resolved `tailnet` becomes at bind time.
		expect(
			resolveDeclaredBindHost(undefined, {
				expose: { kind: "host", host: "100.64.0.1" },
				gate: "open",
			}),
		).toBe("100.64.0.1");
	});

	it("an unresolved tailnet falls back to loopback — fail CLOSED, never a silent widen", () => {
		expect(
			resolveDeclaredBindHost(undefined, { expose: { kind: "tailnet" }, gate: "open" }),
		).toBe("127.0.0.1");
	});

	it("a present flag is the operator's own value, validated by the guard afterwards", () => {
		expect(resolveDeclaredBindHost("0.0.0.0", undefined)).toBe("0.0.0.0");
	});
});

describe("refuseBindOutsideDeclaration — the declaration is the ceiling", () => {
	const openTailnet: SurfaceDeclaration = {
		expose: { kind: "host", host: "100.64.0.1" },
		gate: "open",
	};

	it("loopback is inside every ceiling — declared or not", () => {
		expect(refuseBindOutsideDeclaration("web", "127.0.0.1", undefined)).toBeNull();
		expect(refuseBindOutsideDeclaration("web", "localhost", undefined)).toBeNull();
		expect(refuseBindOutsideDeclaration("web", "[::1]", undefined)).toBeNull();
	});

	it("S1 — undeclared refuses every non-loopback host, naming the declaration to write", () => {
		const refusal = refuseBindOutsideDeclaration("web", "0.0.0.0", undefined);
		expect(refusal).toMatch(/no `surfaces.web` declaration is present/);
		expect(refusal).toMatch(/"expose": "tailnet", "gate": "none"/);
		expect(refuseBindOutsideDeclaration("web", "100.64.0.1", undefined)).toMatch(/refusing to bind/);
	});

	it("S5 — a declared loopback ceiling refuses a widening flag", () => {
		expect(
			refuseBindOutsideDeclaration("web", "100.64.0.1", {
				expose: { kind: "loopback" },
				gate: null,
			}),
		).toMatch(/a flag may narrow that declaration, never widen it/);
	});

	it("S5 — a flag pointing somewhere ELSE than the declared address is refused", () => {
		expect(refuseBindOutsideDeclaration("web", "0.0.0.0", openTailnet)).toMatch(
			/never point somewhere else or wider/,
		);
		expect(refuseBindOutsideDeclaration("web", "100.64.0.2", openTailnet)).toMatch(
			/never point somewhere else or wider/,
		);
	});

	it("a matching address + declared openness binds", () => {
		expect(refuseBindOutsideDeclaration("web", "100.64.0.1", openTailnet)).toBeNull();
	});

	it("an UNRESOLVED tailnet is intent, not an address — refused rather than bound", () => {
		expect(
			refuseBindOutsideDeclaration("web", "100.64.0.1", {
				expose: { kind: "tailnet" },
				gate: "open",
			}),
		).toMatch(/which is INTENT, not an address/);
	});

	it("a non-loopback expose with no gate at all is refused (S3)", () => {
		expect(
			refuseBindOutsideDeclaration("web", "100.64.0.1", {
				expose: { kind: "host", host: "100.64.0.1" },
				gate: null,
			}),
		).toMatch(/non-loopback expose with no gate/);
	});

	it("defence in depth: a `device-token` gate on a surface that verifies nothing still refuses", () => {
		// Unreachable through parseSurfaces (it refuses at parse). This arm exists so a
		// declaration built some other way can never fall through to the permitting branch.
		expect(
			refuseBindOutsideDeclaration("web", "100.64.0.1", {
				expose: { kind: "host", host: "100.64.0.1" },
				gate: "device-token",
			}),
		).toMatch(/verifies no bearer credential at all/);
	});

	it("defence in depth: `gate: \"none\"` never permits a surface that HAS a gate", () => {
		expect(
			refuseBindOutsideDeclaration("sidecar-http", "100.64.0.1", openTailnet),
		).toMatch(/accepts mutations and HAS a credential gate/);
	});
});
