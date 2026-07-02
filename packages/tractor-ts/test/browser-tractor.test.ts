import { describe, expect, it, vi } from "vitest";
import { Tractor } from "../src/index.browser";
import { MockIdentityAdapter, MockStorageAdapter } from "./test-utils";

describe("browser Tractor runtime", () => {
	it("records emitted telemetry in the public telemetry host", async () => {
		const tractor = await Tractor.boot({
			storage: new MockStorageAdapter(),
			identity: new MockIdentityAdapter(),
			namespace: "test-browser-telemetry",
		});
		const observer = vi.fn();

		tractor.observe(observer);
		tractor.emitTelemetry({
			event: "ui:surface_mounted",
			payload: { secretKey: "hidden", surface: "dashboard" },
		});

		expect(observer).toHaveBeenCalledWith(
			expect.objectContaining({ event: "ui:surface_mounted" }),
		);
		expect(tractor.telemetry.dump()).toEqual([
			{
				event: "ui:surface_mounted",
				pluginId: undefined,
				durationMs: undefined,
				payload: { secretKey: "[REDACTED]", surface: "dashboard" },
			},
		]);
	});
});
