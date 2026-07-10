import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildNpmInstallReport, type NpmInstallInput } from "./plugin-install-from-npm.js";
import type { ExtensionInstallReport } from "./plugin-install-from-path.js";

const tempRoots: string[] = [];
let prevHome: string | undefined;

// Real bytes + their real sha-256 — the same fixture the local-install test uses,
// so the manifest's declared integrity actually verifies against the bytes.
const WASM_BYTES = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x42]);
const WASM_INTEGRITY = "sha256-e7afd3a94acc8c9488c613adfb39d03db39536e70eb1c57d5f3798197122734f";

const PLUGIN_ID = "@example/note-linter";
const NPM_PACKAGE = "@example/note-linter-plugin";

const MANIFEST = {
	id: PLUGIN_ID,
	name: "Note Linter",
	version: "1.2.0",
	entry: "plugin.wasm",
	integrity: WASM_INTEGRITY,
	capabilities: {
		provides: ["quality:v1"],
		requires: ["storage:v1"],
		providesApi: [],
		requiresApi: [],
	},
	permissions: [],
	observability: {
		hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
	},
	targets: ["server"],
	certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
	trust: { profile: "strict" },
};

/** Create a fake installed npm package under a temp node_modules, with a
 * `package.json` + a `plugin.json` + its `.wasm` at `manifestSubdir` (root or dist).
 * Returns a `baseUrl` inside that tree so `resolvePluginPackage` (require.resolve)
 * finds the package. */
function writeInstalledPackage(manifestSubdir = "."): { baseUrl: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-npm-pkg-"));
	tempRoots.push(root);
	const pkgDir = path.join(root, "node_modules", NPM_PACKAGE);
	const manifestDir = path.join(pkgDir, manifestSubdir);
	fs.mkdirSync(manifestDir, { recursive: true });
	fs.writeFileSync(
		path.join(pkgDir, "package.json"),
		JSON.stringify({ name: NPM_PACKAGE, version: "1.2.0" }),
	);
	fs.writeFileSync(path.join(manifestDir, "plugin.json"), JSON.stringify(MANIFEST));
	fs.writeFileSync(path.join(manifestDir, "plugin.wasm"), WASM_BYTES);
	// A file URL inside the temp root — createRequire resolves the package from here.
	return { baseUrl: pathToFileURL(path.join(root, "consumer.js")).href };
}

function install(input: Partial<NpmInstallInput> & { baseUrl?: string }) {
	return buildNpmInstallReport({
		ref: NPM_PACKAGE,
		grantedCapabilities: ["storage:v1"],
		policyMode: "fail-fast",
		...input,
	});
}

beforeEach(() => {
	prevHome = process.env.REFARM_HOME;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-npm-home-"));
	tempRoots.push(home);
	process.env.REFARM_HOME = home;
});

afterEach(() => {
	if (prevHome === undefined) delete process.env.REFARM_HOME;
	else process.env.REFARM_HOME = prevHome;
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("plugin install from npm — resolve a package, then review-first install (ADR-086 Fase 7b)", () => {
	it("installs a resolved package that ships plugin.json at its root", async () => {
		const { baseUrl } = writeInstalledPackage(".");
		const report = (await install({ baseUrl })) as ExtensionInstallReport;

		expect(report.ok).toBe(true);
		expect(report.pluginId).toBe(PLUGIN_ID);
		expect(report.integrity).toBe(WASM_INTEGRITY);

		// It landed on disk under REFARM_HOME/plugins/<token>/ with a self-contained manifest.
		const installedWasm = path.join(report.installedTo, "plugin.wasm");
		expect(fs.existsSync(installedWasm)).toBe(true);
		expect(fs.readFileSync(installedWasm)).toEqual(WASM_BYTES);
	});

	it("finds the manifest under dist/ too (the built-output convention)", async () => {
		const { baseUrl } = writeInstalledPackage("dist");
		const report = (await install({ baseUrl })) as ExtensionInstallReport;
		expect(report.ok).toBe(true);
		expect(report.pluginId).toBe(PLUGIN_ID);
	});

	it("fails loudly when the package is not installed (no silent registry fetch)", async () => {
		// A baseUrl in an empty temp dir — the package cannot be resolved.
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-npm-empty-"));
		tempRoots.push(empty);
		const report = await install({
			baseUrl: pathToFileURL(path.join(empty, "consumer.js")).href,
		});
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("npm_package_not_resolved");
		expect((report as { message: string }).message).toContain("not installed");
	});

	it("fails loudly when the resolved package ships no plugin.json", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-npm-nomanifest-"));
		tempRoots.push(root);
		const pkgDir = path.join(root, "node_modules", NPM_PACKAGE);
		fs.mkdirSync(pkgDir, { recursive: true });
		fs.writeFileSync(
			path.join(pkgDir, "package.json"),
			JSON.stringify({ name: NPM_PACKAGE, version: "1.0.0" }),
		);
		const report = await install({
			baseUrl: pathToFileURL(path.join(root, "consumer.js")).href,
		});
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("npm_manifest_not_found");
	});

	it("enforces the review gate: a required capability that is not granted refuses install", async () => {
		const { baseUrl } = writeInstalledPackage(".");
		const report = await install({ baseUrl, grantedCapabilities: [] }); // storage:v1 NOT granted

		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("extension_not_ready");
		expect((report as { message: string }).message).toContain("storage:v1");

		// Nothing installed — the gate held.
		const home = process.env.REFARM_HOME as string;
		expect(fs.existsSync(path.join(home, "plugins", "example_note-linter", "plugin.wasm"))).toBe(
			false,
		);
	});
});
