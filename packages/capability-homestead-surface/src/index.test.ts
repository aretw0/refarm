import { createCapabilityRegistry, type CapabilityDescriptor } from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import {
	capabilityWebSurfaceActions,
	createCapabilityWebSurfacePlugin,
	renderCapabilityFormMessage,
	renderTableHtml,
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

const typedArgsVerb: CapabilityDescriptor = {
	name: "code-ops",
	summary: "Run a code operation",
	args: [
		{ name: "verb", required: true, enum: ["find-references", "rename-symbol"] },
		{ name: "line", type: "integer" },
	],
	options: [
		{ name: "column", kind: "integer", summary: "1-based column" },
		{ name: "tipo", kind: "string", enum: ["x", "y"], summary: "The tipo" },
	],
	renderers: { web: { route: "/code-ops" } },
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
		expect(actions).toEqual([{ id: "wallet", label: "wallet", intent: "capability:wallet" }]);
	});

	it("renders an empty-state when no verb declares a web surface", async () => {
		const handle = createCapabilityWebSurfacePlugin(createCapabilityRegistry([tuiOnlyVerb]));
		const result = (await handle.call?.("renderHomesteadSurface", {})) as { html: string };
		expect(result.html).toContain("No verb declares a web surface");
	});

	it("renders a TYPED arg form — <select> for an enum arg, number input for an integer arg", async () => {
		const handle = createCapabilityWebSurfacePlugin(createCapabilityRegistry([typedArgsVerb]));
		const result = (await handle.call?.("renderHomesteadSurface", {})) as { html: string };
		// The enum arg becomes a <select> of its allowed values — not a text box you must guess.
		expect(result.html).toContain('<select class="refarm-input" aria-label="verb" data-refarm-arg="verb" required>');
		expect(result.html).toContain('<option value="find-references">find-references</option>');
		expect(result.html).toContain('<option value="rename-symbol">rename-symbol</option>');
		// The integer arg becomes a number input.
		expect(result.html).toContain('type="number" step="1" aria-label="line" data-refarm-arg="line"');
		// An integer OPTION also becomes a number input.
		expect(result.html).toContain('type="number" step="1" aria-label="column" data-refarm-option="column"');
		// An enum OPTION becomes a <select> too (the option-side twin of the enum arg).
		expect(result.html).toContain('<select class="refarm-input" aria-label="tipo" data-refarm-option="tipo">');
		expect(result.html).toContain('<option value="x">x</option>');
	});

	it("labels every control + marks required args for assistive tech, and the inline form is novalidate (a11y)", () => {
		const registry = createCapabilityRegistry([typedArgsVerb]);
		const form = renderCapabilityFormMessage(registry, "code-ops");
		// Every control gets a programmatic accessible name — the compact inline form has no visible <label>.
		expect(form).toContain('aria-label="verb"');
		expect(form).toContain('aria-label="line"');
		expect(form).toContain('aria-label="column"');
		expect(form).toContain('aria-label="tipo"');
		// The required arg carries native `required` (preferred over aria-required for native controls);
		// the optional arg does not.
		expect(form).toContain('data-refarm-arg="verb" required>');
		expect(form).not.toContain('data-refarm-arg="line" required');
		// novalidate keeps our shared validator authoritative — native bubbles never pre-empt the
		// accessible inline errors that validateCapabilityArgs drives.
		expect(form).toContain('data-refarm-verb="code-ops" novalidate');
	});

	it("injects a content projector's HTML (from host.data) above the cards — the MOC seam", async () => {
		// The generic content seam: a host runs its verb, puts the structured result on
		// host.data, and the content projector turns it into HTML rendered above the cards.
		// This is how a verb shows its CONTENT (a MOC, a dashboard) not just launcher cards.
		const handle = createCapabilityWebSurfacePlugin(registry, {
			content: (data) => `<nav data-moc>${data.moc ?? ""}</nav>`,
		});
		const request = { host: { hostId: "test", data: { moc: "REQ-1 · REQ-2" } } };
		const result = (await handle.call?.("renderHomesteadSurface", request)) as { html: string };
		expect(result.html).toContain("<nav data-moc>REQ-1 · REQ-2</nav>");
		// Content sits ABOVE the launcher cards.
		expect(result.html.indexOf("data-moc")).toBeLessThan(result.html.indexOf("refarm-btn-pill"));
	});
});

describe("renderTableHtml (web twin of the TUI renderTable)", () => {
	it("renders a semantic accessible table — thead th[scope=col], tbody td, optional caption", () => {
		const html = renderTableHtml(
			[
				{ key: "id", header: "ID" },
				{ key: "status", header: "Status" },
			],
			[
				{ id: "REQ-1", status: "open" },
				{ id: "REQ-2", status: 42 },
			],
			{ caption: "Requirements" },
		);
		expect(html).toContain('<caption class="refarm-table-caption">Requirements</caption>');
		expect(html).toContain('<th scope="col" class="refarm-th">ID</th>');
		expect(html).toContain('<td class="refarm-td">REQ-1</td>');
		expect(html).toContain('<td class="refarm-td">open</td>');
		expect(html).toContain('<td class="refarm-td">42</td>'); // number stringified
		expect(html).toContain("<thead>");
		expect(html).toContain("<tbody>");
	});

	it("escapes header + cell content", () => {
		const html = renderTableHtml([{ key: "x", header: "<H>" }], [{ x: "<b>" }]);
		expect(html).toContain("&lt;H&gt;");
		expect(html).toContain("&lt;b&gt;");
	});
});
