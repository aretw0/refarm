import { describe, expect, it, vi } from "vitest";
import {
	createHomesteadSurfaceRenderActionRequest,
	invokeHomesteadSurfaceRenderAction,
	type HomesteadSurfaceRenderContextRequest,
	type HomesteadSurfaceRenderHostContext,
} from "./surface-renderer";

const renderRequest: HomesteadSurfaceRenderContextRequest = {
	pluginId: "plugin-alpha",
	slotId: "main",
	mountSource: "extension-surface",
	surface: {
		layer: "homestead",
		kind: "panel",
		id: "surface-alpha",
		slot: "main",
	},
	locale: "en",
};

const host: HomesteadSurfaceRenderHostContext = {
	hostId: "test-host",
	actions: [
		{
			id: "open-alpha",
			label: "Open Alpha",
			intent: "test:open-alpha",
			payload: { target: "alpha" },
		},
	],
};

describe("Homestead surface action requests", () => {
	it("creates a renderer-independent action request from host context and action id", () => {
		const actionRequest = createHomesteadSurfaceRenderActionRequest(
			renderRequest,
			host,
			"open-alpha",
		);

		expect(actionRequest).toEqual({
			...renderRequest,
			host,
			action: host.actions?.[0],
		});
	});

	it("does not create an action request when the host or action is missing", () => {
		expect(
			createHomesteadSurfaceRenderActionRequest(
				renderRequest,
				undefined,
				"open-alpha",
			),
		).toBeUndefined();
		expect(
			createHomesteadSurfaceRenderActionRequest(
				renderRequest,
				host,
				"missing-action",
			),
		).toBeUndefined();
		expect(
			createHomesteadSurfaceRenderActionRequest(renderRequest, host, undefined),
		).toBeUndefined();
	});

	it("invokes action handlers through the shared envelope", async () => {
		const handler = vi.fn(async () => undefined);

		await expect(
			invokeHomesteadSurfaceRenderAction(
				handler,
				renderRequest,
				host,
				"open-alpha",
			),
		).resolves.toBe(true);

		expect(handler).toHaveBeenCalledWith({
			...renderRequest,
			host,
			action: host.actions?.[0],
		});
	});

	it("reports unhandled actions without invoking product handlers", async () => {
		const handler = vi.fn();

		await expect(
			invokeHomesteadSurfaceRenderAction(
				handler,
				renderRequest,
				host,
				"missing-action",
			),
		).resolves.toBe(false);
		await expect(
			invokeHomesteadSurfaceRenderAction(
				undefined,
				renderRequest,
				host,
				"open-alpha",
			),
		).resolves.toBe(false);

		expect(handler).not.toHaveBeenCalled();
	});

	it("preserves explicit false as an unhandled result", async () => {
		await expect(
			invokeHomesteadSurfaceRenderAction(
				async () => false,
				renderRequest,
				host,
				"open-alpha",
			),
		).resolves.toBe(false);
	});
});
