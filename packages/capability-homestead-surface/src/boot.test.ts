/** @vitest-environment jsdom */
import type { CapabilityRegistry } from "@refarm.dev/capabilities";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootCapabilityWebFace, mountCapabilityWebView, wireCapabilityFormDispatch } from "./boot.js";
import { renderCapabilityFormMessage } from "./index.js";

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

	it("paints a content verb's *Html field with NO declared resultField (the generic fallback)", async () => {
		// `dashboard` returns `dashboardHtml` but declares no resultField — the loop's *Html scan
		// must still paint it (so wallet/sovereignty/governance content cards render on a click).
		const page = {
			name: "page",
			summary: "page",
			renderers: { web: { route: "/page" } },
			run: async () => ({ pageHtml: `<p>dash</p>` }),
		};
		const dashboard = {
			name: "dashboard",
			summary: "open the dashboard",
			renderers: { web: { route: "/dashboard" } },
			run: async () => ({ ok: true, dashboardHtml: `<div data-dash-render>the dashboard render</div>` }),
		};
		const entries = [page, dashboard];
		const registry = {
			get: (name: string) => entries.find((e) => e.name === name),
			list: () => entries,
		} as unknown as CapabilityRegistry;

		await bootCapabilityWebFace({
			databaseName: "test-b2-fallback",
			namespace: "test",
			registry,
			content: { verb: "page", field: "pageHtml" },
			surface: { pluginId: "b2f/web", content: (d) => String(d.pageHtml ?? "") },
			bootRuntime: async () => mockRuntime(),
		});
		const mounted = () => document.querySelector('[data-refarm-plugin-id="b2f/web"]');
		mounted()?.querySelector<HTMLElement>('[data-refarm-surface-action-id="dashboard"]')!.click();
		const deadline = Date.now() + 1000;
		while (Date.now() < deadline && !mounted()?.querySelector("[data-refarm-action-result]")) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(mounted()?.querySelector("[data-refarm-action-result]")?.textContent).toContain("the dashboard render");
	});

	it("tolerates a verb whose run() resolves null/undefined (no uncaught throw, reports a status)", async () => {
		const page = {
			name: "page",
			summary: "page",
			renderers: { web: { route: "/page" } },
			run: async () => ({ pageHtml: `<p>dash</p>` }),
		};
		const nullish = {
			name: "nullish",
			summary: "returns nothing",
			renderers: { web: { route: "/nullish" } },
			run: async () => undefined,
		};
		const entries = [page, nullish];
		const registry = {
			get: (name: string) => entries.find((e) => e.name === name),
			list: () => entries,
		} as unknown as CapabilityRegistry;

		await bootCapabilityWebFace({
			databaseName: "test-b2-null",
			namespace: "test",
			registry,
			content: { verb: "page", field: "pageHtml" },
			surface: { pluginId: "b2n/web", content: (d) => String(d.pageHtml ?? "") },
			bootRuntime: async () => mockRuntime(),
		});
		const mounted = () => document.querySelector('[data-refarm-plugin-id="b2n/web"]');
		// The click must NOT throw uncaught — the region appears with a status and the dashboard stands.
		mounted()?.querySelector<HTMLElement>('[data-refarm-surface-action-id="nullish"]')!.click();
		const deadline = Date.now() + 1000;
		while (Date.now() < deadline && !mounted()?.querySelector("[data-refarm-action-result]")) {
			await new Promise((r) => setTimeout(r, 5));
		}
		expect(mounted()?.querySelector('[data-refarm-action-result][data-refarm-action-verb="nullish"]')).not.toBeNull();
		expect(mounted()?.textContent).toContain("dash");
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

/** A registry with one verb returning `payload`, and a way to see how many times it ran. */
function viewRegistry(payload: unknown): { registry: CapabilityRegistry; runCalls: () => number } {
	let runCalls = 0;
	const descriptor = {
		name: "view",
		renderers: { web: { route: "/view" } },
		run: async () => {
			runCalls += 1;
			return payload;
		},
	};
	const registry = {
		get: (name: string) => (name === "view" ? descriptor : undefined),
		list: () => [{ name: "view" }],
	} as unknown as CapabilityRegistry;
	return { registry, runCalls: () => runCalls };
}

describe("mountCapabilityWebView — custom substrate view, framework-owned loading lifecycle", () => {
	beforeEach(() => {
		document.body.innerHTML = `<div id="loading-overlay">carregando…</div><div id="view-mount"></div>`;
		vi.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("runs the content verb, hands its result to render, and removes the overlay", async () => {
		const holder = viewRegistry({ items: ["a", "b"] });
		let seen: unknown;
		await mountCapabilityWebView<{ items: string[] }>({
			namespace: "test",
			registry: holder.registry,
			content: { verb: "view" },
			view: {
				mount: "view-mount",
				render: ({ result, mount }) => {
					seen = result;
					mount.innerHTML = `<ul data-items>${result.items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
				},
			},
		});
		expect(holder.runCalls()).toBe(1);
		expect(seen).toEqual({ items: ["a", "b"] });
		expect(document.querySelector("[data-items]")?.textContent).toBe("ab");
		expect(document.getElementById("loading-overlay")).toBeNull(); // overlay removed on success
	});

	it("paints emptyHtml and SKIPS render when isEmpty(result) is true — a graceful empty state, overlay still cleared", async () => {
		const holder = viewRegistry({ items: [] });
		let rendered = false;
		await mountCapabilityWebView<{ items: string[] }>({
			namespace: "test",
			registry: holder.registry,
			content: { verb: "view" },
			view: {
				mount: "view-mount",
				isEmpty: (r) => r.items.length === 0,
				emptyHtml: `<p data-empty>Nada ainda</p>`,
				render: () => {
					rendered = true;
				},
			},
		});
		expect(rendered).toBe(false); // render skipped
		expect(document.querySelector("[data-empty]")?.textContent).toBe("Nada ainda");
		expect(document.getElementById("loading-overlay")).toBeNull(); // empty is not an error → overlay cleared
	});

	it("with NO content verb, render gets result=undefined + the registry (a live journey view)", async () => {
		const holder = viewRegistry({ never: "run" });
		let ctxRegistry: unknown;
		let ctxResult: unknown = "sentinel";
		await mountCapabilityWebView({
			namespace: "test",
			registry: holder.registry,
			view: {
				mount: "view-mount",
				render: ({ result, registry, mount }) => {
					ctxResult = result;
					ctxRegistry = registry;
					mount.innerHTML = `<div data-journey>mounted</div>`;
				},
			},
		});
		expect(holder.runCalls()).toBe(0); // no content verb ran
		expect(ctxResult).toBeUndefined();
		expect(ctxRegistry).toBe(holder.registry);
		expect(document.querySelector("[data-journey]")).not.toBeNull();
		expect(document.getElementById("loading-overlay")).toBeNull();
	});

	it("paints the error into the overlay when the mount element is missing (never a silent blank)", async () => {
		const holder = viewRegistry({ items: [] });
		await mountCapabilityWebView({
			namespace: "test",
			registry: holder.registry,
			errorLabel: "Falha ao abrir a visão",
			view: { mount: "does-not-exist", render: () => {} },
		});
		const overlay = document.getElementById("loading-overlay");
		expect(overlay).not.toBeNull(); // overlay is KEPT on failure, now showing the error
		expect(overlay?.textContent).toContain("Falha ao abrir a visão");
		expect(overlay?.textContent).toContain("does-not-exist");
	});

	it("paints the error into the overlay when render throws (the boot crash is visible)", async () => {
		const holder = viewRegistry({ items: ["x"] });
		await mountCapabilityWebView({
			namespace: "test",
			registry: holder.registry,
			errorLabel: "Falha ao abrir a visão",
			content: { verb: "view" },
			view: {
				mount: "view-mount",
				render: () => {
					throw new Error("render blew up");
				},
			},
		});
		const overlay = document.getElementById("loading-overlay");
		expect(overlay?.textContent).toContain("Falha ao abrir a visão");
		expect(overlay?.textContent).toContain("render blew up");
	});

	it("renders a capability verb as an inline conversation FORM and dispatches it on submit (pattern B)", async () => {
		const registry = {
			get: (name: string) =>
				name === "search"
					? {
							name: "search",
							summary: "Search things",
							args: [{ name: "query", required: true }],
							renderers: { web: { resultField: "resultsHtml" } },
							run: async (input: { args?: { query?: unknown } }) => ({
								ok: true,
								resultsHtml: `<ul data-hits>hit for ${String(input.args?.query ?? "")}</ul>`,
							}),
						}
					: undefined,
			list: () => [{ name: "search" }],
		} as unknown as CapabilityRegistry;

		document.body.innerHTML = `<div id="convo"></div>`;
		const container = document.getElementById("convo")!;
		// The agent "offers" the search verb as an inline form message.
		container.innerHTML = renderCapabilityFormMessage(registry, "search", { submitLabel: "Buscar" });
		expect(container.querySelector('form.refarm-capability-form[data-refarm-verb="search"]')).not.toBeNull();
		expect(container.querySelector('[data-refarm-arg="query"]')).not.toBeNull();
		expect(container.querySelector("button.refarm-capability-form-submit")?.textContent).toBe("Buscar");

		// Wire dispatch: the user fills + submits → the verb runs → the result is reported back.
		const results: Array<{ verb: string; html?: string }> = [];
		wireCapabilityFormDispatch(container, registry, (verb, result) => {
			results.push({ verb, html: result.html });
		});
		(container.querySelector('[data-refarm-arg="query"]') as HTMLInputElement).value = "CNPJ";
		container.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

		const deadline = Date.now() + 1000;
		while (Date.now() < deadline && results.length === 0) await new Promise((r) => setTimeout(r, 5));
		expect(results).toHaveLength(1);
		expect(results[0]!.verb).toBe("search");
		expect(results[0]!.html).toContain("hit for CNPJ");
	});

	it("throws (→ overlay error) when the content verb is not in the registry", async () => {
		const holder = viewRegistry({ items: [] });
		await mountCapabilityWebView({
			namespace: "test",
			registry: holder.registry,
			content: { verb: "missing" },
			view: { mount: "view-mount", render: () => {} },
		});
		const overlay = document.getElementById("loading-overlay");
		expect(overlay?.textContent).toContain("missing verb not found in the registry");
	});
});
