import {
	createCapabilityRegistry,
	type CapabilityDescriptor,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { surfaceModel } from "./surface-model.js";

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

	it("carries the web route + http endpoint a web surface needs to render + invoke", () => {
		const wallet = model().sections[0]!.items.find((i) => i.name === "wallet-show");
		expect(wallet?.route).toBe("/wallet");
		expect(wallet?.icon).toBe("wallet");
		expect(wallet?.http).toEqual({ method: "GET", path: "/wallet" });
	});

	it("carries the TUI shortcut a TUI surface binds", () => {
		const analyze = model().sections[0]!.items.find((i) => i.name === "analyze");
		expect(analyze?.shortcut).toBe("ctrl+a");
		expect(analyze?.icon).toBe("chart");
		// tui-only verb has no web route.
		expect(analyze?.route).toBeUndefined();
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
