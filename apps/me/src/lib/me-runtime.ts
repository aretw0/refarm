import type { HomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";
import { bootStudioRuntime } from "@refarm.dev/homestead/sdk/runtime";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import type { RuntimePluginHandle } from "@refarm.dev/runtime";
import { REFARM_ME_WEB_RENDERER } from "./me-renderers";
import {
	createRefarmMeSurfaceActionHandler,
	createRefarmMeSurfaceContextProvider,
	createRefarmMeSurfacePlugins,
	REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
	type RefarmMeSurfaceTelemetry,
} from "./me-surfaces";

export const REFARM_ME_LOADING_ID = "loading-overlay";
export const REFARM_ME_RENDERER = REFARM_ME_WEB_RENDERER;

type RefarmMeRuntime = Awaited<ReturnType<typeof bootStudioRuntime>>;
type RefarmMeTractor = RefarmMeRuntime["tractor"];
type SetupStudioShell = typeof setupStudioShell;

interface RefarmMeHerald {
	announce(): void;
}

type RefarmMeFirefly = object;

export interface RefarmMePluginConstructors {
	HeraldPlugin: new (tractor: RefarmMeTractor) => RefarmMeHerald;
	FireflyPlugin: new (tractor: RefarmMeTractor) => RefarmMeFirefly;
}

export interface RefarmMeWorkbench {
	tractor: RefarmMeTractor;
	renderer: HomesteadHostRendererDescriptor;
	surfacePluginIds: string[];
}

export interface RefarmMeRuntimeOptions {
	document?: Document;
	bootRuntime?: typeof bootStudioRuntime;
	setupShell?: SetupStudioShell;
	pluginConstructors?: RefarmMePluginConstructors;
	createSurfacePlugins?: typeof createRefarmMeSurfacePlugins;
	log?: Pick<Console, "error">;
}

export async function bootRefarmMeWorkbench(
	options: RefarmMeRuntimeOptions = {},
): Promise<RefarmMeWorkbench> {
	const doc = options.document ?? document;
	const runtime = await (options.bootRuntime ?? bootStudioRuntime)({
		databaseName: "refarm-me-main",
		namespace: "citizen",
		identityId: "citizen",
		identityPublicKey: "me",
		envMetadata: { version: "0.1.0-solo-fertil", commit: "me" },
		connectBrowserSync: true,
		tractorSync: true,
	});
	const tractor = runtime.tractor;

	const constructors =
		options.pluginConstructors ?? (await loadRefarmMePluginConstructors());
	const herald = new constructors.HeraldPlugin(tractor);
	new constructors.FireflyPlugin(tractor);

	const surfacePluginIds = registerRefarmMeSurfacePlugins(
		tractor,
		options.createSurfacePlugins ?? createRefarmMeSurfacePlugins,
	);

	const setupShell = options.setupShell ?? (await loadSetupStudioShell());
	await setupShell(tractor, {
		surfaceContext: createRefarmMeSurfaceContextProvider(),
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

	herald.announce();
	doc.getElementById(REFARM_ME_LOADING_ID)?.remove();

	return {
		tractor,
		renderer: REFARM_ME_RENDERER,
		surfacePluginIds,
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

export { REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID };
