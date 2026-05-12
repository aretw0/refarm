import type { PluginInstance } from "@refarm.dev/tractor";
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

export const REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID =
	"refarm-me-personal-surface";
export const REFARM_ME_PERSONAL_SURFACE_ID = "personal-vault-panel";
export const REFARM_ME_OPEN_VAULT_ACTION_ID = "open-personal-vault";

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

export function createRefarmMeSurfacePlugins(
	emitTelemetry: RefarmMeSurfaceTelemetry = () => {},
): PluginInstance[] {
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
			<p>It keeps Refarm.me product UX app-owned while exercising the same layout, surface, and action primitives used by the Studio app.</p>
			${actionButton ? `<div class="refarm-cluster">${actionButton}</div>` : ""}
		</section>`,
	};
}

export function createRefarmMeSurfaceContextProvider(): HomesteadSurfaceRenderContextProvider {
	return createScopedHomesteadSurfaceContextProvider(
		{
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			surfaceId: REFARM_ME_PERSONAL_SURFACE_ID,
		},
		() => ({
			hostId: "apps/me",
			data: {
				profileName: "My Sovereign Space",
				storageScope: "refarm-me-main",
				syncScope: "citizen",
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

function escapeRefarmMeSurfaceText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
