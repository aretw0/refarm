import { describe, expect, it } from "vitest";

import { createCapabilityRegistry } from "./registry.js";
import { surfaceModel, surfacesOf } from "./surface-model.js";
import type { CapabilityDescriptor } from "./types.js";

const withWeb: CapabilityDescriptor = {
	name: "wallet-show",
	summary: "Show my wallet",
	transports: { http: { method: "GET", path: "/wallet" } },
	renderers: { web: { route: "/wallet", icon: "wallet" }, tui: { section: "citizen" } },
	run: () => ({ ok: true }) as never,
};

const withTuiOnly: CapabilityDescriptor = {
	name: "analyze",
	summary: "Analyze records",
	renderers: { tui: { section: "citizen", shortcut: "ctrl+a", icon: "chart" } },
	run: () => ({ ok: true }) as never,
};

const cliOnly: CapabilityDescriptor = {
	name: "hidden",
	summary: "no visual hint",
	transports: { cli: {} },
	run: () => ({ ok: true }) as never,
};

describe("surfaceModel — the neutral visual envelope both web + TUI read", () => {
	function model() {
		return surfaceModel(createCapabilityRegistry([withWeb, withTuiOnly, cliOnly]));
	}

	it("includes only verbs with a visual hint (web or tui) — cli-only is absent", () => {
		const names = model().sections.flatMap((s) => s.items.map((i) => i.name));
		expect(names).toContain("wallet-show");
		expect(names).toContain("analyze");
		expect(names).not.toContain("hidden");
	});

	it("groups by section and name-sorts", () => {
		const m = model();
		expect(m.sections.map((s) => s.section)).toEqual(["citizen"]);
		const citizen = m.sections[0]!;
		// analyze < wallet-show alphabetically
		expect(citizen.items.map((i) => i.name)).toEqual(["analyze", "wallet-show"]);
	});

	it("carries the web + http surfaces a web view needs to render + invoke (open axis)", () => {
		const wallet = model().sections[0]!.items.find((i) => i.name === "wallet-show");
		expect(wallet?.surfaces.web).toEqual({ route: "/wallet", icon: "wallet" });
		expect(wallet?.surfaces.http).toEqual({ method: "GET", path: "/wallet" });
	});

	it("carries the tui surface hint a TUI binds; a tui-only verb has no web key", () => {
		const analyze = model().sections[0]!.items.find((i) => i.name === "analyze");
		expect(analyze?.surfaces.tui).toEqual({ section: "citizen", shortcut: "ctrl+a", icon: "chart" });
		// tui-only verb declared no web surface.
		expect(analyze?.surfaces.web).toBeUndefined();
	});

	it("carries an ARBITRARY new surface verbatim — no core edit (the open axis)", () => {
		const xr: CapabilityDescriptor = {
			name: "xr-panel",
			summary: "an XR panel",
			renderers: { tui: { section: "citizen" }, webxr: { anchor: "left", mesh: "panel.glb" } } as never,
			run: () => ({ ok: true }) as never,
		};
		const m = surfaceModel(createCapabilityRegistry([xr]));
		const item = m.sections[0]!.items.find((i) => i.name === "xr-panel");
		// A surface the model never enumerated still flows through unchanged.
		expect(item?.surfaces.webxr).toEqual({ anchor: "left", mesh: "panel.glb" });
	});

	it("defaults section to 'actions' when a verb declares web but no tui section", () => {
		const webNoSection: CapabilityDescriptor = {
			name: "ping",
			summary: "p",
			renderers: { web: { route: "/ping" } },
			run: () => ({ ok: true }) as never,
		};
		const m = surfaceModel(createCapabilityRegistry([webNoSection]));
		expect(m.sections[0]?.section).toBe("actions");
	});
});

describe("surfacesOf — the introspection face of the open axis (ADR-085)", () => {
	it("lists every transport + renderer surface a verb declares, sorted", () => {
		const multi: CapabilityDescriptor = {
			name: "wallet",
			summary: "w",
			transports: { cli: {}, http: { path: "/wallet" }, agent: { tool: true } },
			renderers: { tui: { section: "citizen" }, web: { route: "/wallet" }, palette: {} } as never,
			run: () => ({ ok: true }) as never,
		};
		// The verb's full multi-surface reach — what an inspector shows for "declare once".
		expect(surfacesOf(multi)).toEqual(["agent", "cli", "http", "palette", "tui", "web"]);
	});

	it("includes an ARBITRARY new surface key (open axis — no enumeration)", () => {
		const xr: CapabilityDescriptor = {
			name: "xr",
			summary: "x",
			renderers: { webxr: { anchor: "left" } } as never,
			run: () => ({ ok: true }) as never,
		};
		expect(surfacesOf(xr)).toEqual(["webxr"]);
	});

	it("is [] for a bare verb that declares no surface", () => {
		const bare: CapabilityDescriptor = { name: "b", summary: "b", run: () => ({ ok: true }) as never };
		expect(surfacesOf(bare)).toEqual([]);
	});
});
