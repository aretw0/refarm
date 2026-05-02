import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInstalledPlugins } from "./installed-plugins.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "farmhand-installed-plugins-"),
	);
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function createTractorStub() {
	return {
		registry: {
			register: vi.fn().mockResolvedValue(undefined),
			trust: vi.fn().mockResolvedValue(undefined),
		},
		plugins: {
			load: vi.fn().mockResolvedValue(undefined),
		},
	};
}

describe("loadInstalledPlugins", () => {
	it("returns empty summary when plugins directory is missing", async () => {
		const baseDir = createTempDir();
		const tractor = createTractorStub();
		const logger = { info: vi.fn(), warn: vi.fn() };

		const summary = await loadInstalledPlugins(tractor as any, baseDir, logger);

		expect(summary).toEqual({ loaded: 0, skipped: 0 });
		expect(tractor.registry.register).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("loads valid manifests and skips invalid ones without throwing", async () => {
		const baseDir = createTempDir();
		const pluginsDir = path.join(baseDir, "plugins");
		fs.mkdirSync(pluginsDir, { recursive: true });

		const validDir = path.join(pluginsDir, "valid-plugin");
		fs.mkdirSync(validDir, { recursive: true });
		const validManifest = createMockManifest({
			id: "@refarm/pi-agent",
			entry: "pi-agent.wasm",
		});
		fs.writeFileSync(
			path.join(validDir, "plugin.json"),
			JSON.stringify(validManifest, null, 2),
			"utf-8",
		);

		const invalidDir = path.join(pluginsDir, "invalid-plugin");
		fs.mkdirSync(invalidDir, { recursive: true });
		fs.writeFileSync(
			path.join(invalidDir, "plugin.json"),
			JSON.stringify({ id: "broken" }, null, 2),
			"utf-8",
		);

		const tractor = createTractorStub();
		const logger = { info: vi.fn(), warn: vi.fn() };
		const summary = await loadInstalledPlugins(tractor as any, baseDir, logger);

		expect(summary.loaded).toBe(1);
		expect(summary.skipped).toBe(1);
		expect(tractor.registry.register).toHaveBeenCalledTimes(1);
		expect(tractor.registry.register).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "@refarm/pi-agent",
				entry: "pi-agent.wasm",
			}),
		);
		expect(tractor.registry.trust).toHaveBeenCalledWith("@refarm/pi-agent");
		expect(tractor.plugins.load).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "@refarm/pi-agent",
				entry: "pi-agent.wasm",
			}),
		);
		expect(logger.warn).toHaveBeenCalledTimes(1);
	});
});
