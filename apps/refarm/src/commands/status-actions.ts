import {
	createHomesteadSurfaceRenderActionRequest,
	homesteadSurfaceRenderContextMatches,
	invokeHomesteadSurfaceRenderAction,
	type HomesteadSurfaceRenderActionHandler,
	type HomesteadSurfaceRenderActionRequest,
	type HomesteadSurfaceRenderContextRequest,
} from "@refarm.dev/homestead/sdk/surface-renderer";
import type {
	RefarmStatusJson,
	RefarmStatusSurfaceAction,
} from "@refarm.dev/cli/status";
import type { RefarmActionAffordanceSelectionMetadata } from "./action-affordances.js";
import {
	createRefarmStatusHostSurfaceState,
	REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
	REFARM_STATUS_OPEN_REPORT_ACTION_ID,
} from "./status-surfaces.js";

export const REFARM_STATUS_SURFACE_PLUGIN_ID = "apps/refarm";
export const REFARM_STATUS_SURFACE_ID = "host-status-actions";
export const REFARM_STATUS_SURFACE_SLOT_ID = "status";

export type RefarmStatusSurfaceActionObserver = (
	request: HomesteadSurfaceRenderActionRequest,
) => void | Promise<void>;

export interface RefarmStatusSurfaceActionResolution {
	request?: HomesteadSurfaceRenderActionRequest;
	reason: "available" | "missing-action";
}

export interface RefarmStatusSurfaceActionInvocationEnvelope {
	schemaVersion: 1;
	statusSchemaVersion: RefarmStatusJson["schemaVersion"];
	reason: "executed";
	renderer: "status";
	selection: RefarmActionAffordanceSelectionMetadata;
	actionRequest: HomesteadSurfaceRenderActionRequest;
	handled: boolean;
	availableActions: readonly RefarmStatusSurfaceAction[];
}

export function createRefarmStatusSurfaceRenderRequest(
	locale = "en",
): HomesteadSurfaceRenderContextRequest {
	return {
		pluginId: REFARM_STATUS_SURFACE_PLUGIN_ID,
		slotId: REFARM_STATUS_SURFACE_SLOT_ID,
		mountSource: "legacy-ui-slot",
		surface: {
			layer: "homestead",
			kind: "panel",
			id: REFARM_STATUS_SURFACE_ID,
			slot: REFARM_STATUS_SURFACE_SLOT_ID,
		},
		locale,
	};
}

export function resolveRefarmStatusSurfaceActionRequest(
	actionId: string,
): RefarmStatusSurfaceActionResolution {
	const renderRequest = createRefarmStatusSurfaceRenderRequest();
	const host = createRefarmStatusHostSurfaceState().context;
	const request = createHomesteadSurfaceRenderActionRequest(
		renderRequest,
		host,
		actionId,
	);

	return request
		? { reason: "available", request }
		: { reason: "missing-action" };
}

export function createRefarmStatusSurfaceActionHandler(
	onAction: RefarmStatusSurfaceActionObserver = () => {},
): HomesteadSurfaceRenderActionHandler {
	return async (request) => {
		if (
			!homesteadSurfaceRenderContextMatches(request, {
				pluginId: REFARM_STATUS_SURFACE_PLUGIN_ID,
				surfaceId: REFARM_STATUS_SURFACE_ID,
			})
		) {
			return false;
		}
		if (!isRefarmStatusSurfaceActionId(request.action.id)) return false;

		await onAction(request);
		return true;
	};
}

export async function invokeRefarmStatusSurfaceAction(
	actionId: string,
	onAction: RefarmStatusSurfaceActionObserver = () => {},
): Promise<boolean> {
	const renderRequest = createRefarmStatusSurfaceRenderRequest();
	const host = createRefarmStatusHostSurfaceState().context;
	return invokeHomesteadSurfaceRenderAction(
		createRefarmStatusSurfaceActionHandler(onAction),
		renderRequest,
		host,
		actionId,
	);
}

export function createRefarmStatusSurfaceActionInvocationEnvelope(
	status: RefarmStatusJson,
	selection: RefarmActionAffordanceSelectionMetadata,
	actionRequest: HomesteadSurfaceRenderActionRequest,
	handled: boolean,
	availableActions: readonly RefarmStatusSurfaceAction[],
): RefarmStatusSurfaceActionInvocationEnvelope {
	return {
		schemaVersion: 1,
		statusSchemaVersion: status.schemaVersion,
		reason: "executed",
		renderer: "status",
		selection,
		actionRequest,
		handled,
		availableActions,
	};
}

function isRefarmStatusSurfaceActionId(actionId: string): boolean {
	return (
		actionId === REFARM_STATUS_OPEN_REPORT_ACTION_ID ||
		actionId === REFARM_STATUS_INSPECT_TRUST_ACTION_ID
	);
}
