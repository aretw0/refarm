import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	detectPluginOrigin,
	readLocalExtensionManifests,
	readSurfaceablePluginVerbs,
} from "./plugin-shared.js";

// ADR-086 phase 3: install routes on the reference shape. This is the classifier;
// a wrong verdict sends a path to the npm resolver (or vice versa), so pin it —
// including the `@scope/pkg` case whose `/` must NOT read as a path separator.
describe("detectPluginOrigin", () => {
	it("classifies explicit filesystem paths as local", () => {
		expect(detectPluginOrigin("./prepared")).toBe("local");
		expect(detectPluginOrigin("/abs/path/to/plugin")).toBe("local");
		expect(detectPluginOrigin("~/plugins/x")).toBe("local");
		expect(detectPluginOrigin("../sibling")).toBe("local");
		// a bare relative path with a separator is still local
		expect(detectPluginOrigin("prepared/plugin")).toBe("local");
	});

	it("classifies npm package references (scoped and bare) as npm", () => {
		expect(detectPluginOrigin("@refarm/agent")).toBe("npm");
		expect(detectPluginOrigin("@scope/some-plugin")).toBe("npm");
		expect(detectPluginOrigin("left-pad")).toBe("npm");
		expect(detectPluginOrigin("my.plugin")).toBe("npm");
	});

	it("classifies git references as git", () => {
		expect(detectPluginOrigin("git+https://github.com/x/p.git")).toBe("git");
		expect(detectPluginOrigin("git@github.com:x/p.git")).toBe("git");
		expect(detectPluginOrigin("https://github.com/x/p.git")).toBe("git");
		expect(detectPluginOrigin("ssh://git@host/x/p.git")).toBe("git");
	});

	it("classifies a plain http(s) descriptor as url (not git)", () => {
		expect(detectPluginOrigin("https://cdn.example/plugin.wasm")).toBe("url");
		expect(detectPluginOrigin("http://host/descriptor.json")).toBe("url");
	});
});

describe("local extension surface manifests", () => {
	it("reads project and global ext.json files as surfaceable plugin manifests", () => {
		const cwd = mkdtempSync(path.join(os.tmpdir(), "refarm-local-ext-cwd-"));
		const home = mkdtempSync(path.join(os.tmpdir(), "refarm-local-ext-home-"));
		try {
			const projectExt = path.join(cwd, ".refarm", "extensions", "wallet");
			const globalExt = path.join(home, ".refarm", "extensions", "requirements");
			mkdirSync(projectExt, { recursive: true });
			mkdirSync(globalExt, { recursive: true });
			writeFileSync(
				path.join(projectExt, "ext.json"),
				JSON.stringify({
					id: "@local/wallet",
					name: "Wallet",
					version: "0.0.1",
					capabilities: {
						provides: ["wallet:open"],
						subscribes: ["wallet:dispatch"],
					},
				}),
			);
			writeFileSync(
				path.join(globalExt, "ext.json"),
				JSON.stringify({
					id: "@local/requirements",
					name: "Requirements",
					version: "0.0.1",
					capabilities: {
						provides: ["requirements:open"],
						subscribes: ["requirements:dispatch"],
					},
				}),
			);

			expect(readLocalExtensionManifests(cwd, home)).toEqual([
				{
					id: "@local/wallet",
					capabilities: {
						provides: ["wallet:open"],
						subscribes: ["wallet:dispatch"],
					},
				},
				{
					id: "@local/requirements",
					capabilities: {
						provides: ["requirements:open"],
						subscribes: ["requirements:dispatch"],
					},
				},
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("normalizes local extension manifests into dispatch surface metadata", () => {
		const cwd = mkdtempSync(path.join(os.tmpdir(), "refarm-local-ext-cwd-"));
		const home = mkdtempSync(path.join(os.tmpdir(), "refarm-local-ext-home-"));
		try {
			const projectExt = path.join(cwd, ".refarm", "extensions", "vault");
			const globalExt = path.join(home, ".refarm", "extensions", "web");
			mkdirSync(projectExt, { recursive: true });
			mkdirSync(globalExt, { recursive: true });
			writeFileSync(
				path.join(projectExt, "ext.json"),
				JSON.stringify({
					id: "@local/vault",
					name: "Vault",
					version: "0.0.1",
					capabilities: {
						provides: ["vault:search", "vault:dispatch"],
						subscribes: ["vault:dispatch"],
					},
				}),
			);
			writeFileSync(
				path.join(globalExt, "ext.json"),
				JSON.stringify({
					id: "@local/web",
					name: "Web",
					version: "0.0.1",
					capabilities: {
						provides: ["web:search"],
						subscribes: ["web:dispatch"],
					},
				}),
			);

			expect(readSurfaceablePluginVerbs(cwd, home, [])).toEqual([
				{
					pluginId: "@local/vault",
					pluginKey: "vault",
					verb: "search",
					target: "vault:search",
					dispatchEvent: "vault:dispatch",
					surfaceName: "vault-search",
				},
				{
					pluginId: "@local/web",
					pluginKey: "web",
					verb: "search",
					target: "web:search",
					dispatchEvent: "web:dispatch",
					surfaceName: "web-search",
				},
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});
});
