import { describe, expect, it } from "vitest";
import {
	createRefarmStatusHostSurfaceState,
	REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
	REFARM_STATUS_OPEN_REPORT_ACTION_ID,
	REFARM_STATUS_SURFACE_ACTIONS,
} from "../../src/commands/status-surfaces.js";

describe("Refarm status host surface state", () => {
	it("exposes app-owned status action affordances", () => {
		expect(REFARM_STATUS_SURFACE_ACTIONS).toEqual([
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
		]);
	});

	it("creates a Homestead surface state snapshot for status building", () => {
		expect(createRefarmStatusHostSurfaceState()).toEqual({
			context: {
				hostId: "apps/refarm",
				data: {
					surfacePurpose: "host status action readiness",
				},
				actions: REFARM_STATUS_SURFACE_ACTIONS,
			},
			availableActions: REFARM_STATUS_SURFACE_ACTIONS,
		});
	});
});
