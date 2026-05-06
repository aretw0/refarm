import { describe, expect, it, vi } from "vitest";
import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createHeadlessStatusSurfaceActionDryRunEnvelope,
	createHeadlessStatusSurfaceHostContext,
	createHeadlessStatusSurfaceRenderRequest,
	invokeHeadlessStatusSurfaceAction,
	resolveHeadlessStatusSurfaceActionRequest,
} from "../../src/commands/headless-action.js";

function makeStatus(): RefarmStatusJson {
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
			capabilities: ["surfaces", "surface-actions", "diagnostics"],
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: 1,
			active: 1,
			rejectedSurfaces: 0,
			surfaceActions: 1,
			availableActions: [
				{
					id: "open-node",
					label: "Open node",
					intent: "node:open",
				},
			],
		},
		trust: { profile: "dev", warnings: 0, critical: 0 },
		streams: { active: 0, terminal: 0 },
		diagnostics: ["plugins:surface-actions-available"],
	};
}

describe("headless surface action invocation", () => {
	it("creates a deterministic headless render request from status", () => {
		expect(createHeadlessStatusSurfaceRenderRequest(makeStatus())).toEqual({
			pluginId: "apps/refarm",
			slotId: "headless",
			mountSource: "legacy-ui-slot",
			surface: undefined,
			locale: "en",
		});
	});

	it("creates host context from status available actions", () => {
		expect(
			createHeadlessStatusSurfaceHostContext(makeStatus(), {
				hostData: { runId: "local-check" },
			}),
		).toEqual({
			hostId: "apps/refarm",
			data: {
				command: "refarm",
				profile: "dev",
				mode: "headless",
				rendererId: "refarm-headless",
				rendererKind: "headless",
				runId: "local-check",
			},
			actions: [
				{
					id: "open-node",
					label: "Open node",
					intent: "node:open",
				},
			],
		});
	});

	it("resolves a selected action request without invoking product handlers", () => {
		expect(
			resolveHeadlessStatusSurfaceActionRequest({
				status: makeStatus(),
				actionId: "open-node",
			}),
		).toMatchObject({
			available: true,
			reason: "available",
			action: {
				id: "open-node",
				label: "Open node",
				intent: "node:open",
			},
			request: {
				pluginId: "apps/refarm",
				slotId: "headless",
				mountSource: "legacy-ui-slot",
				locale: "en",
				action: expect.objectContaining({ id: "open-node" }),
			},
		});
	});

	it("creates a deterministic dry-run action request envelope", () => {
		const status = makeStatus();
		const resolution = resolveHeadlessStatusSurfaceActionRequest({
			status,
			actionId: "open-node",
		});

		expect(resolution.request).toBeDefined();
		expect(
			createHeadlessStatusSurfaceActionDryRunEnvelope(
				status,
				{
					requested: "1",
					source: "index",
					resolvedId: "open-node",
					index: 1,
				},
				resolution.request!,
				resolution.availableActions,
			),
		).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			selection: {
				requested: "1",
				source: "index",
				resolvedId: "open-node",
				index: 1,
			},
			actionRequest: {
				pluginId: "apps/refarm",
				slotId: "headless",
				action: { id: "open-node" },
			},
			availableActions: [expect.objectContaining({ id: "open-node" })],
		});
	});

	it("invokes a selected action through the Homestead action envelope", async () => {
		const handler = vi.fn(async () => undefined);

		const result = await invokeHeadlessStatusSurfaceAction({
			status: makeStatus(),
			actionId: "open-node",
			handler,
			pluginId: "plugin-alpha",
			slotId: "main",
			locale: "pt-BR",
			mountSource: "extension-surface",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: "surface-alpha",
				slot: "main",
			},
		});

		expect(result).toMatchObject({
			handled: true,
			reason: "handled",
			action: {
				id: "open-node",
				label: "Open node",
				intent: "node:open",
			},
		});
		expect(handler).toHaveBeenCalledWith({
			pluginId: "plugin-alpha",
			slotId: "main",
			mountSource: "extension-surface",
			locale: "pt-BR",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: "surface-alpha",
				slot: "main",
			},
			host: expect.objectContaining({
				hostId: "apps/refarm",
				actions: expect.arrayContaining([
					expect.objectContaining({ id: "open-node" }),
				]),
			}),
			action: {
				id: "open-node",
				label: "Open node",
				intent: "node:open",
			},
		});
	});

	it("does not call the handler when the selected action is unavailable", async () => {
		const handler = vi.fn();

		await expect(
			invokeHeadlessStatusSurfaceAction({
				status: makeStatus(),
				actionId: "missing-action",
				handler,
			}),
		).resolves.toMatchObject({
			handled: false,
			reason: "missing-action",
			availableActions: [expect.objectContaining({ id: "open-node" })],
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("preserves explicit false as an unhandled result", async () => {
		await expect(
			invokeHeadlessStatusSurfaceAction({
				status: makeStatus(),
				actionId: "open-node",
				handler: async () => false,
			}),
		).resolves.toMatchObject({
			handled: false,
			reason: "unhandled",
		});
	});
});
