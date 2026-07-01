import { createHomesteadSurfacePluginHandle } from "@refarm.dev/homestead/sdk/plugin-handle";
import {
	createHomesteadSurfaceRenderActionRequest,
	createScopedHomesteadSurfaceContextProvider,
	homesteadSurfaceRenderContextMatches,
	invokeHomesteadSurfaceRenderAction,
	type HomesteadSurfaceRenderActionHandler,
	type HomesteadSurfaceRenderActionRequest,
	type HomesteadSurfaceRenderContextProvider,
	type HomesteadSurfaceRenderContextRequest,
	type HomesteadSurfaceRenderRequest,
	type HomesteadSurfaceRenderResult,
} from "@refarm.dev/homestead/sdk/surface-renderer";
import type { RuntimePluginHandle } from "@refarm.dev/runtime";

export const REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID =
	"refarm-me-personal-surface";
export const REFARM_ME_PERSONAL_SURFACE_ID = "personal-vault-panel";
export const REFARM_ME_OPEN_VAULT_ACTION_ID = "open-personal-vault";
export const REFARM_ME_IDENTITY_STATUS = "unauthenticated";
export const REFARM_ME_SYNC_STATUS = "waiting-for-tractor";
export const REFARM_ME_GRAPH_MODE = "bootstrap";

export type RefarmMeSurfaceTelemetry = (
	pluginId: string,
	event: string,
	payload?: unknown,
) => void;

export type RefarmMeSurfaceActionObserver = (
	request: HomesteadSurfaceRenderActionRequest,
) => void | Promise<void>;

export interface RefarmMePersonalSurfaceActionResolution {
	request?: HomesteadSurfaceRenderActionRequest;
	reason: "available" | "missing-action";
}

export interface RefarmMeSurfaceContextOptions {
	identityStatus?: string;
	profileName?: string;
	storageScope?: string;
	syncScope?: string;
	syncStatus?: string;
	graphMode?: string;
	pluginRegistryCount?: number;
	discoveredContentPluginCount?: number;
	referenceDriverCapabilityIds?: readonly string[];
	scheduledWorkSummary?: {
		total: number;
		due: number;
		scheduled: number;
		unsupported: number;
	};
}

export function createRefarmMeSurfacePlugins(
	emitTelemetry: RefarmMeSurfaceTelemetry = () => {},
): RuntimePluginHandle[] {
	return [
		createHomesteadSurfacePluginHandle({
			id: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			name: "Refarm.me Personal Surface",
			surfaces: [
				{
					kind: "panel",
					id: REFARM_ME_PERSONAL_SURFACE_ID,
					slot: "main",
					capabilities: ["ui:panel:render"],
				},
			],
			call: async (fn, args) =>
				fn === "renderHomesteadSurface"
					? renderRefarmMePersonalSurface(args as HomesteadSurfaceRenderRequest)
					: null,
			emitTelemetry: (event, payload) =>
				emitTelemetry(REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID, event, payload),
		}),
	];
}

export function renderRefarmMePersonalSurface(
	request: HomesteadSurfaceRenderRequest,
): HomesteadSurfaceRenderResult {
	const hostId = escapeRefarmMeSurfaceText(request.host?.hostId ?? "apps/me");
	const profileName = escapeRefarmMeSurfaceText(
		String(request.host?.data?.profileName ?? "Sovereign citizen"),
	);
	const identityStatus = escapeRefarmMeSurfaceText(
		String(request.host?.data?.identityStatus ?? REFARM_ME_IDENTITY_STATUS),
	);
	const syncStatus = escapeRefarmMeSurfaceText(
		String(request.host?.data?.syncStatus ?? REFARM_ME_SYNC_STATUS),
	);
	const graphMode = escapeRefarmMeSurfaceText(
		String(request.host?.data?.graphMode ?? REFARM_ME_GRAPH_MODE),
	);
	const pluginRegistryCount = escapeRefarmMeSurfaceText(
		String(request.host?.data?.pluginRegistryCount ?? 0),
	);
	const discoveredContentPluginCount = escapeRefarmMeSurfaceText(
		String(request.host?.data?.discoveredContentPluginCount ?? 0),
	);
	const referenceDriverCapabilityIds = Array.isArray(
		request.host?.data?.referenceDriverCapabilityIds,
	)
		? request.host.data.referenceDriverCapabilityIds
				.map((value) => String(value))
				.filter((value) => value.length > 0)
		: [];
	const referenceDriverCapabilityCount = escapeRefarmMeSurfaceText(
		String(referenceDriverCapabilityIds.length),
	);
	const scheduledWorkSummary = readRefarmMeSurfaceScheduledWorkSummary(
		request.host?.data?.scheduledWorkSummary,
	);
	const scheduledWorkLabel = escapeRefarmMeSurfaceText(
		scheduledWorkSummary
			? `${scheduledWorkSummary.scheduled} scheduled / ${scheduledWorkSummary.due} due`
			: "not provided",
	);
	const action = request.host?.actions?.find(
		(candidate) => candidate.id === REFARM_ME_OPEN_VAULT_ACTION_ID,
	);
	const actionButton = action
		? `<button type="button" class="refarm-btn refarm-btn-pill" data-refarm-surface-action-id="${escapeRefarmMeSurfaceText(action.id)}">${escapeRefarmMeSurfaceText(action.label)}</button>`
		: "";

	return {
		html: `<section class="refarm-surface-card refarm-stack" data-refarm-me-surface="${REFARM_ME_PERSONAL_SURFACE_ID}">
			<p class="refarm-eyebrow">Personal sovereign surface</p>
			<h1>${profileName}</h1>
			<p>This panel is rendered through the shared Homestead surface contract with host context from <code class="refarm-code">${hostId}</code>.</p>
			<dl class="refarm-stack" data-refarm-me-identity>
				<div>
					<dt class="refarm-eyebrow">Identity</dt>
					<dd>${identityStatus}</dd>
				</div>
				<div>
					<dt class="refarm-eyebrow">Sync</dt>
					<dd data-refarm-me-sync-status>${syncStatus}</dd>
				</div>
				<div>
					<dt class="refarm-eyebrow">Graph</dt>
					<dd data-refarm-me-graph-mode>${graphMode}</dd>
				</div>
				<div>
					<dt class="refarm-eyebrow">Registries</dt>
					<dd data-refarm-me-plugin-registry-count>${pluginRegistryCount}</dd>
				</div>
				<div>
					<dt class="refarm-eyebrow">Plugins</dt>
					<dd data-refarm-me-discovered-content-plugin-count>${discoveredContentPluginCount}</dd>
				</div>
				<div>
					<dt class="refarm-eyebrow">Driver primitives</dt>
					<dd data-refarm-me-reference-driver-count>${referenceDriverCapabilityCount}</dd>
				</div>
				<div>
					<dt class="refarm-eyebrow">Scheduled work</dt>
					<dd data-refarm-me-scheduled-work>${scheduledWorkLabel}</dd>
				</div>
			</dl>
			<p>It keeps Refarm.me product UX app-owned while exercising the same layout, surface, and action primitives used by the Studio app.</p>
			${actionButton ? `<div class="refarm-cluster">${actionButton}</div>` : ""}
		</section>`,
	};
}

export function createRefarmMeSurfaceContextProvider(
	options: RefarmMeSurfaceContextOptions = {},
): HomesteadSurfaceRenderContextProvider {
	return createScopedHomesteadSurfaceContextProvider(
		{
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			surfaceId: REFARM_ME_PERSONAL_SURFACE_ID,
		},
		() => ({
			hostId: "apps/me",
			data: {
				profileName: options.profileName ?? "My Sovereign Space",
				identityStatus: options.identityStatus ?? REFARM_ME_IDENTITY_STATUS,
				storageScope: options.storageScope ?? "refarm-me-main",
				syncScope: options.syncScope ?? "citizen",
				syncStatus: options.syncStatus ?? REFARM_ME_SYNC_STATUS,
				graphMode: options.graphMode ?? REFARM_ME_GRAPH_MODE,
				pluginRegistryCount: options.pluginRegistryCount ?? 0,
				discoveredContentPluginCount:
					options.discoveredContentPluginCount ?? 0,
				referenceDriverCapabilityIds:
					options.referenceDriverCapabilityIds ?? [],
				scheduledWorkSummary: options.scheduledWorkSummary ?? null,
			},
			actions: [
				{
					id: REFARM_ME_OPEN_VAULT_ACTION_ID,
					label: "Open personal vault",
					intent: "me:vault-open",
					payload: { target: "personal-vault" },
				},
			],
		}),
	);
}

export function createRefarmMePersonalSurfaceRenderRequest(
	locale = "en",
): HomesteadSurfaceRenderContextRequest {
	return {
		pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
		slotId: "main",
		mountSource: "extension-surface",
		surface: {
			layer: "homestead",
			kind: "panel",
			id: REFARM_ME_PERSONAL_SURFACE_ID,
			slot: "main",
		},
		locale,
	};
}

export async function resolveRefarmMePersonalSurfaceActionRequest(
	actionId: string,
): Promise<RefarmMePersonalSurfaceActionResolution> {
	const renderRequest = createRefarmMePersonalSurfaceRenderRequest();
	const host = await createRefarmMeSurfaceContextProvider()(renderRequest);
	const request = createHomesteadSurfaceRenderActionRequest(
		renderRequest,
		host,
		actionId,
	);

	return request
		? { reason: "available", request }
		: { reason: "missing-action" };
}

export async function invokeRefarmMePersonalSurfaceAction(
	actionId: string,
	onAction: RefarmMeSurfaceActionObserver = () => {},
): Promise<boolean> {
	const renderRequest = createRefarmMePersonalSurfaceRenderRequest();
	const host = await createRefarmMeSurfaceContextProvider()(renderRequest);
	return invokeHomesteadSurfaceRenderAction(
		createRefarmMeSurfaceActionHandler(onAction),
		renderRequest,
		host,
		actionId,
	);
}

export function createRefarmMeSurfaceActionHandler(
	onAction: RefarmMeSurfaceActionObserver = () => {},
): HomesteadSurfaceRenderActionHandler {
	return async (request) => {
		if (
			!homesteadSurfaceRenderContextMatches(request, {
				pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
				surfaceId: REFARM_ME_PERSONAL_SURFACE_ID,
			})
		) {
			return false;
		}
		if (request.action.id !== REFARM_ME_OPEN_VAULT_ACTION_ID) return false;

		await onAction(request);
		return true;
	};
}

function readRefarmMeSurfaceScheduledWorkSummary(value: unknown):
	| {
			total: number;
			due: number;
			scheduled: number;
			unsupported: number;
	  }
	| undefined {
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

function escapeRefarmMeSurfaceText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
