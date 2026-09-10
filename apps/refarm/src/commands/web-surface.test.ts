import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseSurfaces, type SurfaceCatalog } from "@refarm.dev/std";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	parseTailnetSelfIpv4,
	proxiedUpstreamsAreGated,
	readSurfacesFromFilesystem,
	resolveWebBindHost,
	type TailnetSelfResolution,
} from "./web-surface.js";

const OPERATOR_LIVE_SHAPE = {
	"sidecar-http": { expose: "tailnet", gate: "device-token" },
	"daemon-ws": { expose: "loopback" },
};

/** A node whose sidecar declares the device-token gate — the operator's real posture, and the
 *  precondition O6 puts on serving the proxy routes on an open surface. */
function gatedNode(extra: Record<string, unknown> = {}): SurfaceCatalog {
	return parseSurfaces({ surfaces: { ...OPERATOR_LIVE_SHAPE, ...extra } });
}

const tailnetUp = (ipv4 = "100.64.7.7"): (() => TailnetSelfResolution) => () => ({ ok: true, ipv4 });

let root: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "refarm-web-surface-"));
	mkdirSync(path.join(root, ".refarm"), { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("readSurfacesFromFilesystem — the FILESYSTEM config decides exposure", () => {
	it("reads .refarm/config.json under the given root", () => {
		writeFileSync(
			path.join(root, ".refarm", "config.json"),
			JSON.stringify({ surfaces: { ...OPERATOR_LIVE_SHAPE, web: { expose: "tailnet", gate: "none" } } }),
		);
		const surfaces = readSurfacesFromFilesystem(root);
		expect(surfaces.get("web")).toEqual({ expose: { kind: "tailnet" }, gate: "open" });
		// The operator's live shape must come through untouched by this slice.
		expect(surfaces.get("sidecar-http")).toEqual({
			expose: { kind: "tailnet" },
			gate: "device-token",
		});
		expect(surfaces.get("daemon-ws")).toEqual({ expose: { kind: "loopback" }, gate: null });
	});

	it("an absent config is S1's silence — an empty catalog, not an error", () => {
		expect(readSurfacesFromFilesystem(root).size).toBe(0);
	});

	it("a refused declaration fails SHUT, it is never a warning", () => {
		writeFileSync(
			path.join(root, ".refarm", "config.json"),
			JSON.stringify({ surfaces: { web: { expose: "tailnet", gate: "device-token" } } }),
		);
		expect(() => readSurfacesFromFilesystem(root)).toThrow(/verifies no bearer credential/);
	});
});

describe("resolveWebBindHost — S1/S5: the declaration is the ceiling", () => {
	it("undeclared + no flag ⇒ loopback (S1)", () => {
		expect(resolveWebBindHost({ surfaces: gatedNode() }).host).toBe("127.0.0.1");
	});

	it("undeclared refuses every non-loopback flag, however gated the node is", () => {
		// THE O5 MUTATION GUARD. Under the old criterion this bind was ALLOWED: the node has a
		// device-token gate on `sidecar-http`, so `authPolicyPresent()`-style reasoning said yes
		// — for a listener that verifies nothing and declared nothing.
		expect(() => resolveWebBindHost({ flagHost: "0.0.0.0", surfaces: gatedNode() })).toThrow(
			/no `surfaces.web` declaration is present/,
		);
		expect(() => resolveWebBindHost({ flagHost: "100.64.7.7", surfaces: gatedNode() })).toThrow(
			/undeclared surface binds loopback only/,
		);
	});

	it("declared tailnet + no flag ⇒ the resolved tailnet address", () => {
		const resolved = resolveWebBindHost({
			surfaces: gatedNode({ web: { expose: "tailnet", gate: "none" } }),
			resolveTailnet: tailnetUp(),
		});
		expect(resolved.host).toBe("100.64.7.7");
	});

	it("S5 — a flag may narrow the declaration to loopback, and never asks the tailnet", () => {
		let asked = 0;
		const resolved = resolveWebBindHost({
			flagHost: "127.0.0.1",
			surfaces: gatedNode({ web: { expose: "tailnet", gate: "none" } }),
			resolveTailnet: () => {
				asked += 1;
				return { ok: true, ipv4: "100.64.7.7" };
			},
		});
		expect(resolved.host).toBe("127.0.0.1");
		expect(asked).toBe(0);
	});

	it("S5 — a flag may NOT widen past the declaration", () => {
		const surfaces = gatedNode({ web: { expose: "tailnet", gate: "none" } });
		expect(() =>
			resolveWebBindHost({ flagHost: "0.0.0.0", surfaces, resolveTailnet: tailnetUp() }),
		).toThrow(/never point somewhere else or wider/);
	});

	it("a declared tailnet FAILS CLOSED when the tailnet is down — never a wider fallback", () => {
		const surfaces = gatedNode({ web: { expose: "tailnet", gate: "none" } });
		expect(() =>
			resolveWebBindHost({
				surfaces,
				resolveTailnet: () => ({ ok: false, reason: "down", detail: "the tailnet is not running" }),
			}),
		).toThrow(/tailscale up/);
		expect(() =>
			resolveWebBindHost({
				surfaces,
				resolveTailnet: () => ({
					ok: false,
					reason: "unreachable",
					detail: "the `tailscale` CLI could not be run",
				}),
			}),
		).toThrow(/Install\/repair the `tailscale` CLI/);
	});
});

describe("resolveWebBindHost — O6: the proxy routes ride this listener too", () => {
	it("an open surface on a node with NO credential policy is refused", () => {
		// The one machine-level fact this bind still depends on, and it is about the UPSTREAM:
		// /sync and the sidecar API are only admissible because their upstream gates them.
		const surfaces = parseSurfaces({ surfaces: { web: { expose: "tailnet", gate: "none" } } });
		expect(() =>
			resolveWebBindHost({ surfaces, resolveTailnet: tailnetUp(), env: {} }),
		).toThrow(/no credential policy is live on this node/);
	});

	it("…and permitted once the node's own gate is declared", () => {
		const surfaces = gatedNode({ web: { expose: "tailnet", gate: "none" } });
		expect(
			resolveWebBindHost({ surfaces, resolveTailnet: tailnetUp(), env: {} }).host,
		).toBe("100.64.7.7");
	});

	it("loopback never needs the upstream check — nothing is reachable from elsewhere", () => {
		const surfaces = parseSurfaces({ surfaces: { web: { expose: "loopback", gate: "none" } } });
		expect(resolveWebBindHost({ surfaces, env: {} }).host).toBe("127.0.0.1");
	});

	it("proxiedUpstreamsAreGated: a declared gate OR an explicit policy path, never `gate: \"none\"`", () => {
		expect(proxiedUpstreamsAreGated(gatedNode(), {})).toBe(true);
		expect(proxiedUpstreamsAreGated(parseSurfaces({}), {})).toBe(false);
		expect(
			proxiedUpstreamsAreGated(
				parseSurfaces({ surfaces: { web: { expose: "tailnet", gate: "none" } } }),
				{},
			),
		).toBe(false);
	});
});

describe("parseTailnetSelfIpv4 — 'the tailnet is down' is not 'I could not ask'", () => {
	it("reads Self's IPv4 from a running tailnet", () => {
		expect(
			parseTailnetSelfIpv4(
				JSON.stringify({
					BackendState: "Running",
					Self: { Online: true, TailscaleIPs: ["100.64.7.7", "fd7a::1"] },
				}),
			),
		).toEqual({ ok: true, ipv4: "100.64.7.7" });
	});

	it("a stopped backend, an offline self, or no IPv4 are all 'down' — a trustworthy no", () => {
		for (const doc of [
			{ BackendState: "Stopped", Self: {} },
			{ BackendState: "Running", Self: { Online: false, TailscaleIPs: ["100.64.7.7"] } },
			{ BackendState: "Running", Self: { Online: true, TailscaleIPs: ["fd7a::1"] } },
		]) {
			const result = parseTailnetSelfIpv4(JSON.stringify(doc));
			expect(result.ok).toBe(false);
			expect(result.ok === false && result.reason).toBe("down");
		}
	});

	it("non-JSON or a document that is not a tailscale status is 'unreachable'", () => {
		for (const raw of ["", "not json", JSON.stringify({ hello: 1 }), JSON.stringify([1, 2])]) {
			const result = parseTailnetSelfIpv4(raw);
			expect(result.ok).toBe(false);
			expect(result.ok === false && result.reason).toBe("unreachable");
		}
	});
});
