import type { HomesteadHostSurfaceState } from "@refarm.dev/homestead/sdk/host-renderer";
import type { HomesteadSurfaceRenderAction } from "@refarm.dev/homestead/sdk/surface-renderer";

export const STATUS_OPEN_REPORT_ACTION_ID = "open-status-report";
export const STATUS_INSPECT_TRUST_ACTION_ID = "inspect-trust";

const DEFAULT_STATUS_HOST_ID = "apps/refarm";
const DEFAULT_STATUS_COMMAND = "refarm";

export interface StatusHostSurfaceStateOptions {
	hostId?: string;
	command?: string;
}

export const STATUS_SURFACE_ACTIONS = createStatusSurfaceActions();

export function createStatusSurfaceActions(
	options: StatusHostSurfaceStateOptions = {},
): HomesteadSurfaceRenderAction[] {
	const hostId = options.hostId ?? DEFAULT_STATUS_HOST_ID;
	const command = options.command ?? DEFAULT_STATUS_COMMAND;
	return [
		{
			id: STATUS_OPEN_REPORT_ACTION_ID,
			label: "Open status report",
			intent: "status:open-report",
			payload: {
				actionId: STATUS_OPEN_REPORT_ACTION_ID,
				command: `${command} status --action ${STATUS_OPEN_REPORT_ACTION_ID}`,
				hostId,
			},
		},
		{
			id: STATUS_INSPECT_TRUST_ACTION_ID,
			label: "Inspect trust",
			intent: "trust:inspect",
			payload: {
				actionId: STATUS_INSPECT_TRUST_ACTION_ID,
				command: `${command} status --action ${STATUS_INSPECT_TRUST_ACTION_ID}`,
				hostId,
			},
		},
	];
}

export function createStatusHostSurfaceState(
	options: StatusHostSurfaceStateOptions = {},
): HomesteadHostSurfaceState {
	const hostId = options.hostId ?? DEFAULT_STATUS_HOST_ID;
	const actions = createStatusSurfaceActions(options);
	return {
		context: {
			hostId,
			data: {
				surfacePurpose: "host status action readiness",
			},
			actions,
		},
		availableActions: actions,
	};
}
