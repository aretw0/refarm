import { describe, expect, it, vi } from "vitest";
import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createRefarmStatusSurfaceActionHandler,
	createRefarmStatusSurfaceActionInvocationEnvelope,
	createRefarmStatusSurfaceRenderRequest,
	invokeRefarmStatusSurfaceAction,
	invokeRefarmStatusSurfaceActionSelection,
	REFARM_STATUS_SURFACE_ID,
	REFARM_STATUS_SURFACE_PLUGIN_ID,
	REFARM_STATUS_SURFACE_SLOT_ID,
	resolveRefarmStatusSurfaceActionRequest,
} from "../../src/commands/status-actions.js";
import {
	REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
	REFARM_STATUS_OPEN_REPORT_ACTION_ID,
} from "../../src/commands/status-surfaces.js";

function makeStatus(
	actions: RefarmStatusJson["plugins"]["availableActions"] = [],
): RefarmStatusJson {
	return {
		schemaVersion: 1,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "headless",
		},
		renderer: {
			id: "refarm-headless",
			kind: "headless",
			capabilities: ["surface-actions", "diagnostics"],
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: actions?.length ?? 0,
			active: actions?.length ?? 0,
			rejectedSurfaces: 0,
			surfaceActions: actions?.length ?? 0,
			availableActions: actions,
		},
		trust: { profile: "dev", warnings: 0, critical: 0 },
		streams: { active: 0, terminal: 0 },
		diagnostics: [],
	};
}

const KNOWN_ACTIONS = [
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
] as const;

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

	it("invokes selected live status actions as deterministic result envelopes", async () => {
		const observer = vi.fn();
		const envelope = await invokeRefarmStatusSurfaceActionSelection({
			status: makeStatus([...KNOWN_ACTIONS]),
			selection: "2",
			onAction: observer,
		});

		expect(envelope).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "executed",
			renderer: "status",
			statusSource: "live",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
				index: 2,
			},
			actionRequest: {
				action: { id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID },
			},
			handled: true,
		});
		expect(observer).toHaveBeenCalledWith(
			expect.objectContaining({
				action: expect.objectContaining({
					id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
				}),
			}),
		);
	});

	it("fails selected live status invocation closed for unavailable selections", async () => {
		await expect(
			invokeRefarmStatusSurfaceActionSelection({
				status: makeStatus([]),
				selection: "missing-action",
			}),
		).rejects.toThrow(
			'Status action "missing-action" is not available. Available selections: none.',
		);
	});

	it("rejects invocation when action is in affordances but has no live handler", async () => {
		await expect(
			invokeRefarmStatusSurfaceActionSelection({
				status: makeStatus([
					{ id: "plugin-custom-action", label: "Custom action" },
				]),
				selection: "plugin-custom-action",
			}),
		).rejects.toThrow(
			'Status action "plugin-custom-action" has no live handler. Available selections: [1] plugin-custom-action.',
		);
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

	it("creates deterministic status action invocation envelopes", () => {
		const resolution = resolveRefarmStatusSurfaceActionRequest(
			REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
		);

		expect(
			createRefarmStatusSurfaceActionInvocationEnvelope(
				makeStatus(),
				{
					requested: "2",
					source: "index",
					resolvedId: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
					index: 2,
				},
				resolution.request!,
				true,
				[
					{
						id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
						label: "Inspect trust",
						intent: "trust:inspect",
					},
				],
			),
		).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "executed",
			renderer: "status",
			statusSource: "live",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
				index: 2,
			},
			actionRequest: {
				action: { id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID },
			},
			handled: true,
			availableActions: [
				{
					id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
					label: "Inspect trust",
					intent: "trust:inspect",
				},
			],
		});
	});
});
