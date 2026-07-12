/** @vitest-environment jsdom */
import type { CapabilityRegistry } from "@refarm.dev/capabilities";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootCapabilityWebFace } from "./boot.js";

/** The registered-plugin shape the mock tractor stores — just an id-bearing handle. */
type RegisteredPlugin = { id: string };

/**
 * E2E for the one-call web face: bootCapabilityWebFace runs a verb, mounts the surface, and
 * renders the verb's content into a real DOM slot — the whole example boot, proven end to
 * end (not just "it compiles"). Uses the bootRuntime seam to inject a mock tractor.
 */
function shellMarkup(): string {
	return `<main id="refarm-main"><div id="refarm-slot-main" class="slot"></div></main>`;
}

function mockRuntime() {
	const plugins = new Map<string, RegisteredPlugin>();
	const tractor = {
		logLevel: "error",
		plugins: {
			registerInternal: (p: RegisteredPlugin) => plugins.set(p.id, p),
			get: (id: string) => plugins.get(id),
			getAllPlugins: () => Array.from(plugins.values()),
			findByApi: () => undefined,
		},
		observe: () => {},
		onNode: () => {},
		emitTelemetry: () => {},
		getHelpNodes: async () => [],
		switchTier: () => {},
	};
	return { tractor } as never;
}

/** A minimal registry with one web verb whose run() returns a projected `pageHtml`. */
function registryWithVerb(): { registry: CapabilityRegistry; runCalls: number } {
	let runCalls = 0;
	const descriptor = {
		name: "page",
		renderers: { web: { route: "/page" } },
		run: async () => {
			runCalls += 1;
			return { pageHtml: "<p data-page>the rendered page</p>" };
		},
	};
	const registry = {
		get: (name: string) => (name === "page" ? descriptor : undefined),
		list: () => [{ name: "page" }],
	} as unknown as CapabilityRegistry;
	return {
		get registry() {
			return registry;
		},
		get runCalls() {
			return runCalls;
		},
	} as never;
}

describe("bootCapabilityWebFace — runs the verb, mounts the surface, renders content", () => {
	beforeEach(() => {
		document.body.innerHTML = shellMarkup();
		vi.spyOn(console, "info").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("runs the content verb and renders its field into the mounted surface", async () => {
		const holder = registryWithVerb();
		await bootCapabilityWebFace({
			databaseName: "test-face",
			namespace: "test",
			registry: holder.registry,
			content: { verb: "page", field: "pageHtml" },
			surface: { pluginId: "test/web", content: (d) => String(d.pageHtml ?? "") },
			bootRuntime: async () => mockRuntime(),
		});

		// The verb ran once, and its content is on screen in the mounted surface.
		expect(holder.runCalls).toBe(1);
		const mounted = document.querySelector('[data-refarm-plugin-id="test/web"]');
		expect(mounted).not.toBeNull();
		expect(mounted?.getAttribute("data-refarm-slot-id")).toBe("main");
		expect(mounted?.textContent).toContain("the rendered page");
	});

	it("mounts a pre-built surface handle as-is (no re-specifying options)", async () => {
		const { createCapabilityWebSurfacePlugin } = await import("./index.js");
		const holder = registryWithVerb();
		const handle = createCapabilityWebSurfacePlugin(holder.registry, {
			pluginId: "prebuilt/web",
			content: (d) => String(d.pageHtml ?? ""),
		});
		await bootCapabilityWebFace({
			databaseName: "test-face-2",
			namespace: "test",
			registry: holder.registry,
			content: { verb: "page", field: "pageHtml" },
			surface: handle,
			bootRuntime: async () => mockRuntime(),
		});
		const mounted = document.querySelector('[data-refarm-plugin-id="prebuilt/web"]');
		expect(mounted?.textContent).toContain("the rendered page");
	});

	it("works with no content verb (mechanism/launcher surface)", async () => {
		const holder = registryWithVerb();
		await bootCapabilityWebFace({
			databaseName: "test-face-3",
			namespace: "test",
			registry: holder.registry,
			surface: { pluginId: "cards/web" },
			bootRuntime: async () => mockRuntime(),
		});
		// No verb run; the surface still mounts (its launcher cards are the content).
		expect(holder.runCalls).toBe(0);
		expect(document.querySelector('[data-refarm-plugin-id="cards/web"]')).not.toBeNull();
	});
});
