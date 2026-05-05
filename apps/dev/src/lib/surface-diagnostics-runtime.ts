import { registerStudioPluginManifest } from "@refarm.dev/homestead/sdk/plugin-handle";
import { bootStudioRuntime } from "@refarm.dev/homestead/sdk/runtime";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import type { HomesteadSurfaceTelemetryEvent } from "@refarm.dev/homestead/sdk/surface-inspector";
import type { PluginInstance } from "@refarm.dev/tractor";
import {
	createStudioSurfaceDiagnosticsActionHandler,
	createStudioSurfaceDiagnosticsContextProvider,
	createStudioSurfaceDiagnosticsPlugins,
	EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID,
} from "./surface-diagnostics";
import {
	defineStudioSurfaceLedgerElement,
	mountReactiveStudioSurfaceLedgerElement,
	type StudioSurfaceLedgerController,
	type StudioSurfaceLedgerElement,
} from "./surface-ledger";

export const SURFACE_DIAGNOSTICS_STATUS_SELECTOR =
	"[data-refarm-surfaces-status]";
export const SURFACE_DIAGNOSTICS_LEDGER_SELECTOR =
	"[data-refarm-surfaces-ledger-slot]";

type StudioSurfaceDiagnosticsRuntime = Awaited<
	ReturnType<typeof bootStudioRuntime>
>;
type StudioSurfaceDiagnosticsTractor =
	StudioSurfaceDiagnosticsRuntime["tractor"];
type SetupStudioShell = typeof setupStudioShell;

export interface StudioSurfaceDiagnosticsWorkbench {
	tractor: StudioSurfaceDiagnosticsTractor;
	ledger?: StudioSurfaceLedgerController;
}

export interface StudioSurfaceDiagnosticsWorkbenchOptions {
	document?: Document;
	now?: () => number;
	bootRuntime?: typeof bootStudioRuntime;
	setupShell?: SetupStudioShell;
	registerManifest?: typeof registerStudioPluginManifest;
	createPlugins?: typeof createStudioSurfaceDiagnosticsPlugins;
	createContextProvider?: typeof createStudioSurfaceDiagnosticsContextProvider;
	createActionHandler?: typeof createStudioSurfaceDiagnosticsActionHandler;
	defineLedgerElement?: typeof defineStudioSurfaceLedgerElement;
	mountLedger?: typeof mountReactiveStudioSurfaceLedgerElement;
}

export async function bootStudioSurfaceDiagnosticsWorkbench(
	options: StudioSurfaceDiagnosticsWorkbenchOptions = {},
): Promise<StudioSurfaceDiagnosticsWorkbench> {
	const doc = options.document ?? document;
	const runtime = await (options.bootRuntime ?? bootStudioRuntime)({
		databaseName: `refarm-surfaces-${(options.now ?? Date.now)()}`,
		namespace: "studio-surfaces",
		identityId: "surface-diagnostics",
	});
	const tractor = runtime.tractor;

	await registerSurfaceDiagnosticsPlugins(tractor, options);

	const setupShell = options.setupShell ?? (await loadSetupStudioShell());
	await setupShell(tractor, {
		surfaceContext: (
			options.createContextProvider ??
			createStudioSurfaceDiagnosticsContextProvider
		)(),
		surfaceAction: (
			options.createActionHandler ?? createStudioSurfaceDiagnosticsActionHandler
		)(),
	});

	const ledger = mountSurfaceDiagnosticsLedger(doc, tractor, options);
	setSurfaceDiagnosticsStatus(doc, "Ready");

	return { tractor, ledger };
}

export function renderStudioSurfaceDiagnosticsBootFailure(
	error: unknown,
	options: Pick<StudioSurfaceDiagnosticsWorkbenchOptions, "document"> = {},
): void {
	const doc = options.document ?? document;
	setSurfaceDiagnosticsStatus(doc, "Boot failed");
	const ledgerSlot = doc.querySelector<HTMLElement>(
		SURFACE_DIAGNOSTICS_LEDGER_SELECTOR,
	);
	if (!ledgerSlot) return;

	const message = doc.createElement("p");
	message.className = "refarm-card-body";
	message.textContent = `Surface diagnostics boot failed: ${surfaceDiagnosticsErrorMessage(error)}`;
	ledgerSlot.replaceChildren(message);
}

export function setSurfaceDiagnosticsStatus(doc: Document, text: string): void {
	const status = doc.querySelector<HTMLElement>(
		SURFACE_DIAGNOSTICS_STATUS_SELECTOR,
	);
	if (status) status.textContent = text;
}

async function registerSurfaceDiagnosticsPlugins(
	tractor: StudioSurfaceDiagnosticsTractor,
	options: StudioSurfaceDiagnosticsWorkbenchOptions,
): Promise<void> {
	const createPlugins =
		options.createPlugins ?? createStudioSurfaceDiagnosticsPlugins;
	for (const plugin of createPlugins((pluginId, event, payload) =>
		tractor.emitTelemetry({ event, payload, pluginId }),
	)) {
		if (plugin.id === EXTERNAL_VALIDATED_SURFACE_PLUGIN_ID) {
			await (options.registerManifest ?? registerStudioPluginManifest)(
				tractor.registry,
				plugin,
				{ status: "validated" },
			);
		}
		tractor.plugins.registerInternal(plugin as PluginInstance);
	}
}

function mountSurfaceDiagnosticsLedger(
	doc: Document,
	tractor: StudioSurfaceDiagnosticsTractor,
	options: StudioSurfaceDiagnosticsWorkbenchOptions,
): StudioSurfaceLedgerController | undefined {
	(options.defineLedgerElement ?? defineStudioSurfaceLedgerElement)();
	const ledgerSlot = doc.querySelector<StudioSurfaceLedgerElement>(
		SURFACE_DIAGNOSTICS_LEDGER_SELECTOR,
	);
	if (!ledgerSlot) return undefined;

	return (options.mountLedger ?? mountReactiveStudioSurfaceLedgerElement)(
		ledgerSlot,
		{
			telemetry: tractor,
			telemetryEvents:
				tractor.telemetry.dump() as readonly HomesteadSurfaceTelemetryEvent[],
		},
	);
}

async function loadSetupStudioShell(): Promise<SetupStudioShell> {
	const shell = await import("@refarm.dev/homestead/sdk/shell");
	return shell.setupStudioShell;
}

function surfaceDiagnosticsErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" && error.length > 0
		? error
		: "unknown error";
}
