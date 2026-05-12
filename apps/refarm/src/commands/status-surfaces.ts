import type { HomesteadHostSurfaceState } from "@refarm.dev/homestead/sdk/host-renderer";
import type { HomesteadSurfaceRenderAction } from "@refarm.dev/homestead/sdk/surface-renderer";

export const REFARM_STATUS_OPEN_REPORT_ACTION_ID = "open-status-report";
export const REFARM_STATUS_INSPECT_TRUST_ACTION_ID = "inspect-trust";

export const REFARM_STATUS_SURFACE_ACTIONS = [
	{
		id: REFARM_STATUS_OPEN_REPORT_ACTION_ID,
		label: "Open status report",
		intent: "refarm:status-open",
	},
	{
		id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
		label: "Inspect trust",
		intent: "trust:inspect",
	},
] as const satisfies readonly HomesteadSurfaceRenderAction[];

export function createRefarmStatusHostSurfaceState(): HomesteadHostSurfaceState {
	return {
		context: {
			hostId: "apps/refarm",
			data: {
				surfacePurpose: "host status action readiness",
			},
			actions: [...REFARM_STATUS_SURFACE_ACTIONS],
		},
		availableActions: [...REFARM_STATUS_SURFACE_ACTIONS],
	};
}
