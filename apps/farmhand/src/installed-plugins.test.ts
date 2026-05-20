import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listInstalledPluginIds, loadInstalledPlugins } from "./installed-plugins.js";

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

		const summary = await loadInstalledPlugins(tractor, baseDir, undefined, logger);

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
		const summary = await loadInstalledPlugins(tractor, baseDir, undefined, logger);

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

	it("loads scoped plugins from nested @scope/<name> directories", async () => {
		const baseDir = createTempDir();
		const scopedDir = path.join(baseDir, "plugins", "@refarm", "pi-agent");
		fs.mkdirSync(scopedDir, { recursive: true });

		const manifest = createMockManifest({
			id: "@refarm/pi-agent",
			entry: "file:///tmp/pi_agent.wasm",
		});
		fs.writeFileSync(
			path.join(scopedDir, "plugin.json"),
			JSON.stringify(manifest, null, 2),
			"utf-8",
		);

		const tractor = createTractorStub();
		const logger = { info: vi.fn(), warn: vi.fn() };

		const summary = await loadInstalledPlugins(tractor, baseDir, undefined, logger);

		expect(summary).toEqual({ loaded: 1, skipped: 0 });
		expect(tractor.registry.register).toHaveBeenCalledWith(
			expect.objectContaining({ id: "@refarm/pi-agent" }),
		);
		expect(tractor.registry.trust).toHaveBeenCalledWith("@refarm/pi-agent");
		expect(tractor.plugins.load).toHaveBeenCalledWith(
			expect.objectContaining({ id: "@refarm/pi-agent" }),
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});
});

describe("listInstalledPluginIds", () => {
	it("returns empty array when plugins directory does not exist", () => {
		const baseDir = createTempDir();
		expect(listInstalledPluginIds(baseDir)).toEqual([]);
	});

	it("returns ids of all installed plugins", () => {
		const baseDir = createTempDir();
		const pluginsDir = path.join(baseDir, "plugins");
		fs.mkdirSync(pluginsDir, { recursive: true });

		const pluginIds = ["@refarm/plugin-a", "@refarm/plugin-b"];
		for (const id of pluginIds) {
			const dir = path.join(pluginsDir, id.replace("/", "-"));
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, "plugin.json"),
				JSON.stringify(createMockManifest({ id, entry: `plugin.wasm` })),
				"utf-8",
			);
		}

		const ids = listInstalledPluginIds(baseDir);
		expect(ids).toHaveLength(2);
		expect(ids).toContain("@refarm/plugin-a");
		expect(ids).toContain("@refarm/plugin-b");
	});

	it("silently skips invalid manifests", () => {
		const baseDir = createTempDir();
		const pluginsDir = path.join(baseDir, "plugins");
		fs.mkdirSync(pluginsDir, { recursive: true });

		const dir = path.join(pluginsDir, "broken");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "plugin.json"), "not-json", "utf-8");

		expect(listInstalledPluginIds(baseDir)).toEqual([]);
	});
});

describe("loadInstalledPlugins — pluginFilter", () => {
	it("loads only plugins whose id appears in pluginFilter", async () => {
		const baseDir = createTempDir();
		const pluginsDir = path.join(baseDir, "plugins");
		fs.mkdirSync(pluginsDir, { recursive: true });

		const pluginIds = ["@refarm/plugin-a", "@refarm/plugin-b"];
		for (const id of pluginIds) {
			const dir = path.join(pluginsDir, id.replace("/", "-"));
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, "plugin.json"),
				JSON.stringify(createMockManifest({ id, entry: "plugin.wasm" })),
				"utf-8",
			);
		}

		const tractor = createTractorStub();
		await loadInstalledPlugins(tractor, baseDir, { pluginFilter: ["@refarm/plugin-a"] });

		expect(tractor.plugins.load).toHaveBeenCalledOnce();
		expect(tractor.plugins.load).toHaveBeenCalledWith(
			expect.objectContaining({ id: "@refarm/plugin-a" }),
		);
	});

	it("loads all plugins when pluginFilter is absent", async () => {
		const baseDir = createTempDir();
		const pluginsDir = path.join(baseDir, "plugins");
		fs.mkdirSync(pluginsDir, { recursive: true });

		const pluginIds = ["@refarm/plugin-a", "@refarm/plugin-b"];
		for (const id of pluginIds) {
			const dir = path.join(pluginsDir, id.replace("/", "-"));
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, "plugin.json"),
				JSON.stringify(createMockManifest({ id, entry: "plugin.wasm" })),
				"utf-8",
			);
		}

		const tractor = createTractorStub();
		await loadInstalledPlugins(tractor, baseDir);
		expect(tractor.plugins.load).toHaveBeenCalledTimes(2);
	});
});
