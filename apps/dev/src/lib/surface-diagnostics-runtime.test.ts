/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import type { bootStudioRuntime } from "@refarm.dev/homestead/sdk/runtime";
import type { registerStudioPluginManifest } from "@refarm.dev/homestead/sdk/plugin-handle";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import type { createStudioSurfaceDiagnosticsPlugins } from "./surface-diagnostics";
import {
	EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID,
	STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
} from "./surface-diagnostics";
import type {
	mountReactiveStudioSurfaceLedgerElement,
	StudioSurfaceLedgerElement,
} from "./surface-ledger";
import {
	bootStudioSurfaceDiagnosticsWorkbench,
	renderStudioSurfaceDiagnosticsBootFailure,
	SURFACE_DIAGNOSTICS_LEDGER_SELECTOR,
	SURFACE_DIAGNOSTICS_STATUS_SELECTOR,
} from "./surface-diagnostics-runtime";

describe("surface diagnostics runtime", () => {
	it("boots the diagnostics workbench behind the Astro page boundary", async () => {
		const doc = createDiagnosticsDocument();
		const tractor = createTractorFixture();
		const bootRuntime = vi.fn(async () => ({
			tractor,
		})) as unknown as typeof bootStudioRuntime;
		const setupShell = vi.fn(
			async () => ({}),
		) as unknown as typeof setupStudioShell;
		const registerManifest = vi.fn(
			async () => undefined,
		) as unknown as typeof registerStudioPluginManifest;
		const defineLedgerElement = vi.fn();
		const ledgerController = {
			element: doc.querySelector<HTMLElement>(
				SURFACE_DIAGNOSTICS_LEDGER_SELECTOR,
			)!,
			refresh: vi.fn(),
			dispose: vi.fn(),
		};
		const mountLedger = vi.fn(
			() => ledgerController,
		) as unknown as typeof mountReactiveStudioSurfaceLedgerElement;
		const createPlugins = vi.fn((emit) => {
			emit(STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID, "diagnostic:event", {
				ok: true,
			});
			return [
				createPluginFixture(STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID),
				createPluginFixture(EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID),
			];
		}) as unknown as typeof createStudioSurfaceDiagnosticsPlugins;
		const createContextProvider = vi.fn(() => vi.fn());
		const createActionHandler = vi.fn(() => vi.fn());

		const workbench = await bootStudioSurfaceDiagnosticsWorkbench({
			document: doc,
			now: () => 42,
			bootRuntime,
			setupShell,
			registerManifest,
			createPlugins,
			createContextProvider,
			createActionHandler,
			defineLedgerElement,
			mountLedger,
		});

		expect(bootRuntime).toHaveBeenCalledWith({
			databaseName: "refarm-surfaces-42",
			namespace: "studio-surfaces",
			identityId: "surface-diagnostics",
		});
		expect(tractor.emitTelemetry).toHaveBeenCalledWith({
			event: "diagnostic:event",
			pluginId: STUDIO_SURFACE_DIAGNOSTICS_PLUGIN_ID,
			payload: { ok: true },
		});
		expect(registerManifest).toHaveBeenCalledWith(
			tractor.registry,
			expect.objectContaining({ id: EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID }),
			{ status: "validated" },
		);
		expect(tractor.plugins.registerInternal).toHaveBeenCalledTimes(2);
		expect(setupShell).toHaveBeenCalledWith(
			tractor,
			expect.objectContaining({
				surfaceContext: expect.any(Function),
				surfaceAction: expect.any(Function),
			}),
		);
		expect(defineLedgerElement).toHaveBeenCalled();
		expect(mountLedger).toHaveBeenCalledWith(
			doc.querySelector<StudioSurfaceLedgerElement>(
				SURFACE_DIAGNOSTICS_LEDGER_SELECTOR,
			),
			expect.objectContaining({
				telemetry: tractor,
				telemetryEvents: [{ event: "existing:event" }],
			}),
		);
		expect(
			doc.querySelector<HTMLElement>(SURFACE_DIAGNOSTICS_STATUS_SELECTOR)
				?.textContent,
		).toBe("Ready");
		expect(workbench).toEqual({ tractor, ledger: ledgerController });
	});

	it("renders boot failure copy without leaking runtime logic into Astro", () => {
		const doc = createDiagnosticsDocument();

		renderStudioSurfaceDiagnosticsBootFailure(new Error("OPFS denied"), {
			document: doc,
		});

		expect(
			doc.querySelector<HTMLElement>(SURFACE_DIAGNOSTICS_STATUS_SELECTOR)
				?.textContent,
		).toBe("Boot failed");
		expect(
			doc.querySelector<HTMLElement>(SURFACE_DIAGNOSTICS_LEDGER_SELECTOR)
				?.textContent,
		).toBe("Surface diagnostics boot failed: OPFS denied");
	});
});

function createDiagnosticsDocument(): Document {
	const status = document.createElement("span");
	status.dataset.refarmSurfacesStatus = "";
	status.textContent = "Booting";
	const ledger = document.createElement("refarm-surface-ledger");
	ledger.dataset.refarmSurfacesLedgerSlot = "";
	document.body.replaceChildren(status, ledger);
	return document;
}

function createTractorFixture() {
	return {
		registry: { source: "registry" },
		plugins: { registerInternal: vi.fn() },
		telemetry: { dump: vi.fn(() => [{ event: "existing:event" }]) },
		emitTelemetry: vi.fn(),
	};
}

function createPluginFixture(id: string) {
	return {
		id,
		manifest: {
			id,
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						slot: "streams",
					},
				],
			},
		},
	};
}
