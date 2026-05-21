import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readRuntimePluginState,
	reloadRuntimePlugins,
	reloadRuntimePluginsAndWait,
} from "./runtime-plugins.js";

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
				reloadId: "reload-1",
				reloaded: ["@refarm/pi-agent"],
				deferred: [0],
				skipped: ["@refarm/missing"],
			}),
		});
		vi.stubGlobal("fetch", fetchSpy);

		await expect(reloadRuntimePlugins(["@refarm/pi-agent"])).resolves.toEqual({
			reloadId: "reload-1",
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

	it("normalizes runtime plugin reload request aliases", async () => {
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				reloaded: ["@refarm/pi-agent"],
				deferred: [],
				skipped: [],
			}),
		});
		vi.stubGlobal("fetch", fetchSpy);

		await reloadRuntimePlugins(["pi-agent", "@local/tool"]);

		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("/plugins/reload"),
			expect.objectContaining({
				body: JSON.stringify({
					pluginIds: ["@refarm/pi-agent", "@local/tool"],
				}),
			}),
		);
	});

	it("waits for deferred plugin reloads to finish", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					reloadId: "reload-1",
					reloaded: [],
					deferred: ["@local/tool"],
					skipped: [],
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					pending: [],
					completed: ["@local/tool"],
					failed: [],
				}),
			});
		const onDeferred = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		await expect(
			reloadRuntimePluginsAndWait(["@local/tool"], {
				onDeferred,
				pollIntervalMs: 1,
			}),
		).resolves.toEqual({
			reloaded: ["@local/tool"],
			skipped: [],
		});
		expect(onDeferred).toHaveBeenCalledWith("@local/tool");
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("/plugins/reload/status/reload-1"),
		);
	});

	it("returns null when the runtime endpoint is unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

		await expect(readRuntimePluginState()).resolves.toBeNull();
		await expect(reloadRuntimePlugins(["@refarm/pi-agent"])).resolves.toBeNull();
		await expect(reloadRuntimePluginsAndWait(["@refarm/pi-agent"])).resolves.toBeNull();
	});
});
