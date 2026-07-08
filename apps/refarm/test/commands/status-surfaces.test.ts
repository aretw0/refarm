import { describe, expect, it } from "vitest";
import {
	createStatusHostSurfaceState,
	createStatusSurfaceActions,
	STATUS_INSPECT_TRUST_ACTION_ID,
	STATUS_OPEN_REPORT_ACTION_ID,
	STATUS_SURFACE_ACTIONS,
} from "../../src/commands/status-surfaces.js";

describe("Status host surface state", () => {
	it("exposes app-owned status action affordances", () => {
		expect(STATUS_SURFACE_ACTIONS).toEqual([
			{
				id: STATUS_OPEN_REPORT_ACTION_ID,
				label: "Open status report",
				intent: "status:open-report",
				payload: {
					actionId: STATUS_OPEN_REPORT_ACTION_ID,
					command: `refarm status --action ${STATUS_OPEN_REPORT_ACTION_ID}`,
					hostId: "apps/refarm",
				},
			},
			{
				id: STATUS_INSPECT_TRUST_ACTION_ID,
				label: "Inspect trust",
				intent: "trust:inspect",
				payload: {
					actionId: STATUS_INSPECT_TRUST_ACTION_ID,
					command: `refarm status --action ${STATUS_INSPECT_TRUST_ACTION_ID}`,
					hostId: "apps/refarm",
				},
			},
		]);
	});

	it("creates white-label status action commands from host options", () => {
		expect(
			createStatusSurfaceActions({
				hostId: "examples/dgk",
				command: "dgk",
			}),
		).toEqual([
			expect.objectContaining({
				id: STATUS_OPEN_REPORT_ACTION_ID,
				payload: expect.objectContaining({
					command: `dgk status --action ${STATUS_OPEN_REPORT_ACTION_ID}`,
					hostId: "examples/dgk",
				}),
			}),
			expect.objectContaining({
				id: STATUS_INSPECT_TRUST_ACTION_ID,
				payload: expect.objectContaining({
					command: `dgk status --action ${STATUS_INSPECT_TRUST_ACTION_ID}`,
					hostId: "examples/dgk",
				}),
			}),
		]);
	});

	it("creates a Homestead surface state snapshot for status building", () => {
		expect(createStatusHostSurfaceState()).toEqual({
			context: {
				hostId: "apps/refarm",
				data: {
					surfacePurpose: "host status action readiness",
				},
				actions: STATUS_SURFACE_ACTIONS,
			},
			availableActions: STATUS_SURFACE_ACTIONS,
		});
	});
});
