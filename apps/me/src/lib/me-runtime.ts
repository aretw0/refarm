import { buildCapabilityIndex } from "@refarm.dev/cli/capability-index";
import type { HomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";
import { registerSurfacePlugins } from "@refarm.dev/homestead/sdk/register-surfaces";
import {
	bootStudioRuntime,
	type BootStudioRuntimeOptions,
} from "@refarm.dev/homestead/sdk/runtime";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import { mountRefarmMeChat } from "./me-chat";
import {
	installRefarmMeContentPlugins,
	type RefarmMeContentPluginInstallInput,
	type RefarmMeContentPluginManifest,
} from "./me-content-plugins";
import type { RefarmMePersonalStatus } from "./me-personal-capabilities";
import { REFARM_ME_WEB_RENDERER } from "./me-renderers";
import {
	createRefarmMeSurfaceActionHandler,
	createRefarmMeSurfaceContextProvider,
	createRefarmMeSurfacePlugins,
	defaultRefarmMePersonalStatus,
	REFARM_ME_IDENTITY_STATUS,
	REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
	REFARM_ME_SYNC_STATUS,
} from "./me-surfaces";
import { deriveRefarmMeSyncWsUrl } from "./me-sync-url";

export const REFARM_ME_LOADING_ID = "loading-overlay";
export const REFARM_ME_RENDERER = REFARM_ME_WEB_RENDERER;
export const REFARM_ME_PLUGIN_REGISTRY_TYPE = "refarm:PluginRegistry";

/** The registry twin's LIVE status thunk (convergence Slice 2 follow-on): sync is
 *  sampled at dispatch time — the telemetry source is push-updated — while the
 *  graph/driver numbers are the same boot snapshot the hero panel narrates. */
export function buildRefarmMePersonalStatus(sources: {
	syncStatus: () => string;
	graphMode: string;
	pluginRegistryCount: number;
	discoveredContentPluginCount: number;
	referenceDriverCapabilityIds: readonly string[];
	scheduledWorkSummary: RefarmMeScheduledWorkSummary | null;
}): () => RefarmMePersonalStatus {
	return () => ({
		...defaultRefarmMePersonalStatus(),
		syncStatus: sources.syncStatus(),
		graphMode: sources.graphMode,
		pluginRegistryCount: sources.pluginRegistryCount,
		discoveredContentPluginCount: sources.discoveredContentPluginCount,
		referenceDriverCapabilityIds: sources.referenceDriverCapabilityIds,
		scheduledWorkSummary: sources.scheduledWorkSummary,
	});
}

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

export type RefarmMeGraphMode = "bootstrap" | "sovereign";

export interface RefarmMeGraphStatus {
	mode: RefarmMeGraphMode;
	pluginRegistryIds: string[];
	discoveredContentPlugins: RefarmMeDiscoveredContentPlugin[];
}

export interface RefarmMeDiscoveredContentPlugin {
	registryId: string;
	input: RefarmMeContentPluginInstallInput;
}

export interface RefarmMePluginConstructors {
	HeraldPlugin: new (tractor: RefarmMeTractor, options?: RefarmMeHeraldOptions) => RefarmMeHerald;
	FireflyPlugin: new (tractor: RefarmMeTractor) => RefarmMeFirefly;
}

export interface RefarmMeWorkbench {
	tractor: RefarmMeTractor;
	renderer: HomesteadHostRendererDescriptor;
	surfacePluginIds: string[];
	contentPluginIds: string[];
	graphMode: RefarmMeGraphMode;
	pluginRegistryIds: string[];
	discoveredContentPluginIds: string[];
	driverStatus: RefarmMeDriverStatus;
	storeLocalNode(input: RefarmMeLocalNodeInput): Promise<void>;
}

export interface RefarmMeLocalNodeInput {
	id: string;
	type: string;
	context: string;
	payload: string;
	sourcePlugin?: string | null;
}

export interface RefarmMeRuntimeOptions {
	document?: Document;
	bootRuntime?: typeof bootStudioRuntime;
	setupShell?: SetupStudioShell;
	pluginConstructors?: RefarmMePluginConstructors;
	createSurfacePlugins?: typeof createRefarmMeSurfacePlugins;
	contentPlugins?: readonly RefarmMeContentPluginInstallInput[];
	installContentPlugins?: typeof installRefarmMeContentPlugins;
	browserSyncWsUrl?: string;
	driverStatus?: RefarmMeDriverStatus;
	log?: Pick<Console, "error">;
}

export interface RefarmMeScheduledWorkSummary {
	total: number;
	due: number;
	scheduled: number;
	unsupported: number;
}

export interface RefarmMeDriverStatus {
	referenceDriverCapabilityIds: string[];
	scheduledWorkSummary?: RefarmMeScheduledWorkSummary;
}

export async function bootRefarmMeWorkbench(
	options: RefarmMeRuntimeOptions = {},
): Promise<RefarmMeWorkbench> {
	const doc = options.document ?? document;
	const browserSyncTelemetry = createRefarmMeBrowserSyncTelemetryBuffer(doc);
	const browserSyncWsUrl =
		options.browserSyncWsUrl ??
		readRefarmMeBootstrapSyncUrl() ??
		deriveRefarmMeSyncWsUrl(globalThis.location);
	const browserSyncOptions: NonNullable<BootStudioRuntimeOptions["browserSync"]> = {
		onEvent: browserSyncTelemetry.capture,
	};
	if (browserSyncWsUrl) browserSyncOptions.wsUrl = browserSyncWsUrl;
	const runtime = await (options.bootRuntime ?? bootStudioRuntime)({
		databaseName: "refarm-me-main",
		namespace: "citizen",
		identityId: "citizen",
		identityPublicKey: "me",
		envMetadata: { version: "0.1.0-solo-fertil", commit: "me" },
		connectBrowserSync: true,
		tractorSync: true,
		browserSync: browserSyncOptions,
	});
	const tractor = runtime.tractor;
	browserSyncTelemetry.flushTo(tractor);
	const graphStatus = await readRefarmMeGraphStatus(runtime);
	const driverStatus = options.driverStatus ?? readRefarmMeBootstrapDriverStatus();

	const constructors = options.pluginConstructors ?? (await loadRefarmMePluginConstructors());
	const herald = new constructors.HeraldPlugin(tractor, {
		identityStatus: REFARM_ME_IDENTITY_STATUS,
	});
	new constructors.FireflyPlugin(tractor);

	const discoveredContentPlugins = graphStatus.discoveredContentPlugins.map(
		(plugin) => plugin.input,
	);
	const contentPluginIds = (
		await (options.installContentPlugins ?? installRefarmMeContentPlugins)(
			tractor,
			mergeRefarmMeContentPlugins(
				options.contentPlugins ?? readRefarmMeBootstrapContentPlugins() ?? [],
				discoveredContentPlugins,
			),
		)
	).map((plugin) => plugin.pluginId);

	// The surface-registration phase is the framework's (registerSurfacePlugins) — apps/me can't use
	// the atomic bootCapabilityWebShell because it installs content plugins (above) BETWEEN the runtime
	// boot and this registration, but it shares the register phase so the loop isn't copied here.
	const personalStatus = buildRefarmMePersonalStatus({
		syncStatus: () => browserSyncTelemetry.status(),
		graphMode: graphStatus.mode,
		pluginRegistryCount: graphStatus.pluginRegistryIds.length,
		discoveredContentPluginCount: graphStatus.discoveredContentPlugins.length,
		referenceDriverCapabilityIds: driverStatus.referenceDriverCapabilityIds,
		scheduledWorkSummary: driverStatus.scheduledWorkSummary ?? null,
	});
	const surfacePluginIds = registerSurfacePlugins(
		tractor,
		options.createSurfacePlugins ??
			((emitTelemetry) => createRefarmMeSurfacePlugins(emitTelemetry, personalStatus)),
	);

	const setupShell = options.setupShell ?? (await loadSetupStudioShell());
	await setupShell(tractor, {
		surfaceContext: createRefarmMeSurfaceContextProvider({
			identityStatus: REFARM_ME_IDENTITY_STATUS,
			syncStatus: browserSyncTelemetry.status(),
			graphMode: graphStatus.mode,
			pluginRegistryCount: graphStatus.pluginRegistryIds.length,
			discoveredContentPluginCount: graphStatus.discoveredContentPlugins.length,
			referenceDriverCapabilityIds: driverStatus.referenceDriverCapabilityIds,
			scheduledWorkSummary: driverStatus.scheduledWorkSummary,
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

	// ADR-088: mount the web chat panel — the composer submits/cancels over the
	// same-origin effort proxy and streams live activity from /stream/activity. Best-
	// effort: a chat mount failure must not block the workbench boot.
	try {
		mountRefarmMeChat({ document: doc });
	} catch (error) {
		options.log?.error(`[me] chat mount failed: ${String(error)}`);
	}

	herald.announce();
	doc.getElementById(REFARM_ME_LOADING_ID)?.remove();

	return {
		tractor,
		renderer: REFARM_ME_RENDERER,
		surfacePluginIds,
		contentPluginIds,
		graphMode: graphStatus.mode,
		pluginRegistryIds: graphStatus.pluginRegistryIds,
		discoveredContentPluginIds: graphStatus.discoveredContentPlugins.map(
			(plugin) => plugin.input.manifest.id,
		),
		driverStatus,
		storeLocalNode: (input) => storeRefarmMeLocalNode(runtime, input),
	};
}

function readRefarmMeBootstrapDriverStatus(): RefarmMeDriverStatus {
	const globalConfig = globalThis as typeof globalThis & {
		__REFARM_ME_BOOTSTRAP_OPERATOR_STATUS__?: {
			scheduledWork?: { summary?: unknown };
		};
	};
	return {
		// Only the capability IDs/tags are read here — the example activation commands
		// (which the binary would name, ADR-087) are irrelevant to me's browser
		// runtime, so the canonical binary is passed as a harmless label.
		referenceDriverCapabilityIds: buildCapabilityIndex("refarm")
			.capabilities.filter((capability) => capability.tags.includes("reference-driver"))
			.map((capability) => capability.id),
		scheduledWorkSummary: readRefarmMeScheduledWorkSummary(
			globalConfig.__REFARM_ME_BOOTSTRAP_OPERATOR_STATUS__?.scheduledWork?.summary,
		),
	};
}

function readRefarmMeScheduledWorkSummary(
	value: unknown,
): RefarmMeScheduledWorkSummary | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as {
		total?: unknown;
		due?: unknown;
		scheduled?: unknown;
		unsupported?: unknown;
	};
	if (
		typeof candidate.total !== "number" ||
		typeof candidate.due !== "number" ||
		typeof candidate.scheduled !== "number" ||
		typeof candidate.unsupported !== "number"
	) {
		return undefined;
	}
	return {
		total: candidate.total,
		due: candidate.due,
		scheduled: candidate.scheduled,
		unsupported: candidate.unsupported,
	};
}

async function readRefarmMeGraphStatus(runtime: RefarmMeRuntime): Promise<RefarmMeGraphStatus> {
	const registries = await runtime.storage.queryNodes(REFARM_ME_PLUGIN_REGISTRY_TYPE);
	const pluginRegistryIds = registries
		.map(readRefarmMeStorageNodeId)
		.filter((id): id is string => typeof id === "string" && id.length > 0);
	return {
		mode: pluginRegistryIds.length > 0 ? "sovereign" : "bootstrap",
		pluginRegistryIds,
		discoveredContentPlugins: registries.flatMap(readRefarmMeDiscoveredContentPlugins),
	};
}

function readRefarmMeDiscoveredContentPlugins(node: unknown): RefarmMeDiscoveredContentPlugin[] {
	const registryId = readRefarmMeStorageNodeId(node);
	if (!registryId) return [];
	const payload = readRefarmMeStorageNodePayload(node);
	const entries = readRefarmMeRegistryPluginEntries(payload);
	return entries
		.map((entry) => readRefarmMeRegistryContentPluginInput(entry))
		.filter((input): input is RefarmMeContentPluginInstallInput => input !== undefined)
		.map((input) => ({ registryId, input }));
}

function readRefarmMeStorageNodePayload(node: unknown): unknown {
	if (!node || typeof node !== "object") return undefined;
	const payload = (node as { payload?: unknown }).payload;
	if (typeof payload !== "string") return payload;
	try {
		return JSON.parse(payload);
	} catch {
		return undefined;
	}
}

function readRefarmMeStorageNodeId(node: unknown): string | undefined {
	if (!node || typeof node !== "object") return undefined;
	const directId = (node as { id?: unknown }).id;
	if (typeof directId === "string") return directId;

	const payload = (node as { payload?: unknown }).payload;
	if (typeof payload !== "string") return undefined;
	try {
		const parsed = JSON.parse(payload) as { id?: unknown; "@id"?: unknown };
		if (typeof parsed.id === "string") return parsed.id;
		if (typeof parsed["@id"] === "string") return parsed["@id"];
	} catch {
		return undefined;
	}
	return undefined;
}

function readRefarmMeRegistryPluginEntries(payload: unknown): unknown[] {
	if (!payload || typeof payload !== "object") return [];
	const registry = payload as {
		contentPlugins?: unknown;
		plugins?: unknown;
		entries?: unknown;
		"refarm:plugins"?: unknown;
	};
	for (const candidate of [
		registry.contentPlugins,
		registry.plugins,
		registry.entries,
		registry["refarm:plugins"],
	]) {
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}

function readRefarmMeRegistryContentPluginInput(
	entry: unknown,
): RefarmMeContentPluginInstallInput | undefined {
	if (!entry || typeof entry !== "object") return undefined;
	const candidate = entry as {
		manifest?: unknown;
		wasmUrl?: unknown;
		sourceUrl?: unknown;
		force?: unknown;
		browserRuntimeModule?: unknown;
	};
	if (!isRefarmMeContentPluginManifest(candidate.manifest)) return undefined;

	const input: RefarmMeContentPluginInstallInput = {
		manifest: candidate.manifest,
	};
	if (typeof candidate.wasmUrl === "string") input.wasmUrl = candidate.wasmUrl;
	if (typeof candidate.sourceUrl === "string") {
		input.sourceUrl = candidate.sourceUrl;
	}
	if (typeof candidate.force === "boolean") input.force = candidate.force;
	const browserRuntimeModule = readRefarmMeBrowserRuntimeModule(candidate.browserRuntimeModule);
	if (browserRuntimeModule) input.browserRuntimeModule = browserRuntimeModule;
	return input;
}

function isRefarmMeContentPluginManifest(
	manifest: unknown,
): manifest is RefarmMeContentPluginManifest {
	if (!manifest || typeof manifest !== "object") return false;
	const candidate = manifest as { id?: unknown; entry?: unknown };
	return (
		typeof candidate.id === "string" &&
		candidate.id.length > 0 &&
		typeof candidate.entry === "string" &&
		candidate.entry.length > 0
	);
}

function readRefarmMeBrowserRuntimeModule(
	value: unknown,
): RefarmMeContentPluginInstallInput["browserRuntimeModule"] | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as {
		url?: unknown;
		integrity?: unknown;
		format?: unknown;
	};
	if (typeof candidate.url !== "string" || typeof candidate.integrity !== "string") {
		return undefined;
	}
	return {
		url: candidate.url,
		integrity: candidate.integrity,
	};
}

function mergeRefarmMeContentPlugins(
	bootstrap: readonly RefarmMeContentPluginInstallInput[],
	discovered: readonly RefarmMeContentPluginInstallInput[],
): RefarmMeContentPluginInstallInput[] {
	const byId = new Map<string, RefarmMeContentPluginInstallInput>();
	for (const plugin of bootstrap) byId.set(plugin.manifest.id, plugin);
	for (const plugin of discovered) byId.set(plugin.manifest.id, plugin);
	return Array.from(byId.values());
}

async function storeRefarmMeLocalNode(
	runtime: RefarmMeRuntime,
	input: RefarmMeLocalNodeInput,
): Promise<void> {
	await runtime.storage.storeNode(
		input.id,
		input.type,
		input.context,
		input.payload,
		input.sourcePlugin ?? null,
	);
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
	return typeof error === "string" && error.length > 0 ? error : "unknown error";
}

function readRefarmMeBootstrapContentPlugins():
	| readonly RefarmMeContentPluginInstallInput[]
	| undefined {
	const globalConfig = globalThis as typeof globalThis & {
		__REFARM_ME_BOOTSTRAP_CONTENT_PLUGINS__?: readonly RefarmMeContentPluginInstallInput[];
	};
	return globalConfig.__REFARM_ME_BOOTSTRAP_CONTENT_PLUGINS__;
}

function readRefarmMeBootstrapSyncUrl(): string | undefined {
	const globalConfig = globalThis as typeof globalThis & {
		__REFARM_ME_BOOTSTRAP_SYNC_URL__?: string;
	};
	const syncUrl = globalConfig.__REFARM_ME_BOOTSTRAP_SYNC_URL__?.trim();
	return syncUrl && syncUrl.length > 0 ? syncUrl : undefined;
}

export { REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID };
