import { describe, expect, it, vi } from "vitest";
import {
	createRefarmMePersonalSurfaceRenderRequest,
	createRefarmMeSurfaceActionHandler,
	createRefarmMeSurfaceContextProvider,
	createRefarmMeSurfacePlugins,
	invokeRefarmMePersonalSurfaceAction,
	REFARM_ME_OPEN_VAULT_ACTION_ID,
	REFARM_ME_PERSONAL_SURFACE_ID,
	REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
	renderRefarmMePersonalSurface,
	resolveRefarmMePersonalSurfaceActionRequest,
} from "./me-surfaces";

describe("refarm.me Homestead surface", () => {
	it("creates an internal personal surface plugin for the shared shell", () => {
		const emitTelemetry = vi.fn();
		const [plugin] = createRefarmMeSurfacePlugins(emitTelemetry);

		expect(plugin?.id).toBe(REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID);
		expect(plugin?.manifest.entry).toBe(
			`internal:${REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID}`,
		);
		expect(plugin?.manifest.extensions?.surfaces?.[0]).toMatchObject({
			layer: "homestead",
			kind: "panel",
			id: REFARM_ME_PERSONAL_SURFACE_ID,
			slot: "main",
			capabilities: ["ui:panel:render"],
		});

		plugin?.emitTelemetry("me:event", { ok: true });
		expect(emitTelemetry).toHaveBeenCalledWith(
			REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			"me:event",
			{ ok: true },
		);
	});

	it("renders host-provided context and action affordance", async () => {
		const [plugin] = createRefarmMeSurfacePlugins();
		const surface = plugin?.manifest.extensions?.surfaces?.[0];
		const request = {
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			slotId: "main",
			mountSource: "extension-surface" as const,
			surface,
			locale: "en",
		};
		const host = await createRefarmMeSurfaceContextProvider()(request);

		const rendered = await plugin?.call("renderHomesteadSurface", {
			...request,
			host,
		});

		expect(host).toMatchObject({
			hostId: "apps/me",
			data: {
				profileName: "My Sovereign Space",
				storageScope: "refarm-me-main",
				syncScope: "citizen",
			},
			actions: [
				expect.objectContaining({
					id: REFARM_ME_OPEN_VAULT_ACTION_ID,
					intent: "me:vault-open",
				}),
			],
		});
		expect(rendered).toMatchObject({
			html: expect.stringContaining(
				`data-refarm-surface-action-id="${REFARM_ME_OPEN_VAULT_ACTION_ID}"`,
			),
		});
		await expect(plugin?.call("other", {})).resolves.toBeNull();
	});

	it("escapes host text before returning explicit HTML", () => {
		const rendered = renderRefarmMePersonalSurface({
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			slotId: "main",
			mountSource: "extension-surface",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: REFARM_ME_PERSONAL_SURFACE_ID,
				slot: "main",
			},
			locale: "en",
			host: {
				hostId: '<apps/me & "citizen">',
				data: { profileName: "Me <Root>" },
				actions: [
					{
						id: REFARM_ME_OPEN_VAULT_ACTION_ID,
						label: "Open <vault>",
					},
				],
			},
		});

		expect((rendered as { html: string }).html).toContain(
			"&lt;apps/me &amp; &quot;citizen&quot;&gt;",
		);
		expect((rendered as { html: string }).html).toContain("Me &lt;Root&gt;");
		expect((rendered as { html: string }).html).toContain("Open &lt;vault&gt;");
	});

	it("creates a canonical personal surface render request", () => {
		expect(createRefarmMePersonalSurfaceRenderRequest()).toEqual({
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			slotId: "main",
			mountSource: "extension-surface",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: REFARM_ME_PERSONAL_SURFACE_ID,
				slot: "main",
			},
			locale: "en",
		});
	});

	it("resolves personal surface action requests through Homestead envelope helpers", async () => {
		await expect(
			resolveRefarmMePersonalSurfaceActionRequest(
				REFARM_ME_OPEN_VAULT_ACTION_ID,
			),
		).resolves.toMatchObject({
			reason: "available",
			request: {
				pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
				slotId: "main",
				action: {
					id: REFARM_ME_OPEN_VAULT_ACTION_ID,
					intent: "me:vault-open",
				},
				host: {
					hostId: "apps/me",
				},
			},
		});
		await expect(
			resolveRefarmMePersonalSurfaceActionRequest("missing-action"),
		).resolves.toEqual({ reason: "missing-action" });
	});

	it("invokes personal surface actions through the shared Homestead envelope", async () => {
		const observer = vi.fn();

		await expect(
			invokeRefarmMePersonalSurfaceAction(
				REFARM_ME_OPEN_VAULT_ACTION_ID,
				observer,
			),
		).resolves.toBe(true);
		expect(observer).toHaveBeenCalledWith(
			expect.objectContaining({
				pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
				action: expect.objectContaining({
					id: REFARM_ME_OPEN_VAULT_ACTION_ID,
					intent: "me:vault-open",
				}),
			}),
		);
		await expect(
			invokeRefarmMePersonalSurfaceAction("missing-action", observer),
		).resolves.toBe(false);
	});

	it("scopes personal surface actions to the Refarm.me plugin", async () => {
		const observer = vi.fn();
		const handler = createRefarmMeSurfaceActionHandler(observer);
		const surface = {
			layer: "homestead" as const,
			kind: "panel" as const,
			id: REFARM_ME_PERSONAL_SURFACE_ID,
			slot: "main",
		};
		const request = {
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			slotId: "main",
			mountSource: "extension-surface" as const,
			surface,
			locale: "en",
			host: { hostId: "apps/me" },
			action: {
				id: REFARM_ME_OPEN_VAULT_ACTION_ID,
				label: "Open personal vault",
			},
		};

		await expect(handler(request)).resolves.toBe(true);
		expect(observer).toHaveBeenCalledWith(request);
		await expect(
			handler({
				...request,
				pluginId: "other-plugin",
			}),
		).resolves.toBe(false);
		await expect(
			handler({
				...request,
				action: { id: "other-action", label: "Other" },
			}),
		).resolves.toBe(false);
	});
});
