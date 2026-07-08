import {
	formatSurfaceActionSelectionChoices,
	getStatusAvailableSurfaceActions,
	resolveSurfaceActionAffordanceSelection,
	type SurfaceActionAffordanceSelectionMetadata,
} from "@refarm.dev/cli/action-affordances";
import type {
	StatusJson,
	StatusSurfaceAction,
} from "@refarm.dev/cli/status";
import {
	createHomesteadSurfaceRenderActionRequest,
	homesteadSurfaceRenderContextMatches,
	invokeHomesteadSurfaceRenderAction,
	type HomesteadSurfaceRenderActionHandler,
	type HomesteadSurfaceRenderActionRequest,
	type HomesteadSurfaceRenderContextRequest,
} from "@refarm.dev/homestead/sdk/surface-renderer";
import {
	createStatusHostSurfaceState,
	STATUS_INSPECT_TRUST_ACTION_ID,
	STATUS_OPEN_REPORT_ACTION_ID,
} from "./status-surfaces.js";

export const STATUS_SURFACE_PLUGIN_ID = "apps/refarm";
export const STATUS_SURFACE_ID = "host-status-actions";
export const STATUS_SURFACE_SLOT_ID = "status";

export type StatusSurfaceActionObserver = (
	request: HomesteadSurfaceRenderActionRequest,
) => void | Promise<void>;

export interface StatusSurfaceActionResolution {
	request?: HomesteadSurfaceRenderActionRequest;
	reason: "available" | "missing-action";
}

export interface StatusSurfaceActionInvocationEnvelope {
	schemaVersion: 1;
	statusSchemaVersion: StatusJson["schemaVersion"];
	reason: "executed";
	renderer: "status";
	statusSource: "live";
	selection: SurfaceActionAffordanceSelectionMetadata;
	actionRequest: HomesteadSurfaceRenderActionRequest;
	handled: boolean;
	availableActions: readonly StatusSurfaceAction[];
}

export interface InvokeStatusSurfaceActionSelectionOptions {
	status: StatusJson;
	selection: string;
	onAction?: StatusSurfaceActionObserver;
}

export function createStatusSurfaceRenderRequest(
	locale = "en",
): HomesteadSurfaceRenderContextRequest {
	return {
		pluginId: STATUS_SURFACE_PLUGIN_ID,
		slotId: STATUS_SURFACE_SLOT_ID,
		mountSource: "legacy-ui-slot",
		surface: {
			layer: "homestead",
			kind: "panel",
			id: STATUS_SURFACE_ID,
			slot: STATUS_SURFACE_SLOT_ID,
		},
		locale,
	};
}

export function resolveStatusSurfaceActionRequest(
	actionId: string,
): StatusSurfaceActionResolution {
	const renderRequest = createStatusSurfaceRenderRequest();
	const host = createStatusHostSurfaceState().context;
	const request = createHomesteadSurfaceRenderActionRequest(
		renderRequest,
		host,
		actionId,
	);

	return request
		? { reason: "available", request }
		: { reason: "missing-action" };
}

export function createStatusSurfaceActionHandler(
	onAction: StatusSurfaceActionObserver = () => {},
): HomesteadSurfaceRenderActionHandler {
	return async (request) => {
		if (
			!homesteadSurfaceRenderContextMatches(request, {
				pluginId: STATUS_SURFACE_PLUGIN_ID,
				surfaceId: STATUS_SURFACE_ID,
			})
		) {
			return false;
		}
		if (!isStatusSurfaceActionId(request.action.id)) return false;

		await onAction(request);
		return true;
	};
}

export async function invokeStatusSurfaceAction(
	actionId: string,
	onAction: StatusSurfaceActionObserver = () => {},
): Promise<boolean> {
	const renderRequest = createStatusSurfaceRenderRequest();
	const host = createStatusHostSurfaceState().context;
	return invokeHomesteadSurfaceRenderAction(
		createStatusSurfaceActionHandler(onAction),
		renderRequest,
		host,
		actionId,
	);
}

export async function invokeStatusSurfaceActionSelection(
	options: InvokeStatusSurfaceActionSelectionOptions,
): Promise<StatusSurfaceActionInvocationEnvelope> {
	const selectedAction = resolveSurfaceActionAffordanceSelection(
		options.status,
		options.selection,
	);

	if (!selectedAction.selected) {
		throw new Error(
			`Status action "${options.selection}" is not available. Available selections: ${formatSurfaceActionSelectionChoices(selectedAction.rows)}.`,
		);
	}

	const resolution = resolveStatusSurfaceActionRequest(
		selectedAction.selected.id,
	);

	if (!resolution.request) {
		throw new Error(
			`Status action "${selectedAction.selected.id}" has no live handler. Available selections: ${formatSurfaceActionSelectionChoices(selectedAction.rows)}.`,
		);
	}

	const handled = await invokeStatusSurfaceAction(
		selectedAction.selected.id,
		options.onAction,
	);

	return createStatusSurfaceActionInvocationEnvelope(
		options.status,
		selectedAction.selection,
		resolution.request,
		handled,
		getStatusAvailableSurfaceActions(options.status),
	);
}

export function createStatusSurfaceActionInvocationEnvelope(
	status: StatusJson,
	selection: SurfaceActionAffordanceSelectionMetadata,
	actionRequest: HomesteadSurfaceRenderActionRequest,
	handled: boolean,
	availableActions: readonly StatusSurfaceAction[],
): StatusSurfaceActionInvocationEnvelope {
	return {
		schemaVersion: 1,
		statusSchemaVersion: status.schemaVersion,
		reason: "executed",
		renderer: "status",
		statusSource: "live",
		selection,
		actionRequest,
		handled,
		availableActions,
	};
}

function isStatusSurfaceActionId(actionId: string): boolean {
	return (
		actionId === STATUS_OPEN_REPORT_ACTION_ID ||
		actionId === STATUS_INSPECT_TRUST_ACTION_ID
	);
}
