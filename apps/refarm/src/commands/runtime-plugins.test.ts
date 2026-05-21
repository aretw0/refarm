import { afterEach, describe, expect, it, vi } from "vitest";
import { readRuntimePluginState, reloadRuntimePlugins } from "./runtime-plugins.js";

describe("runtime plugin client", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("normalizes runtime plugin state payloads", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					installed: ["@refarm/pi-agent", 1],
					loaded: ["@refarm/pi-agent"],
					local: [false, "@local/tool"],
					known: ["@local/tool", "@refarm/pi-agent"],
				}),
			}),
		);

		await expect(readRuntimePluginState()).resolves.toEqual({
			installed: ["@refarm/pi-agent"],
			loaded: ["@refarm/pi-agent"],
			local: ["@local/tool"],
			known: ["@local/tool", "@refarm/pi-agent"],
		});
	});

	it("normalizes runtime plugin reload payloads", async () => {
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				reloaded: ["@refarm/pi-agent"],
				deferred: [0],
				skipped: ["@refarm/missing"],
			}),
		});
		vi.stubGlobal("fetch", fetchSpy);

		await expect(reloadRuntimePlugins(["@refarm/pi-agent"])).resolves.toEqual({
			reloaded: ["@refarm/pi-agent"],
			deferred: [],
			skipped: ["@refarm/missing"],
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("/plugins/reload"),
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ pluginIds: ["@refarm/pi-agent"] }),
			}),
		);
	});

	it("returns null when the runtime endpoint is unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

		await expect(readRuntimePluginState()).resolves.toBeNull();
		await expect(reloadRuntimePlugins(["@refarm/pi-agent"])).resolves.toBeNull();
	});
});

