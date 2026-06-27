/** @vitest-environment jsdom */
import {
	FireflyPlugin,
	type StudioHostTelemetryEvent,
} from "@refarm.dev/homestead/sdk";
import type { bootStudioRuntime } from "@refarm.dev/homestead/sdk/runtime";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import { describe, expect, it, vi } from "vitest";
import {
	bootRefarmMeWorkbench,
	REFARM_ME_LOADING_ID,
	type RefarmMePluginConstructors,
} from "./me-runtime";
import type { createRefarmMeSurfacePlugins } from "./me-surfaces";

describe("refarm.me Firefly runtime", () => {
	it("boots the real Firefly plugin and renders system notifications", async () => {
		document.body.innerHTML = `<div id="${REFARM_ME_LOADING_ID}"></div>`;
		const telemetryHandlers: Array<(event: StudioHostTelemetryEvent) => void> =
			[];
		const tractor = {
			plugins: { registerInternal: vi.fn() },
			observe: vi.fn((handler) => {
				telemetryHandlers.push(handler);
			}),
			emitTelemetry: vi.fn(),
		};
		const bootRuntime = vi.fn(async () => ({
			tractor,
			storage: {
				queryNodes: vi.fn(async () => []),
				storeNode: vi.fn(async () => {}),
			},
		})) as unknown as typeof bootStudioRuntime;
		const setupShell = vi.fn(
			async (_tractor: unknown, _options: unknown) => ({}),
		) as unknown as typeof setupStudioShell;
		const createSurfacePlugins = vi.fn(
			() => [],
		) as unknown as typeof createRefarmMeSurfacePlugins;
		class HeraldPlugin {
			announce(): void {}
		}

		await bootRefarmMeWorkbench({
			document,
			bootRuntime,
			setupShell,
			pluginConstructors: {
				HeraldPlugin,
				FireflyPlugin,
			} as unknown as RefarmMePluginConstructors,
			createSurfacePlugins,
			log: { error: vi.fn() },
		});

		telemetryHandlers[0]?.({
			event: "system:alert",
			payload: { reason: "Personal vault ready" },
		});

		expect(document.getElementById("refarm-firefly-styles")).not.toBeNull();
		expect(document.getElementById("refarm-firefly-toast")?.textContent).toContain(
			"Personal vault ready",
		);
		expect(document.getElementById(REFARM_ME_LOADING_ID)).toBeNull();
	});
});
