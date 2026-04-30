import { describe, expect, it, vi } from "vitest";
import { createStudioPluginHandle } from "./studio-plugin";

describe("createStudioPluginHandle", () => {
	it("creates an internal Studio plugin handle by default", async () => {
		const plugin = createStudioPluginHandle({
			id: "studio-fixture",
			name: "Studio Fixture",
			manifest: {
				extensions: {
					surfaces: [
						{
							layer: "homestead",
							kind: "panel",
							id: "fixture-panel",
							slot: "main",
							capabilities: ["ui:panel:render"],
						},
					],
				},
			},
		});

		expect(plugin.id).toBe("studio-fixture");
		expect(plugin.state).toBe("running");
		expect(plugin.manifest.entry).toBe("internal:studio-fixture");
		expect(plugin.manifest.extensions?.surfaces?.[0]?.id).toBe("fixture-panel");
		expect(await plugin.call("noop")).toBeNull();
	});

	it("allows explicit external entries for trust-gate diagnostics", () => {
		const plugin = createStudioPluginHandle({
			id: "external-fixture",
			name: "External Fixture",
			entry: "./dist/external.mjs",
		});

		expect(plugin.manifest.entry).toBe("./dist/external.mjs");
	});

	it("uses provided telemetry and call handlers", async () => {
		const emitTelemetry = vi.fn();
		const plugin = createStudioPluginHandle({
			id: "callable-fixture",
			name: "Callable Fixture",
			call: async (fn, args) => ({ fn, args }),
			emitTelemetry,
		});

		expect(await plugin.call("do-work", { ok: true })).toEqual({
			fn: "do-work",
			args: { ok: true },
		});
		plugin.emitTelemetry("studio:event", { ok: true });
		expect(emitTelemetry).toHaveBeenCalledWith("studio:event", { ok: true });
	});
});
