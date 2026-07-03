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
					installed: ["@refarm.dev/agent", 1],
					loaded: ["agent"],
					local: [false, "@local/tool"],
					known: ["@local/tool", "@refarm/agent"],
					activeAgent: "agent",
				}),
			}),
		);

		await expect(readRuntimePluginState()).resolves.toEqual({
			installed: ["@refarm/agent"],
			loaded: ["@refarm/agent"],
			local: ["@local/tool"],
			known: ["@local/tool", "@refarm/agent"],
			activeAgent: "@refarm/agent",
		});
	});

	it("normalizes runtime plugin reload payloads", async () => {
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				reloadId: "reload-1",
				reloaded: ["agent"],
				deferred: ["@local/tool", 0],
				skipped: ["@refarm.dev/agent", "@refarm/missing"],
			}),
		});
		vi.stubGlobal("fetch", fetchSpy);

		await expect(reloadRuntimePlugins(["@refarm/agent"])).resolves.toEqual({
			reloadId: "reload-1",
			reloaded: ["@refarm/agent"],
			deferred: ["@local/tool"],
			skipped: ["@refarm/agent", "@refarm/missing"],
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("/plugins/reload"),
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ pluginIds: ["@refarm/agent"] }),
			}),
		);
	});

	it("normalizes runtime plugin reload request aliases", async () => {
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				reloaded: ["@refarm/agent"],
				deferred: [],
				skipped: [],
			}),
		});
		vi.stubGlobal("fetch", fetchSpy);

		await reloadRuntimePlugins(["agent", "@local/tool"]);

		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("/plugins/reload"),
			expect.objectContaining({
				body: JSON.stringify({
					pluginIds: ["@refarm/agent", "@local/tool"],
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
					deferred: ["agent"],
					skipped: [],
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					pending: [],
					completed: ["@refarm.dev/agent"],
					failed: [],
				}),
			});
		const onDeferred = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		await expect(
			reloadRuntimePluginsAndWait(["agent"], {
				onDeferred,
				pollIntervalMs: 1,
			}),
		).resolves.toEqual({
			reloaded: ["@refarm/agent"],
			skipped: [],
			timedOut: false,
		});
		expect(onDeferred).toHaveBeenCalledWith("@refarm/agent");
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("/plugins/reload/status/reload-1"),
			expect.objectContaining({
				signal: expect.any(Object),
			}),
		);
	});

	it("times out and reports pending deferred plugins as skipped", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					reloadId: "reload-timeout",
					reloaded: [],
					deferred: ["agent"],
					skipped: [],
				}),
			});
		const onDeferred = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		await expect(
			reloadRuntimePluginsAndWait(["agent"], {
				onDeferred,
				pollIntervalMs: 1,
				maxWaitMs: 0,
			}),
		).resolves.toEqual({
			reloaded: [],
			skipped: ["@refarm/agent"],
			timedOut: true,
		});
		expect(onDeferred).toHaveBeenCalledWith("@refarm/agent");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("/plugins/reload"),
			expect.objectContaining({
				method: "POST",
				signal: expect.any(Object),
			}),
		);
	});

	it("returns null when the runtime endpoint is unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

		await expect(readRuntimePluginState()).resolves.toBeNull();
		await expect(reloadRuntimePlugins(["@refarm/agent"])).resolves.toBeNull();
		await expect(reloadRuntimePluginsAndWait(["@refarm/agent"])).resolves.toBeNull();
	});
});
