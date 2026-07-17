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

	it("a clicked card RUNS its verb and re-renders the surface with fresh content (the dispatch loop)", async () => {
		// A registry with two web verbs: `page` (content, renders the current count) and `bump`
		// (mutates the count). Both surface as cards; the action id is the verb name.
		let count = 0;
		const page = {
			name: "page",
			summary: "the page",
			renderers: { web: { route: "/page" } },
			run: async () => ({ pageHtml: `<p data-count>count: ${count}</p>` }),
		};
		const bump = {
			name: "bump",
			summary: "increment",
			renderers: { web: { route: "/bump" } },
			run: async () => {
				count += 1;
				return { ok: true };
			},
		};
		const entries = [page, bump];
		const registry = {
			get: (name: string) => entries.find((e) => e.name === name),
			list: () => entries,
		} as unknown as CapabilityRegistry;

		await bootCapabilityWebFace({
			databaseName: "test-dispatch",
			namespace: "test",
			registry,
			content: { verb: "page", field: "pageHtml" },
			surface: { pluginId: "disp/web", content: (d) => String(d.pageHtml ?? "") },
			bootRuntime: async () => mockRuntime(),
		});

		const mounted = () => document.querySelector('[data-refarm-plugin-id="disp/web"]');
		// Initial render: count 0, and the launcher carries a clickable `bump` card.
		expect(mounted()?.textContent).toContain("count: 0");
		const bumpCard = mounted()?.querySelector<HTMLElement>('[data-refarm-surface-action-id="bump"]');
		expect(bumpCard).not.toBeNull();

		// Click it → the verb runs (count → 1), content re-runs, and the surface re-renders IN PLACE.
		bumpCard!.click();
		const deadline = Date.now() + 1000;
		while (Date.now() < deadline && !mounted()?.textContent?.includes("count: 1")) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(count).toBe(1);
		expect(mounted()?.textContent).toContain("count: 1");
		// The surface was updated in place — exactly ONE mount for the plugin (no duplicate wrap).
		expect(document.querySelectorAll('[data-refarm-plugin-id="disp/web"]')).toHaveLength(1);

		// Click AGAIN after the rerender: the action listener is bound ONCE on the reused wrap, so a
		// second click bumps to exactly 2. A stacked listener (broken one-shot guard) would give 3.
		mounted()?.querySelector<HTMLElement>('[data-refarm-surface-action-id="bump"]')!.click();
		const deadline2 = Date.now() + 1000;
		while (Date.now() < deadline2 && !mounted()?.textContent?.includes("count: 2")) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(count).toBe(2);
		expect(mounted()?.textContent).toContain("count: 2");
		expect(document.querySelectorAll('[data-refarm-plugin-id="disp/web"]')).toHaveLength(1);
	});

	it("a card for a verb with args renders inputs, and Run dispatches with the collected values", async () => {
		// `echo` takes a required `msg` arg; `page` renders the last echoed message.
		let last = "";
		const page = {
			name: "page",
			summary: "page",
			renderers: { web: { route: "/page" } },
			run: async () => ({ pageHtml: `<p data-msg>msg: ${last}</p>` }),
		};
		const echo = {
			name: "echo",
			summary: "echo a message",
			args: [{ name: "msg", required: true }],
			renderers: { web: { route: "/echo" } },
			run: async (input: { args?: { msg?: unknown } }) => {
				last = String(input.args?.msg ?? "");
				return { ok: true };
			},
		};
		const entries = [page, echo];
		const registry = {
			get: (name: string) => entries.find((e) => e.name === name),
			list: () => entries,
		} as unknown as CapabilityRegistry;

		await bootCapabilityWebFace({
			databaseName: "test-arg",
			namespace: "test",
			registry,
			content: { verb: "page", field: "pageHtml" },
			surface: { pluginId: "arg/web", content: (d) => String(d.pageHtml ?? "") },
			bootRuntime: async () => mockRuntime(),
		});

		const mounted = () => document.querySelector('[data-refarm-plugin-id="arg/web"]');
		// The echo card rendered a text input for its `msg` arg + a Run button.
		const input = mounted()?.querySelector<HTMLInputElement>('[data-refarm-arg="msg"]');
		expect(input).not.toBeNull();
		const runBtn = mounted()?.querySelector<HTMLElement>(
			'[data-refarm-verb="echo"] [data-refarm-surface-action-id="echo"]',
		);
		expect(runBtn).not.toBeNull();

		// Type a value, click Run → the verb runs WITH the typed arg, and the content reflects it.
		input!.value = "hello";
		runBtn!.click();
		const deadline = Date.now() + 1000;
		while (Date.now() < deadline && !mounted()?.textContent?.includes("msg: hello")) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(last).toBe("hello");
		expect(mounted()?.textContent).toContain("msg: hello");
	});

	it("paints a dispatched verb's OWN result (declared resultField) into the action-result region (B2)", async () => {
		// `search` declares its HTML result lives in `resultsHtml`; `page` is the dashboard content.
		const page = {
			name: "page",
			summary: "page",
			renderers: { web: { route: "/page" } },
			run: async () => ({ pageHtml: `<p data-dash>dashboard</p>` }),
		};
		const search = {
			name: "search",
			summary: "search the corpus",
			args: [{ name: "query", required: true }],
			renderers: { web: { route: "/search", resultField: "resultsHtml" } },
			run: async (input: { args?: { query?: unknown } }) => {
				const q = String(input.args?.query ?? "");
				return { ok: true, matched: 1, resultsHtml: `<ul data-hits><li>hit for ${q}</li></ul>` };
			},
		};
		const entries = [page, search];
		const registry = {
			get: (name: string) => entries.find((e) => e.name === name),
			list: () => entries,
		} as unknown as CapabilityRegistry;

		await bootCapabilityWebFace({
			databaseName: "test-b2",
			namespace: "test",
			registry,
			content: { verb: "page", field: "pageHtml" },
			surface: { pluginId: "b2/web", content: (d) => String(d.pageHtml ?? "") },
			bootRuntime: async () => mockRuntime(),
		});

		const mounted = () => document.querySelector('[data-refarm-plugin-id="b2/web"]');
		// Nothing dispatched yet → no action-result region, but the dashboard is present.
		expect(mounted()?.querySelector("[data-refarm-action-result]")).toBeNull();
		expect(mounted()?.textContent).toContain("dashboard");

		const input = mounted()?.querySelector<HTMLInputElement>('[data-refarm-arg="query"]');
		input!.value = "CNPJ";
		mounted()?.querySelector<HTMLElement>('[data-refarm-verb="search"] [data-refarm-surface-action-id="search"]')!.click();

		const deadline = Date.now() + 1000;
		while (Date.now() < deadline && !mounted()?.querySelector("[data-refarm-action-result]")) {
			await new Promise((r) => setTimeout(r, 5));
		}
		// The search verb's OWN HTML result is painted into the action-result region — the query
		// SHOWS its matches, not just a refreshed dashboard. And the dashboard still stands.
		const region = mounted()?.querySelector("[data-refarm-action-result]");
		expect(region).not.toBeNull();
		expect(region?.getAttribute("data-refarm-action-verb")).toBe("search");
		expect(region?.getAttribute("data-refarm-action-ok")).toBe("true");
		expect(region?.textContent).toContain("hit for CNPJ");
		expect(mounted()?.textContent).toContain("dashboard");
	});

	it("a dispatched verb with no HTML result still reports a status (never a silent click)", async () => {
		// `ping` returns a bare error envelope (no resultField, no html) — the loop surfaces its message.
		const page = {
			name: "page",
			summary: "page",
			renderers: { web: { route: "/page" } },
			run: async () => ({ pageHtml: `<p>dash</p>` }),
		};
		const ping = {
			name: "ping",
			summary: "ping",
			renderers: { web: { route: "/ping" } },
			run: async () => ({ ok: false, message: "runtime unreachable" }),
		};
		const entries = [page, ping];
		const registry = {
			get: (name: string) => entries.find((e) => e.name === name),
			list: () => entries,
		} as unknown as CapabilityRegistry;

		await bootCapabilityWebFace({
			databaseName: "test-b2-status",
			namespace: "test",
			registry,
			content: { verb: "page", field: "pageHtml" },
			surface: { pluginId: "b2s/web", content: (d) => String(d.pageHtml ?? "") },
			bootRuntime: async () => mockRuntime(),
		});

		const mounted = () => document.querySelector('[data-refarm-plugin-id="b2s/web"]');
		mounted()?.querySelector<HTMLElement>('[data-refarm-surface-action-id="ping"]')!.click();
		const deadline = Date.now() + 1000;
		while (Date.now() < deadline && !mounted()?.querySelector('[data-refarm-action-result][data-refarm-action-ok="false"]')) {
			await new Promise((r) => setTimeout(r, 5));
		}
		const region = mounted()?.querySelector("[data-refarm-action-result]");
		expect(region?.getAttribute("data-refarm-action-verb")).toBe("ping");
		expect(region?.getAttribute("data-refarm-action-ok")).toBe("false");
		expect(region?.textContent).toContain("runtime unreachable");
	});
});
