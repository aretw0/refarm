import type { HomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";
import { createStudioPluginHandle } from "@refarm.dev/homestead/sdk/plugin-handle";
import {
	bootStudioRuntime,
	resolveStudioRuntimeDatabaseName,
} from "@refarm.dev/homestead/sdk/runtime";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import {
	createStudioStreamSurfaceActionHandler,
	createStudioStreamSurfaceContextProvider,
	createStudioStreamSurfaceDemoPlugin,
	mountStudioStreamDemoControl,
	seedStudioStreamDemo,
	shouldSeedStudioStreamDemo,
	STUDIO_STREAM_DEMO_STORAGE_KEY,
	STUDIO_STREAM_SURFACE_PLUGIN_ID,
} from "./stream-demo";
import {
	mountReactiveStudioSurfaceInspectorElement,
	STUDIO_SURFACE_INSPECTOR_ELEMENT_NAME,
	type StudioSurfaceInspectorController,
	type StudioSurfaceInspectorElement,
} from "./surface-inspector";
import { STUDIO_WEB_RENDERER } from "./studio-renderers";

export const STUDIO_DASHBOARD_LOADING_ID = "loading-overlay";
export const STUDIO_DASHBOARD_STATUSBAR_ID = "refarm-slot-statusbar";
export const STUDIO_DASHBOARD_MODE_STORAGE_KEY = "refarm:mode";
export const STUDIO_DASHBOARD_RENDERER = STUDIO_WEB_RENDERER;

type StudioDashboardRuntime = Awaited<ReturnType<typeof bootStudioRuntime>>;
type StudioDashboardTractor = StudioDashboardRuntime["tractor"];
type SetupStudioShell = typeof setupStudioShell;
type CreateStudioPluginHandle = typeof createStudioPluginHandle;

interface StudioDashboardHerald {
	announce(): void;
	monitorLifecycle(): void;
}

interface StudioDashboardSower {
	getOnboardingNode(): Promise<unknown>;
	onEvent(event: string, payload: string): void;
}

interface StudioDashboardFirefly {
	showToast(message: string, actionable?: unknown): void;
	spotlight(targetId: string, message: string): void;
}

export interface StudioDashboardPluginConstructors {
	HeraldPlugin: new (tractor: StudioDashboardTractor) => StudioDashboardHerald;
	SowerPlugin: new (tractor: StudioDashboardTractor) => StudioDashboardSower;
	FireflyPlugin: new (
		tractor: StudioDashboardTractor,
	) => StudioDashboardFirefly;
}

export interface StudioDashboardWorkbench {
	tractor: StudioDashboardTractor;
	renderer: HomesteadHostRendererDescriptor;
	streamDemoEnabled: boolean;
	inspector?: StudioSurfaceInspectorController;
}

export interface StudioDashboardLocalStorage
	extends Pick<Storage, "getItem" | "setItem" | "removeItem"> {}

export interface StudioDashboardSessionStorage
	extends Pick<Storage, "getItem"> {}

export interface StudioDashboardRuntimeOptions {
	document?: Document;
	localStorage?: StudioDashboardLocalStorage;
	sessionStorage?: StudioDashboardSessionStorage;
	locationHref?: string;
	baseUrl?: string;
	reload?: () => void;
	bootRuntime?: typeof bootStudioRuntime;
	setupShell?: SetupStudioShell;
	createPluginHandle?: CreateStudioPluginHandle;
	pluginConstructors?: StudioDashboardPluginConstructors;
	mountStreamDemoControl?: typeof mountStudioStreamDemoControl;
	mountInspector?: typeof mountReactiveStudioSurfaceInspectorElement;
	seedStreamDemo?: typeof seedStudioStreamDemo;
	log?: Pick<Console, "info" | "error">;
}

export async function bootStudioDashboardWorkbench(
	options: StudioDashboardRuntimeOptions = {},
): Promise<StudioDashboardWorkbench> {
	const doc = options.document ?? document;
	const localStore = options.localStorage ?? localStorage;
	const sessionStore = options.sessionStorage ?? sessionStorage;
	const log = options.log ?? console;
	const mode = resolveStudioDashboardMode(localStore, sessionStore);
	log.info(`[homestead] Booting in ${mode} mode`);

	const runtime = await (options.bootRuntime ?? bootStudioRuntime)({
		databaseName: resolveStudioRuntimeDatabaseName({
			mode,
			persistentName: "refarm-main",
			temporaryPrefix: "refarm-temp",
		}),
		namespace: "studio-main",
		identityId: "core",
		identityPublicKey: "root",
		connectBrowserSync: true,
		tractorSync: true,
	});
	const tractor = runtime.tractor;
	const streamDemoEnabled = shouldSeedStudioStreamDemo(
		options.locationHref ?? window.location.href,
		localStore.getItem(STUDIO_STREAM_DEMO_STORAGE_KEY),
	);
	const constructors =
		options.pluginConstructors ??
		(await loadStudioDashboardPluginConstructors());
	const herald = registerStudioDashboardPlugins(
		tractor,
		constructors,
		options.createPluginHandle ?? createStudioPluginHandle,
		streamDemoEnabled,
	);

	const setupShell = options.setupShell ?? (await loadSetupStudioShell());
	await setupShell(tractor, {
		surfaceContext: createStudioStreamSurfaceContextProvider({
			baseUrl: options.baseUrl ?? "/",
		}),
		surfaceAction: createStudioStreamSurfaceActionHandler(),
	});

	const inspector = mountStudioDashboardStatusbar(doc, tractor, {
		...options,
		localStorage: localStore,
		streamDemoEnabled,
	});

	if (streamDemoEnabled) {
		await (options.seedStreamDemo ?? seedStudioStreamDemo)(tractor);
	}

	herald.announce();
	herald.monitorLifecycle();
	doc.getElementById(STUDIO_DASHBOARD_LOADING_ID)?.remove();

	return {
		tractor,
		renderer: STUDIO_DASHBOARD_RENDERER,
		streamDemoEnabled,
		inspector,
	};
}

export function renderStudioDashboardBootFailure(
	error: unknown,
	options: Pick<StudioDashboardRuntimeOptions, "document" | "reload"> = {},
): void {
	const doc = options.document ?? document;
	const loading = doc.getElementById(STUDIO_DASHBOARD_LOADING_ID);
	if (!loading) return;

	const wrapper = doc.createElement("div");
	wrapper.className = "refarm-stack";
	wrapper.style.textAlign = "center";
	wrapper.style.color = "var(--refarm-accent-secondary)";

	const message = doc.createElement("p");
	message.textContent = `Boot Failed: ${studioDashboardErrorMessage(error)}`;
	wrapper.appendChild(message);

	const retry = doc.createElement("button");
	retry.type = "button";
	retry.className = "refarm-btn refarm-btn-pill";
	retry.textContent = "Retry";
	retry.addEventListener("click", options.reload ?? (() => location.reload()));
	wrapper.appendChild(retry);

	loading.replaceChildren(wrapper);
}

export function resolveStudioDashboardMode(
	localStore: Pick<Storage, "getItem">,
	sessionStore: Pick<Storage, "getItem">,
): string {
	return (
		localStore.getItem(STUDIO_DASHBOARD_MODE_STORAGE_KEY) ||
		sessionStore.getItem(STUDIO_DASHBOARD_MODE_STORAGE_KEY) ||
		"visitor"
	);
}

function registerStudioDashboardPlugins(
	tractor: StudioDashboardTractor,
	constructors: StudioDashboardPluginConstructors,
	createPluginHandle: CreateStudioPluginHandle,
	streamDemoEnabled: boolean,
): StudioDashboardHerald {
	const herald = new constructors.HeraldPlugin(tractor);
	const sower = new constructors.SowerPlugin(tractor);
	const firefly = new constructors.FireflyPlugin(tractor);

	tractor.plugins.registerInternal(
		createPluginHandle({
			id: "sower",
			name: "O Semeador",
			manifest: { capabilities: { providersApi: ["onboarding"] } } as any,
			call: async (fn, args: unknown) => {
				if (fn === "get-help-nodes") {
					return [JSON.stringify(await sower.getOnboardingNode())];
				}
				if (fn === "on-event") {
					const [event, payload] = args as [string, string];
					sower.onEvent(event, payload);
				}
				return null;
			},
			emitTelemetry: (event, payload) =>
				tractor.emitTelemetry({ event, payload, pluginId: "sower" }),
			state: "idle",
		}),
	);

	tractor.plugins.registerInternal(
		createPluginHandle({
			id: "scarecrow",
			name: "O Espantalho",
			emitTelemetry: (event, payload) =>
				tractor.emitTelemetry({ event, payload, pluginId: "scarecrow" }),
			state: "idle",
		}),
	);

	tractor.plugins.registerInternal(
		createPluginHandle({
			id: "firefly",
			name: "O Vagalume",
			call: async (fn, args: any) => {
				if (fn === "show-toast")
					firefly.showToast(args.message, args.actionable);
				if (fn === "spotlight") firefly.spotlight(args.targetId, args.message);
				return null;
			},
			emitTelemetry: (event, payload) =>
				tractor.emitTelemetry({ event, payload, pluginId: "firefly" }),
			state: "idle",
		}),
	);

	if (streamDemoEnabled) {
		tractor.plugins.registerInternal(
			createStudioStreamSurfaceDemoPlugin((event, payload) =>
				tractor.emitTelemetry({
					event,
					payload,
					pluginId: STUDIO_STREAM_SURFACE_PLUGIN_ID,
				}),
			),
		);
	}

	return herald;
}

function mountStudioDashboardStatusbar(
	doc: Document,
	tractor: StudioDashboardTractor,
	options: StudioDashboardRuntimeOptions & { streamDemoEnabled: boolean },
): StudioSurfaceInspectorController | undefined {
	const statusbar = doc.getElementById(STUDIO_DASHBOARD_STATUSBAR_ID);
	if (!statusbar) return undefined;

	(options.mountStreamDemoControl ?? mountStudioStreamDemoControl)(statusbar, {
		enabled: options.streamDemoEnabled,
		onToggle: () => {
			const localStore = options.localStorage ?? localStorage;
			if (options.streamDemoEnabled) {
				localStore.removeItem(STUDIO_STREAM_DEMO_STORAGE_KEY);
			} else {
				localStore.setItem(STUDIO_STREAM_DEMO_STORAGE_KEY, "1");
			}
			(options.reload ?? (() => location.reload()))();
		},
	});

	const inspector = doc.createElement(
		STUDIO_SURFACE_INSPECTOR_ELEMENT_NAME,
	) as StudioSurfaceInspectorElement;
	statusbar.appendChild(inspector);
	return (options.mountInspector ?? mountReactiveStudioSurfaceInspectorElement)(
		inspector,
		{
			telemetry: tractor,
			telemetryEvents: tractor.telemetry.dump(),
		},
	);
}

async function loadStudioDashboardPluginConstructors(): Promise<StudioDashboardPluginConstructors> {
	const [homestead, sower] = await Promise.all([
		import("@refarm.dev/homestead/sdk"),
		import("@refarm.dev/sower"),
	]);
	return {
		HeraldPlugin: homestead.HeraldPlugin,
		FireflyPlugin: homestead.FireflyPlugin,
		SowerPlugin: sower.SowerPlugin,
	};
}

async function loadSetupStudioShell(): Promise<SetupStudioShell> {
	const shell = await import("@refarm.dev/homestead/sdk/shell");
	return shell.setupStudioShell;
}

function studioDashboardErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" && error.length > 0
		? error
		: "unknown error";
}
