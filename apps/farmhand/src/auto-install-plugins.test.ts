import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@refarm.dev/plugin-manifest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@refarm.dev/plugin-manifest")>();
	return {
		...actual,
		installWasmArtifact: vi.fn().mockResolvedValue({
			pluginId: "plugin-a",
			wasmUrl: "https://example.com/plugin-a.wasm",
			cached: false,
			byteLength: 1024,
			wasmHash: "sha256-abc123",
			artifactKind: "component",
		}),
	};
});

vi.mock("./filesystem-cache-adapter.js", () => ({
	createFilesystemCacheAdapter: vi.fn().mockReturnValue({
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue(undefined),
		evict: vi.fn().mockResolvedValue(undefined),
	}),
}));

import { installWasmArtifact } from "@refarm.dev/plugin-manifest";
import { createFilesystemCacheAdapter } from "./filesystem-cache-adapter.js";
import { autoInstallPlugins } from "./auto-install-plugins.js";

describe("autoInstallPlugins", () => {
	const pluginsDir = "/fake/plugins";
	const logger = { info: vi.fn(), warn: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns zero summary for empty entries", async () => {
		const summary = await autoInstallPlugins([], pluginsDir, logger);
		expect(summary).toEqual({ installed: 0, cached: 0, failed: 0 });
		expect(installWasmArtifact).not.toHaveBeenCalled();
	});

	it("calls installWasmArtifact with correct pluginId, wasmUrl, integrity", async () => {
		const entries = [
			{ id: "plugin-a", url: "https://example.com/plugin-a.wasm", integrity: "sha256-abc" },
		];
		await autoInstallPlugins(entries, pluginsDir, logger);
		expect(installWasmArtifact).toHaveBeenCalledWith(
			{ pluginId: "plugin-a", wasmUrl: "https://example.com/plugin-a.wasm", integrity: "sha256-abc" },
			expect.objectContaining({ cache: expect.anything() }),
		);
	});

	it("creates the cache adapter with pluginsDir", async () => {
		await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "i" }],
			pluginsDir,
			logger,
		);
		expect(createFilesystemCacheAdapter).toHaveBeenCalledWith(pluginsDir);
	});

	it("counts installed when result.cached is false", async () => {
		vi.mocked(installWasmArtifact).mockResolvedValueOnce({
			pluginId: "a",
			wasmUrl: "u",
			cached: false,
			byteLength: 512,
			wasmHash: "h",
			artifactKind: "component",
		});
		const summary = await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "i" }],
			pluginsDir,
			logger,
		);
		expect(summary).toEqual({ installed: 1, cached: 0, failed: 0 });
	});

	it("counts cached when result.cached is true", async () => {
		vi.mocked(installWasmArtifact).mockResolvedValueOnce({
			pluginId: "a",
			wasmUrl: "u",
			cached: true,
			byteLength: 512,
			wasmHash: "h",
			artifactKind: "component",
		});
		const summary = await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "i" }],
			pluginsDir,
			logger,
		);
		expect(summary).toEqual({ installed: 0, cached: 1, failed: 0 });
	});

	it("skips and counts failed for entries missing required fields", async () => {
		const entries = [
			{ url: "u", integrity: "i" },
			{ id: "b", integrity: "i" },
			{ id: "c", url: "u" },
			null,
		];
		const summary = await autoInstallPlugins(entries, pluginsDir, logger);
		expect(summary).toEqual({ installed: 0, cached: 0, failed: 4 });
		expect(installWasmArtifact).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledTimes(4);
	});

	it("counts failed and warns when installWasmArtifact throws", async () => {
		vi.mocked(installWasmArtifact).mockRejectedValueOnce(
			new Error("integrity check failed"),
		);
		const summary = await autoInstallPlugins(
			[{ id: "a", url: "u", integrity: "bad" }],
			pluginsDir,
			logger,
		);
		expect(summary).toEqual({ installed: 0, cached: 0, failed: 1 });
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("failed to install a"),
			"integrity check failed",
		);
	});

	it("processes multiple entries accumulating counts", async () => {
		vi.mocked(installWasmArtifact)
			.mockResolvedValueOnce({ pluginId: "a", wasmUrl: "ua", cached: false, byteLength: 100, wasmHash: "h1", artifactKind: "component" })
			.mockResolvedValueOnce({ pluginId: "b", wasmUrl: "ub", cached: true, byteLength: 200, wasmHash: "h2", artifactKind: "component" })
			.mockRejectedValueOnce(new Error("network error"));
		const entries = [
			{ id: "a", url: "ua", integrity: "ia" },
			{ id: "b", url: "ub", integrity: "ib" },
			{ id: "c", url: "uc", integrity: "ic" },
		];
		const summary = await autoInstallPlugins(entries, pluginsDir, logger);
		expect(summary).toEqual({ installed: 1, cached: 1, failed: 1 });
	});
});
