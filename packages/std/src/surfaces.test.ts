import { describe, expect, it } from "vitest";

import {
	anySurfaceDeclaresDeviceTokenGate,
	parseSurfaces,
	refuseBindOutsideDeclaration,
	refuseGateThisListenerCannotEnforce,
	resolveDeclaredBindHost,
	resolveDeclaredSurfaceBind,
	SURFACE_CAPABILITIES,
	SURFACE_DAEMON_WS,
	SURFACE_WEB,
	SurfaceDeclarationError,
	surfaceEnforceableGate,
	type SurfaceCatalog,
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
		expect(() =>
			parseSurfaces({ surfaces: { web: { expose: "host:[::]", gate: "none" } } }),
		).toThrow(/EVERY interface on this machine/);
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

	it('S3 — a non-loopback expose on a gateless surface needs `gate: "none"` explicitly', () => {
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

	it('anySurfaceDeclaresDeviceTokenGate answers NO to `gate: "none"` (O1)', () => {
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
		expect(resolveDeclaredBindHost(undefined, { expose: { kind: "tailnet" }, gate: "open" })).toBe(
			"127.0.0.1",
		);
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
		expect(refuseBindOutsideDeclaration("web", "100.64.0.1", undefined)).toMatch(
			/refusing to bind/,
		);
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

	it('defence in depth: `gate: "none"` never permits a surface that HAS a gate', () => {
		expect(refuseBindOutsideDeclaration("sidecar-http", "100.64.0.1", openTailnet)).toMatch(
			/accepts mutations and HAS a credential gate/,
		);
	});
});

/** A catalog built through the REAL parser, so a combination the parser refuses can never be
 *  smuggled into a bind test by hand. */
const declare = (surfaces: Record<string, unknown>): SurfaceCatalog => parseSurfaces({ surfaces });
const UNDECLARED = parseSurfaces({});
const tailnetIs = (ipv4: string) => () => ({ ok: true, ipv4 }) as const;

describe("refuseGateThisListenerCannotEnforce — S3 is about the LISTENER, not the name", () => {
	const declaredTailnetToken = declare({
		"daemon-ws": { expose: "tailnet", gate: "device-token" },
	}).get(SURFACE_DAEMON_WS);

	it("passes when the listener verifies what was declared", () => {
		expect(
			refuseGateThisListenerCannotEnforce(
				SURFACE_DAEMON_WS,
				declaredTailnetToken,
				"device-token",
				undefined,
			),
		).toBeNull();
	});

	it("refuses when the SURFACE has the gate but THIS listener does not", () => {
		// `daemon-ws` is bound by the Rust daemon (ADR-093 handshake) AND by farmhand's Node
		// relay, which verifies nothing. The per-surface capability table is true of the first
		// and false of the second.
		expect(
			refuseGateThisListenerCannotEnforce(SURFACE_DAEMON_WS, declaredTailnetToken, null, undefined),
		).toMatch(/this listener verifies no credential at all/);
	});

	it("refuses even though the RESOLVED host would have come out loopback", () => {
		// The silent-inertness case: an unresolved `tailnet` falls back to loopback through
		// `resolveDeclaredBindHost`, so a listener that only checked the final host would bind
		// 127.0.0.1 and say nothing while the operator believed the declaration took effect.
		expect(resolveDeclaredBindHost(undefined, declaredTailnetToken)).toBe("127.0.0.1");
		expect(
			refuseGateThisListenerCannotEnforce(SURFACE_DAEMON_WS, declaredTailnetToken, null, undefined),
		).not.toBeNull();
	});

	it("lets an EXPLICIT loopback flag through — the operator narrowed it themselves (S5)", () => {
		expect(
			refuseGateThisListenerCannotEnforce(
				SURFACE_DAEMON_WS,
				declaredTailnetToken,
				null,
				"127.0.0.1",
			),
		).toBeNull();
	});

	it('never trips on `gate: "none"` — openness claims no enforcement (O1)', () => {
		const open = declare({ web: { expose: "tailnet", gate: "none" } }).get(SURFACE_WEB);
		expect(refuseGateThisListenerCannotEnforce(SURFACE_WEB, open, null, undefined)).toBeNull();
	});

	it("says nothing about an undeclared or loopback surface — those are other rules", () => {
		expect(refuseGateThisListenerCannotEnforce(SURFACE_WEB, undefined, null, "0.0.0.0")).toBeNull();
		const loopback = declare({ "daemon-ws": { expose: "loopback" } }).get(SURFACE_DAEMON_WS);
		expect(
			refuseGateThisListenerCannotEnforce(SURFACE_DAEMON_WS, loopback, null, undefined),
		).toBeNull();
	});
});

describe.each([SURFACE_WEB, SURFACE_CAPABILITIES])(
	"resolveDeclaredSurfaceBind — the whole O5 rule, per surface: %s",
	(surface) => {
		it("undeclared ⇒ loopback (S1)", () => {
			expect(resolveDeclaredSurfaceBind({ surface, surfaces: UNDECLARED }).host).toBe("127.0.0.1");
		});

		it("undeclared ⇒ a non-loopback flag is REFUSED (S1)", () => {
			expect(() =>
				resolveDeclaredSurfaceBind({ surface, surfaces: UNDECLARED, flagHost: "0.0.0.0" }),
			).toThrow(new RegExp(`no \`surfaces.${surface}\` declaration is present`));
		});

		it("declared ⇒ the declaration is the ceiling, with no flag at all (S5)", () => {
			const resolved = resolveDeclaredSurfaceBind({
				surface,
				surfaces: declare({ [surface]: { expose: "tailnet", gate: "none" } }),
				resolveTailnet: tailnetIs("100.64.7.7"),
			});
			expect(resolved.host).toBe("100.64.7.7");
			expect(resolved.declared).toEqual({
				expose: { kind: "host", host: "100.64.7.7" },
				gate: "open",
			});
		});

		it("a flag may NARROW the ceiling to loopback, and asks the tailnet nothing", () => {
			let asked = 0;
			const resolved = resolveDeclaredSurfaceBind({
				surface,
				surfaces: declare({ [surface]: { expose: "tailnet", gate: "none" } }),
				flagHost: "127.0.0.1",
				resolveTailnet: () => {
					asked += 1;
					return tailnetIs("100.64.7.7")();
				},
			});
			expect(resolved.host).toBe("127.0.0.1");
			expect(asked).toBe(0);
		});

		it("a flag may NEVER widen or re-point the ceiling (S5)", () => {
			const surfaces = declare({ [surface]: { expose: "tailnet", gate: "none" } });
			expect(() =>
				resolveDeclaredSurfaceBind({
					surface,
					surfaces,
					flagHost: "0.0.0.0",
					resolveTailnet: tailnetIs("100.64.7.7"),
				}),
			).toThrow(/never point somewhere else or wider/);
			expect(() =>
				resolveDeclaredSurfaceBind({
					surface,
					surfaces: declare({ [surface]: { expose: "loopback" } }),
					flagHost: "0.0.0.0",
				}),
			).toThrow(/a flag may narrow that declaration, never widen it/);
		});

		it("a gate this surface cannot enforce is REFUSED at parse, at every expose (S3)", () => {
			expect(() => declare({ [surface]: { expose: "tailnet", gate: "device-token" } })).toThrow(
				/verifies no bearer credential at all/,
			);
			expect(() => declare({ [surface]: { expose: "loopback", gate: "device-token" } })).toThrow(
				/verifies no bearer credential at all/,
			);
		});

		it("a gate this surface cannot enforce is REFUSED at bind too (defence in depth)", () => {
			// Unreachable through `parseSurfaces`; kept because a declaration built some other way
			// must not slip past, exactly as the Rust guard keeps its mirror arm.
			const forged = new Map([
				[
					surface,
					{ expose: { kind: "host" as const, host: "10.0.0.4" }, gate: "device-token" as const },
				],
			]);
			expect(() =>
				resolveDeclaredSurfaceBind({ surface, surfaces: forged, flagHost: "10.0.0.4" }),
			).toThrow(/verifies no bearer credential at all|this listener verifies no credential/);
		});

		it("a declared `tailnet` FAILS CLOSED when the tailnet cannot answer", () => {
			const surfaces = declare({ [surface]: { expose: "tailnet", gate: "none" } });
			expect(() =>
				resolveDeclaredSurfaceBind({
					surface,
					surfaces,
					resolveTailnet: () => ({ ok: false, reason: "down", detail: "the tailnet is down" }),
				}),
			).toThrow(/tailscale up/);
			// And with NO resolver at all: refused, never quietly narrowed to loopback.
			expect(() => resolveDeclaredSurfaceBind({ surface, surfaces })).toThrow(
				/no way to resolve that against this machine's tailnet address/,
			);
		});

		it("names the listener in every refusal, so the operator learns WHICH one said no", () => {
			expect(() =>
				resolveDeclaredSurfaceBind({
					surface,
					surfaces: UNDECLARED,
					flagHost: "0.0.0.0",
					label: "the hub (`refarm web serve`)",
				}),
			).toThrow(/the hub \(`refarm web serve`\)/);
		});
	},
);

describe("resolveDeclaredSurfaceBind — daemon-ws, the surface with two listeners", () => {
	const declared = declare({ "daemon-ws": { expose: "host:10.0.0.4", gate: "device-token" } });

	it("the RUST daemon's listener may bind it — it enforces ADR-093's handshake", () => {
		expect(
			resolveDeclaredSurfaceBind({
				surface: SURFACE_DAEMON_WS,
				surfaces: declared,
				verifies: "device-token",
			}).host,
		).toBe("10.0.0.4");
	});

	it("a listener that verifies nothing may NOT — same declaration, same name", () => {
		expect(() =>
			resolveDeclaredSurfaceBind({
				surface: SURFACE_DAEMON_WS,
				surfaces: declared,
				verifies: null,
			}),
		).toThrow(/cannot be honoured HERE/);
	});
});
