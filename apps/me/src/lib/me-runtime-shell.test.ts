/** @vitest-environment jsdom */
import type { StudioHostTelemetryEvent } from "@refarm.dev/homestead/sdk";
import type { bootStudioRuntime } from "@refarm.dev/homestead/sdk/runtime";
import type { RuntimePluginHandle } from "@refarm.dev/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bootRefarmMeWorkbench,
	REFARM_ME_LOADING_ID,
} from "./me-runtime";
import {
	REFARM_ME_IDENTITY_STATUS,
	REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
	REFARM_ME_SYNC_STATUS,
} from "./me-surfaces";

describe("refarm.me real shell runtime", () => {
	beforeEach(() => {
		document.body.innerHTML = createShellMarkup();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "group").mockImplementation(() => {});
		vi.spyOn(console, "groupEnd").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("mounts Herald, Firefly, and the personal surface into real Homestead slots", async () => {
		const telemetryHandlers: Array<(event: StudioHostTelemetryEvent) => void> =
			[];
		const plugins = new Map<string, RuntimePluginHandle>();
		const tractor = {
			logLevel: "error",
			plugins: {
				registerInternal: vi.fn((plugin: RuntimePluginHandle) => {
					plugins.set(plugin.id, plugin);
				}),
				get: vi.fn((pluginId: string) => plugins.get(pluginId)),
				getAllPlugins: vi.fn(() => Array.from(plugins.values())),
				findByApi: vi.fn(),
			},
			observe: vi.fn((handler) => {
				telemetryHandlers.push(handler);
			}),
			onNode: vi.fn(),
			emitTelemetry: vi.fn(),
			getHelpNodes: vi.fn().mockResolvedValue([]),
			switchTier: vi.fn(),
		};
		const bootRuntime = vi.fn(async () => ({
			tractor,
			storage: { storeNode: vi.fn(async () => {}) },
		})) as unknown as typeof bootStudioRuntime;

		const workbench = await bootRefarmMeWorkbench({
			document,
			bootRuntime,
			log: { error: vi.fn() },
		});

		expect(document.getElementById(REFARM_ME_LOADING_ID)).toBeNull();
		expect(document.getElementById("system-status")?.textContent).toBe("Ready");
		expect(document.getElementById("system-health")?.textContent).toBe(
			`Identity: ${REFARM_ME_IDENTITY_STATUS}`,
		);
		expect(document.getElementById("refarm-firefly-styles")).not.toBeNull();

		const mountedSurface = document.querySelector(
			`[data-refarm-plugin-id="${REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID}"]`,
		);
		expect(mountedSurface?.getAttribute("data-refarm-slot-id")).toBe("main");
		expect(mountedSurface?.getAttribute("data-refarm-mount-source")).toBe(
			"extension-surface",
		);
		expect(mountedSurface?.textContent).toContain("My Sovereign Space");
		expect(mountedSurface?.textContent).toContain(REFARM_ME_IDENTITY_STATUS);
		expect(mountedSurface?.textContent).toContain(REFARM_ME_SYNC_STATUS);

		for (const handler of telemetryHandlers) {
			handler({
				event: "system:alert",
				payload: { reason: "Personal shell ready" },
			});
		}
		expect(
			document.getElementById("refarm-firefly-toast")?.textContent,
		).toContain("Personal shell ready");

		expect(tractor.emitTelemetry).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "ui:surface_mounted",
				pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			}),
		);
		expect(workbench.surfacePluginIds).toEqual([
			REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
		]);
	});
});

function createShellMarkup(): string {
	return `
		<div id="refarm-shell" data-refarm-shell="viewport">
			<header id="refarm-header" data-refarm-shell-region="header">
				<div id="refarm-slot-logo" class="slot"></div>
				<nav id="refarm-slot-nav" class="slot" aria-label="Refarm sections">
					<a href="/">Dashboard</a>
				</nav>
			</header>
			<main id="refarm-main" data-refarm-shell-region="main" data-refarm-scroll-region="main">
				<div id="refarm-main-frame">
					<div id="refarm-slot-main" class="slot"></div>
					<aside id="refarm-slot-streams" class="slot" hidden></aside>
				</div>
			</main>
			<footer id="refarm-footer" data-refarm-shell-region="statusbar">
				<div id="refarm-slot-statusbar" class="slot" role="status" aria-live="polite">
					<span id="system-status"></span>
					<span id="system-health">pending</span>
				</div>
			</footer>
			<div id="${REFARM_ME_LOADING_ID}" class="refarm-loading-state"></div>
		</div>
	`;
}
