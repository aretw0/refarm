import { createCapabilityRegistry, type CapabilityDescriptor } from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import {
	capabilityWebSurfaceActions,
	createCapabilityWebSurfacePlugin,
} from "./index.js";

const walletVerb: CapabilityDescriptor = {
	name: "wallet",
	summary: "Show my digital wallet",
	transports: { http: { method: "GET", path: "/wallet" } },
	renderers: { web: { route: "/wallet", icon: "wallet" }, tui: { section: "citizen" } },
	run: () => ({ ok: true }) as never,
};

const tuiOnlyVerb: CapabilityDescriptor = {
	name: "analyze",
	summary: "TUI only",
	renderers: { tui: { section: "citizen" } },
	run: () => ({ ok: true }) as never,
};

describe("capability → homestead web bridge (ADR-085)", () => {
	const registry = createCapabilityRegistry([walletVerb, tuiOnlyVerb]);

	it("builds a Homestead surface plugin that declares a panel in a slot", () => {
		const handle = createCapabilityWebSurfacePlugin(registry, { slot: "main" });
		const surfaces = handle.manifest?.extensions?.surfaces ?? [];
		expect(surfaces).toEqual([
			expect.objectContaining({ layer: "homestead", kind: "panel", slot: "main" }),
		]);
	});

	it("renders ONLY web verbs as cards (tui-only is absent) via renderHomesteadSurface", async () => {
		const handle = createCapabilityWebSurfacePlugin(registry);
		const result = (await handle.call?.("renderHomesteadSurface", {})) as { html: string };
		expect(result.html).toContain("wallet");
		expect(result.html).toContain("Show my digital wallet");
		// The web verb carries its route + endpoint for the panel to invoke.
		expect(result.html).toContain('data-route="/wallet"');
		expect(result.html).toContain("GET /wallet");
		// A tui-only verb declared no web surface — absent from the web panel.
		expect(result.html).not.toContain("analyze");
		// DS-styled, not a bespoke palette.
		expect(result.html).toContain("refarm-surface-card");
	});

	it("exposes one action per web verb for the host to dispatch", () => {
		const actions = capabilityWebSurfaceActions(registry);
		expect(actions).toEqual([
			{ id: "wallet", label: "wallet", intent: "capability:wallet" },
		]);
	});

	it("renders an empty-state when no verb declares a web surface", async () => {
		const handle = createCapabilityWebSurfacePlugin(createCapabilityRegistry([tuiOnlyVerb]));
		const result = (await handle.call?.("renderHomesteadSurface", {})) as { html: string };
		expect(result.html).toContain("No verb declares a web surface");
	});
});
