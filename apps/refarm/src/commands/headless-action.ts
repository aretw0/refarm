import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createHomesteadSurfaceRenderActionRequest,
	invokeHomesteadSurfaceRenderAction,
	type HomesteadSurfaceRenderAction,
	type HomesteadSurfaceRenderActionHandler,
	type HomesteadSurfaceRenderActionRequest,
	type HomesteadSurfaceRenderContextRequest,
	type HomesteadSurfaceRenderHostContext,
} from "@refarm.dev/homestead/sdk/surface-renderer";
import type { ExtensionSurfaceDeclaration } from "@refarm.dev/plugin-manifest";
import { getRefarmStatusAvailableActions } from "./action-affordances.js";

export type HeadlessSurfaceActionMountSource =
	| "legacy-ui-slot"
	| "extension-surface";

export type HeadlessSurfaceActionRequestResolutionReason =
	| "available"
	| "missing-action";

export type HeadlessSurfaceActionInvocationReason =
	| "handled"
	| "unhandled"
	| "missing-action";

export interface HeadlessSurfaceActionInvocationOptions {
	status: RefarmStatusJson;
	actionId: string;
	handler: HomesteadSurfaceRenderActionHandler;
	pluginId?: string;
	slotId?: string;
	locale?: string;
	mountSource?: HeadlessSurfaceActionMountSource;
	surface?: ExtensionSurfaceDeclaration;
	hostData?: Record<string, unknown>;
}

export interface HeadlessSurfaceActionRequestResolution {
	available: boolean;
	reason: HeadlessSurfaceActionRequestResolutionReason;
	action?: HomesteadSurfaceRenderAction;
	request?: HomesteadSurfaceRenderActionRequest;
	availableActions: readonly HomesteadSurfaceRenderAction[];
}

export interface HeadlessSurfaceActionInvocationResult {
	handled: boolean;
	reason: HeadlessSurfaceActionInvocationReason;
	action?: HomesteadSurfaceRenderAction;
	request?: HomesteadSurfaceRenderActionRequest;
	availableActions: readonly HomesteadSurfaceRenderAction[];
}

export function createHeadlessStatusSurfaceRenderRequest(
	status: RefarmStatusJson,
	options: Pick<
		HeadlessSurfaceActionInvocationOptions,
		"pluginId" | "slotId" | "locale" | "mountSource" | "surface"
	> = {},
): HomesteadSurfaceRenderContextRequest {
	return {
		pluginId: options.pluginId ?? status.host.app,
		slotId: options.slotId ?? "headless",
		mountSource: options.mountSource ?? "legacy-ui-slot",
		surface: options.surface,
		locale: options.locale ?? "en",
	};
}

export function createHeadlessStatusSurfaceHostContext(
	status: RefarmStatusJson,
	options: Pick<HeadlessSurfaceActionInvocationOptions, "hostData"> = {},
): HomesteadSurfaceRenderHostContext {
	return {
		hostId: status.host.app,
		data: {
			command: status.host.command,
			profile: status.host.profile,
			mode: status.host.mode,
			rendererId: status.renderer.id,
			rendererKind: status.renderer.kind,
			...options.hostData,
		},
		actions: [...getRefarmStatusAvailableActions(status)],
	};
}

export function resolveHeadlessStatusSurfaceActionRequest(
	options: Omit<HeadlessSurfaceActionInvocationOptions, "handler">,
): HeadlessSurfaceActionRequestResolution {
	const renderRequest = createHeadlessStatusSurfaceRenderRequest(
		options.status,
		options,
	);
	const host = createHeadlessStatusSurfaceHostContext(options.status, options);
	const request = createHomesteadSurfaceRenderActionRequest(
		renderRequest,
		host,
		options.actionId,
	);

	if (!request) {
		return {
			available: false,
			reason: "missing-action",
			availableActions: host.actions ?? [],
		};
	}

	return {
		available: true,
		reason: "available",
		action: request.action,
		request,
		availableActions: host.actions ?? [],
	};
}

export async function invokeHeadlessStatusSurfaceAction(
	options: HeadlessSurfaceActionInvocationOptions,
): Promise<HeadlessSurfaceActionInvocationResult> {
	const resolution = resolveHeadlessStatusSurfaceActionRequest(options);

	if (!resolution.request) {
		return {
			handled: false,
			reason: "missing-action",
			availableActions: resolution.availableActions,
		};
	}

	const handled = await invokeHomesteadSurfaceRenderAction(
		options.handler,
		resolution.request,
		resolution.request.host,
		options.actionId,
	);

	return {
		handled,
		reason: handled ? "handled" : "unhandled",
		action: resolution.request.action,
		request: resolution.request,
		availableActions: resolution.availableActions,
	};
}
