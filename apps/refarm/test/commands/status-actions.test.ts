import { describe, expect, it, vi } from "vitest";
import {
	createRefarmStatusSurfaceActionHandler,
	createRefarmStatusSurfaceRenderRequest,
	invokeRefarmStatusSurfaceAction,
	REFARM_STATUS_SURFACE_ID,
	REFARM_STATUS_SURFACE_PLUGIN_ID,
	REFARM_STATUS_SURFACE_SLOT_ID,
	resolveRefarmStatusSurfaceActionRequest,
} from "../../src/commands/status-actions.js";
import {
	REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
	REFARM_STATUS_OPEN_REPORT_ACTION_ID,
} from "../../src/commands/status-surfaces.js";

describe("Refarm status surface actions", () => {
	it("creates a canonical status surface render request", () => {
		expect(createRefarmStatusSurfaceRenderRequest()).toEqual({
			pluginId: REFARM_STATUS_SURFACE_PLUGIN_ID,
			slotId: REFARM_STATUS_SURFACE_SLOT_ID,
			mountSource: "legacy-ui-slot",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: REFARM_STATUS_SURFACE_ID,
				slot: REFARM_STATUS_SURFACE_SLOT_ID,
			},
			locale: "en",
		});
	});

	it("resolves live status action requests through Homestead envelope helpers", () => {
		expect(
			resolveRefarmStatusSurfaceActionRequest(
				REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
			),
		).toMatchObject({
			reason: "available",
			request: {
				pluginId: REFARM_STATUS_SURFACE_PLUGIN_ID,
				slotId: REFARM_STATUS_SURFACE_SLOT_ID,
				action: {
					id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
					intent: "trust:inspect",
				},
				host: { hostId: "apps/refarm" },
			},
		});
		expect(resolveRefarmStatusSurfaceActionRequest("missing-action")).toEqual({
			reason: "missing-action",
		});
	});

	it("invokes live status actions through the shared Homestead envelope", async () => {
		const observer = vi.fn();

		await expect(
			invokeRefarmStatusSurfaceAction(
				REFARM_STATUS_OPEN_REPORT_ACTION_ID,
				observer,
			),
		).resolves.toBe(true);
		expect(observer).toHaveBeenCalledWith(
			expect.objectContaining({
				pluginId: REFARM_STATUS_SURFACE_PLUGIN_ID,
				action: expect.objectContaining({
					id: REFARM_STATUS_OPEN_REPORT_ACTION_ID,
					intent: "refarm:status-open",
				}),
			}),
		);

		await expect(
			invokeRefarmStatusSurfaceAction("missing-action", observer),
		).resolves.toBe(false);
	});

	it("rejects actions outside the status action vocabulary", async () => {
		const observer = vi.fn();
		const handler = createRefarmStatusSurfaceActionHandler(observer);
		const resolution = resolveRefarmStatusSurfaceActionRequest(
			REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
		);

		await expect(
			handler({
				...resolution.request!,
				action: { id: "other-action", label: "Other" },
			}),
		).resolves.toBe(false);
		expect(observer).not.toHaveBeenCalled();
	});
});
