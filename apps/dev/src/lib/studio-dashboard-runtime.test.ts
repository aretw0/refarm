/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import type { bootStudioRuntime } from "@refarm.dev/homestead/sdk/runtime";
import type { createStudioPluginHandle } from "@refarm.dev/homestead/sdk/plugin-handle";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import type { mountStudioStreamDemoControl } from "./stream-demo";
import type { mountReactiveStudioSurfaceInspectorElement } from "./surface-inspector";
import {
	bootStudioDashboardWorkbench,
	renderStudioDashboardBootFailure,
	resolveStudioDashboardMode,
	STUDIO_DASHBOARD_LOADING_ID,
	STUDIO_DASHBOARD_MODE_STORAGE_KEY,
	STUDIO_DASHBOARD_RENDERER,
	STUDIO_DASHBOARD_STATUSBAR_ID,
} from "./studio-dashboard-runtime";
import { STUDIO_STREAM_DEMO_STORAGE_KEY } from "./stream-demo";

describe("studio dashboard runtime", () => {
	it("boots the dashboard behind the Astro page boundary", async () => {
		const doc = createDashboardDocument();
		const localStore = createStorageFixture({
			[STUDIO_DASHBOARD_MODE_STORAGE_KEY]: "citizen",
			[STUDIO_STREAM_DEMO_STORAGE_KEY]: "1",
		});
		const sessionStore = createStorageFixture();
		const tractor = createTractorFixture();
		const bootRuntime = vi.fn(async () => ({
			tractor,
		})) as unknown as typeof bootStudioRuntime;
		const setupShell = vi.fn(
			async () => ({}),
		) as unknown as typeof setupStudioShell;
		const seedStreamDemo = vi.fn(async () => undefined);
		const reload = vi.fn();
		const pluginConstructors = createPluginConstructors();
		const createPluginHandle = vi.fn((config) => ({
			...config,
			id: config.id,
		})) as unknown as typeof createStudioPluginHandle;
		let toggleDemo: (() => void) | undefined;
		const mountStreamDemoControl = vi.fn((_container, options) => {
			toggleDemo = options.onToggle;
			const button = doc.createElement("button");
			button.type = "button";
			return button;
		}) as unknown as typeof mountStudioStreamDemoControl;
		const inspectorController = {
			element: doc.createElement("details"),
			refresh: vi.fn(),
			dispose: vi.fn(),
		};
		const mountInspector = vi.fn(
			() => inspectorController,
		) as unknown as typeof mountReactiveStudioSurfaceInspectorElement;

		const workbench = await bootStudioDashboardWorkbench({
			document: doc,
			localStorage: localStore,
			sessionStorage: sessionStore,
			locationHref: "/?stream-demo",
			baseUrl: "/studio/",
			reload,
			bootRuntime,
			setupShell,
			createPluginHandle,
			pluginConstructors,
			mountStreamDemoControl,
			mountInspector,
			seedStreamDemo,
			log: { info: vi.fn(), error: vi.fn() },
		});

		expect(bootRuntime).toHaveBeenCalledWith({
			databaseName: "refarm-main",
			namespace: "studio-main",
			identityId: "core",
			identityPublicKey: "root",
			connectBrowserSync: true,
			tractorSync: true,
		});
		expect(tractor.plugins.registerInternal).toHaveBeenCalledTimes(4);
		expect(createPluginHandle).toHaveBeenCalledWith(
			expect.objectContaining({ id: "sower" }),
		);
		expect(createPluginHandle).toHaveBeenCalledWith(
			expect.objectContaining({ id: "scarecrow" }),
		);
		expect(createPluginHandle).toHaveBeenCalledWith(
			expect.objectContaining({ id: "firefly" }),
		);
		expect(setupShell).toHaveBeenCalledWith(
			tractor,
			expect.objectContaining({
				surfaceContext: expect.any(Function),
				surfaceAction: expect.any(Function),
			}),
		);
		expect(mountStreamDemoControl).toHaveBeenCalledWith(
			doc.getElementById(STUDIO_DASHBOARD_STATUSBAR_ID),
			expect.objectContaining({ enabled: true }),
		);
		expect(mountInspector).toHaveBeenCalledWith(
			expect.objectContaining({ tagName: "REFARM-SURFACE-INSPECTOR" }),
			expect.objectContaining({
				telemetry: tractor,
				telemetryEvents: [{ event: "existing:event" }],
			}),
		);
		expect(seedStreamDemo).toHaveBeenCalledWith(tractor);
		expect(pluginConstructors.herald.announce).toHaveBeenCalled();
		expect(pluginConstructors.herald.monitorLifecycle).toHaveBeenCalled();
		expect(doc.getElementById(STUDIO_DASHBOARD_LOADING_ID)).toBeNull();
		expect(workbench).toEqual({
			tractor,
			renderer: STUDIO_DASHBOARD_RENDERER,
			streamDemoEnabled: true,
			inspector: inspectorController,
		});
		expect(workbench.renderer).toEqual(
			expect.objectContaining({
				id: "refarm-dev-web",
				kind: "web",
				label: "Refarm Studio Web",
			}),
		);

		toggleDemo?.();
		expect(localStore.removeItem).toHaveBeenCalledWith(
			STUDIO_STREAM_DEMO_STORAGE_KEY,
		);
		expect(reload).toHaveBeenCalled();
	});

	it("resolves mode from local storage, session storage, then visitor", () => {
		expect(
			resolveStudioDashboardMode(
				createStorageFixture({
					[STUDIO_DASHBOARD_MODE_STORAGE_KEY]: "citizen",
				}),
				createStorageFixture({
					[STUDIO_DASHBOARD_MODE_STORAGE_KEY]: "visitor",
				}),
			),
		).toBe("citizen");
		expect(
			resolveStudioDashboardMode(
				createStorageFixture(),
				createStorageFixture({
					[STUDIO_DASHBOARD_MODE_STORAGE_KEY]: "session",
				}),
			),
		).toBe("session");
		expect(
			resolveStudioDashboardMode(
				createStorageFixture(),
				createStorageFixture(),
			),
		).toBe("visitor");
	});

	it("renders safe boot failure UI", () => {
		const doc = createDashboardDocument();
		const reload = vi.fn();

		renderStudioDashboardBootFailure(new Error("OPFS <blocked>"), {
			document: doc,
			reload,
		});

		const loading = doc.getElementById(STUDIO_DASHBOARD_LOADING_ID);
		expect(loading?.textContent).toContain("Boot Failed: OPFS <blocked>");
		const retry = loading?.querySelector("button");
		expect(retry?.textContent).toBe("Retry");
		retry?.click();
		expect(reload).toHaveBeenCalled();
	});
});

function createDashboardDocument(): Document {
	const loading = document.createElement("div");
	loading.id = STUDIO_DASHBOARD_LOADING_ID;
	const statusbar = document.createElement("div");
	statusbar.id = STUDIO_DASHBOARD_STATUSBAR_ID;
	document.body.replaceChildren(loading, statusbar);
	return document;
}

function createStorageFixture(seed: Record<string, string> = {}) {
	const values = new Map(Object.entries(seed));
	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
		removeItem: vi.fn((key: string) => values.delete(key)),
	};
}

function createTractorFixture() {
	return {
		plugins: { registerInternal: vi.fn() },
		telemetry: { dump: vi.fn(() => [{ event: "existing:event" }]) },
		emitTelemetry: vi.fn(),
		storeNode: vi.fn(),
	};
}

function createPluginConstructors() {
	const herald = {
		announce: vi.fn(),
		monitorLifecycle: vi.fn(),
	};
	class HeraldPlugin {
		announce = herald.announce;
		monitorLifecycle = herald.monitorLifecycle;
	}
	class SowerPlugin {
		getOnboardingNode = vi.fn(async () => ({ id: "onboarding" }));
		onEvent = vi.fn();
	}
	class FireflyPlugin {
		showToast = vi.fn();
		spotlight = vi.fn();
	}
	return { HeraldPlugin, SowerPlugin, FireflyPlugin, herald };
}
