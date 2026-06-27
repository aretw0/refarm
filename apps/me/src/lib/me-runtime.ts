import type { HomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";
import {
	bootStudioRuntime,
	type BootStudioRuntimeOptions,
} from "@refarm.dev/homestead/sdk/runtime";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import type { RuntimePluginHandle } from "@refarm.dev/runtime";
import {
	installRefarmMeContentPlugins,
	type RefarmMeContentPluginInstallInput,
} from "./me-content-plugins";
import { REFARM_ME_WEB_RENDERER } from "./me-renderers";
import {
	createRefarmMeSurfaceActionHandler,
	createRefarmMeSurfaceContextProvider,
	createRefarmMeSurfacePlugins,
	REFARM_ME_IDENTITY_STATUS,
	REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
	REFARM_ME_SYNC_STATUS,
	type RefarmMeSurfaceTelemetry,
} from "./me-surfaces";

export const REFARM_ME_LOADING_ID = "loading-overlay";
export const REFARM_ME_RENDERER = REFARM_ME_WEB_RENDERER;

type RefarmMeRuntime = Awaited<ReturnType<typeof bootStudioRuntime>>;
type RefarmMeTractor = RefarmMeRuntime["tractor"];
type SetupStudioShell = typeof setupStudioShell;
type RefarmMeBrowserSyncEvent = Parameters<
	NonNullable<NonNullable<BootStudioRuntimeOptions["browserSync"]>["onEvent"]>
>[0];

interface RefarmMeHerald {
	announce(): void;
}

interface RefarmMeHeraldOptions {
	identityStatus?: string;
}

type RefarmMeFirefly = object;

export interface RefarmMePluginConstructors {
	HeraldPlugin: new (
		tractor: RefarmMeTractor,
		options?: RefarmMeHeraldOptions,
	) => RefarmMeHerald;
	FireflyPlugin: new (tractor: RefarmMeTractor) => RefarmMeFirefly;
}

export interface RefarmMeWorkbench {
	tractor: RefarmMeTractor;
	renderer: HomesteadHostRendererDescriptor;
	surfacePluginIds: string[];
	contentPluginIds: string[];
}

export interface RefarmMeRuntimeOptions {
	document?: Document;
	bootRuntime?: typeof bootStudioRuntime;
	setupShell?: SetupStudioShell;
	pluginConstructors?: RefarmMePluginConstructors;
	createSurfacePlugins?: typeof createRefarmMeSurfacePlugins;
	contentPlugins?: readonly RefarmMeContentPluginInstallInput[];
	log?: Pick<Console, "error">;
}

export async function bootRefarmMeWorkbench(
	options: RefarmMeRuntimeOptions = {},
): Promise<RefarmMeWorkbench> {
	const doc = options.document ?? document;
	const browserSyncTelemetry = createRefarmMeBrowserSyncTelemetryBuffer(doc);
	const runtime = await (options.bootRuntime ?? bootStudioRuntime)({
		databaseName: "refarm-me-main",
		namespace: "citizen",
		identityId: "citizen",
		identityPublicKey: "me",
		envMetadata: { version: "0.1.0-solo-fertil", commit: "me" },
		connectBrowserSync: true,
		tractorSync: true,
		browserSync: { onEvent: browserSyncTelemetry.capture },
	});
	const tractor = runtime.tractor;
	browserSyncTelemetry.flushTo(tractor);

	const constructors =
		options.pluginConstructors ?? (await loadRefarmMePluginConstructors());
	const herald = new constructors.HeraldPlugin(tractor, {
		identityStatus: REFARM_ME_IDENTITY_STATUS,
	});
	new constructors.FireflyPlugin(tractor);

	const contentPluginIds = (
		await installRefarmMeContentPlugins(
			tractor,
			options.contentPlugins ?? readRefarmMeBootstrapContentPlugins(),
		)
	).map((plugin) => plugin.pluginId);

	const surfacePluginIds = registerRefarmMeSurfacePlugins(
		tractor,
		options.createSurfacePlugins ?? createRefarmMeSurfacePlugins,
	);

	const setupShell = options.setupShell ?? (await loadSetupStudioShell());
	await setupShell(tractor, {
		surfaceContext: createRefarmMeSurfaceContextProvider({
			identityStatus: REFARM_ME_IDENTITY_STATUS,
			syncStatus: browserSyncTelemetry.status(),
		}),
		surfaceAction: createRefarmMeSurfaceActionHandler((request) => {
			tractor.emitTelemetry({
				event: "me:surface_action",
				pluginId: request.pluginId,
				payload: {
					actionId: request.action.id,
					actionIntent: request.action.intent,
					surfaceId: request.surface?.id,
				},
			});
		}),
	});
	browserSyncTelemetry.renderStatus();

	herald.announce();
	doc.getElementById(REFARM_ME_LOADING_ID)?.remove();

	return {
		tractor,
		renderer: REFARM_ME_RENDERER,
		surfacePluginIds,
		contentPluginIds,
	};
}

export function renderRefarmMeBootFailure(
	error: unknown,
	options: Pick<RefarmMeRuntimeOptions, "document" | "log"> = {},
): void {
	const doc = options.document ?? document;
	const log = options.log ?? console;
	log.error("[me] Boot failed", error);
	const loading = doc.getElementById(REFARM_ME_LOADING_ID);
	if (!loading) return;

	const wrapper = doc.createElement("div");
	wrapper.className = "refarm-stack";
	wrapper.style.textAlign = "center";
	wrapper.style.color = "var(--refarm-accent-secondary)";

	const message = doc.createElement("p");
	message.textContent = `Personal space boot failed: ${refarmMeErrorMessage(error)}`;
	wrapper.appendChild(message);

	loading.replaceChildren(wrapper);
}

function registerRefarmMeSurfacePlugins(
	tractor: RefarmMeTractor,
	createSurfacePlugins: typeof createRefarmMeSurfacePlugins,
): string[] {
	const emitTelemetry: RefarmMeSurfaceTelemetry = (pluginId, event, payload) =>
		tractor.emitTelemetry({ event, payload, pluginId });
	const plugins = createSurfacePlugins(emitTelemetry);
	for (const plugin of plugins) {
		tractor.plugins.registerInternal(plugin as RuntimePluginHandle);
	}
	return plugins.map((plugin) => plugin.id);
}

function emitRefarmMeBrowserSyncTelemetry(
	tractor: RefarmMeTractor,
	event: RefarmMeBrowserSyncEvent,
): void {
	tractor.emitTelemetry({
		event: "me:browser_sync",
		payload: event,
	});
}

function createRefarmMeBrowserSyncTelemetryBuffer(doc: Document): {
	capture(event: RefarmMeBrowserSyncEvent): void;
	flushTo(tractor: RefarmMeTractor): void;
	renderStatus(): void;
	status(): string;
} {
	const pending: RefarmMeBrowserSyncEvent[] = [];
	const sink: { tractor?: RefarmMeTractor } = {};
	let status = REFARM_ME_SYNC_STATUS;
	return {
		capture: (event) => {
			status = refarmMeSyncStatusFromEvent(event);
			renderRefarmMeSyncStatus(doc, status);
			if (sink.tractor) {
				emitRefarmMeBrowserSyncTelemetry(sink.tractor, event);
				return;
			}
			pending.push(event);
		},
		flushTo: (tractor) => {
			sink.tractor = tractor;
			for (const event of pending.splice(0)) {
				emitRefarmMeBrowserSyncTelemetry(tractor, event);
			}
		},
		renderStatus: () => renderRefarmMeSyncStatus(doc, status),
		status: () => status,
	};
}

function renderRefarmMeSyncStatus(doc: Document, status: string): void {
	const element = doc.querySelector("[data-refarm-me-sync-status]");
	if (element) element.textContent = status;
}

function refarmMeSyncStatusFromEvent(event: RefarmMeBrowserSyncEvent): string {
	switch (event.type) {
		case "connecting":
			return "connecting";
		case "open":
		case "local-state-sent":
		case "local-update-sent":
			return "connected";
		case "remote-update-received":
			return "receiving-snapshot";
		case "remote-update-applied":
			return "snapshot-applied";
		case "closed":
			return "reconnecting";
		case "error":
		case "connect-failed":
		case "remote-update-failed":
			return "sync-error";
	}
}

async function loadRefarmMePluginConstructors(): Promise<RefarmMePluginConstructors> {
	const homestead = await import("@refarm.dev/homestead/sdk");
	return {
		HeraldPlugin: homestead.HeraldPlugin,
		FireflyPlugin: homestead.FireflyPlugin,
	};
}

async function loadSetupStudioShell(): Promise<SetupStudioShell> {
	const shell = await import("@refarm.dev/homestead/sdk/shell");
	return shell.setupStudioShell;
}

function refarmMeErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" && error.length > 0
		? error
		: "unknown error";
}

function readRefarmMeBootstrapContentPlugins():
	| readonly RefarmMeContentPluginInstallInput[]
	| undefined {
	const globalConfig = globalThis as typeof globalThis & {
		__REFARM_ME_BOOTSTRAP_CONTENT_PLUGINS__?: readonly RefarmMeContentPluginInstallInput[];
	};
	return globalConfig.__REFARM_ME_BOOTSTRAP_CONTENT_PLUGINS__;
}

export { REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID };
