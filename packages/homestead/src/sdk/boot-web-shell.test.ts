/** @vitest-environment jsdom */
import type { RuntimePluginHandle } from "@refarm.dev/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	bootCapabilityWebShell,
	type BootCapabilityWebShellOptions,
} from "./boot-web-shell.js";
import { createHomesteadSurfacePluginHandle } from "./plugin-handle.js";
import type { StudioRuntime } from "./runtime.js";

/** The minimal Homestead slot markup a shell mounts into (mirrors the real Layout). */
function shellMarkup(): string {
	return `
		<div id="refarm-shell">
			<main id="refarm-main">
				<div id="refarm-slot-main" class="slot"></div>
			</main>
		</div>`;
}

/** A mock tractor good enough for the shell: it records registered plugins and hands them
 * back, so setupStudioShell can mount them — no real OPFS/SQLite/browser Tractor. */
function mockRuntime(): { runtime: StudioRuntime; emitted: Array<Record<string, unknown>> } {
	const plugins = new Map<string, RuntimePluginHandle>();
	const emitted: Array<Record<string, unknown>> = [];
	const tractor = {
		logLevel: "error",
		plugins: {
			registerInternal: (plugin: RuntimePluginHandle) => plugins.set(plugin.id, plugin),
			get: (id: string) => plugins.get(id),
			getAllPlugins: () => Array.from(plugins.values()),
			findByApi: () => undefined,
		},
		observe: () => {},
		onNode: () => {},
		emitTelemetry: (event: Record<string, unknown>) => emitted.push(event),
		getHelpNodes: async () => [],
		switchTier: () => {},
	};
	return { runtime: { tractor } as unknown as StudioRuntime, emitted };
}

/** A capability web surface handle that renders a fixed content block — stands in for
 * `createCapabilityWebSurfacePlugin`, which produces the same handle shape. */
function contentSurface(id: string, html: string): RuntimePluginHandle {
	return createHomesteadSurfacePluginHandle({
		id,
		name: id,
		surfaces: [{ kind: "panel", id: `${id}-panel`, slot: "main", capabilities: ["ui:panel:render"] }],
		call: async (fn: string, args?: unknown) => {
			if (fn !== "renderHomesteadSurface") return null;
			const data = (args as { host?: { data?: Record<string, unknown> } } | undefined)?.host?.data;
			return { html: `<section data-test-surface>${String(data?.injected ?? html)}</section>` };
		},
	}) as unknown as RuntimePluginHandle;
}

describe("bootCapabilityWebShell — the surface actually mounts and renders into a slot", () => {
	beforeEach(() => {
		document.body.innerHTML = shellMarkup();
		vi.spyOn(console, "info").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	async function boot(overrides: Partial<BootCapabilityWebShellOptions> = {}) {
		const { runtime, emitted } = mockRuntime();
		const result = await bootCapabilityWebShell({
			databaseName: "test-web",
			namespace: "test",
			surfaces: [contentSurface("test/web", "hello wallet")],
			bootRuntime: async () => runtime,
			...overrides,
		});
		return { result, emitted };
	}

	it("mounts the capability surface into the main slot", async () => {
		const { result } = await boot();
		const mounted = document.querySelector('[data-refarm-plugin-id="test/web"]');
		expect(mounted).not.toBeNull();
		expect(mounted?.getAttribute("data-refarm-slot-id")).toBe("main");
		expect(mounted?.textContent).toContain("hello wallet");
		expect(result.surfacePluginIds).toEqual(["test/web"]);
	});

	it("feeds hostData into the surface content seam without a wrapping arrow", async () => {
		// The ergonomic path: pass a static surfaceContext + hostData; the helper merges
		// hostData into host.data, and the surface renders it. This is what the wallet/reqbench
		// boots rely on to show the actual product content.
		await boot({
			surfaceContext: { hostId: "test", data: {} },
			hostData: { injected: "the real wallet" },
		});
		const mounted = document.querySelector('[data-refarm-plugin-id="test/web"]');
		expect(mounted?.textContent).toContain("the real wallet");
	});

	it("emits ui:surface_mounted telemetry for the mounted surface", async () => {
		const { emitted } = await boot();
		expect(emitted).toContainEqual(
			expect.objectContaining({ event: "ui:surface_mounted", pluginId: "test/web" }),
		);
	});
});
