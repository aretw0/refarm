import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildGitInstallReport,
	type CloneRepo,
	type GitInstallInput,
} from "./plugin-install-from-git.js";
import type { ExtensionInstallReport } from "./plugin-install-from-path.js";

const tempRoots: string[] = [];
let prevHome: string | undefined;

const WASM_BYTES = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x42]);
const WASM_INTEGRITY = "sha256-e7afd3a94acc8c9488c613adfb39d03db39536e70eb1c57d5f3798197122734f";

const MANIFEST = {
	id: "@example/git-plugin",
	name: "Git Plugin",
	version: "2.0.0",
	entry: "plugin.wasm",
	integrity: WASM_INTEGRITY,
	capabilities: {
		provides: ["quality:v1"],
		requires: ["storage:v1"],
		providesApi: [],
		requiresApi: [],
	},
	permissions: [],
	observability: { hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"] },
	targets: ["server"],
	certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
	trust: { profile: "strict" },
};

/** A stub clone that "checks out" a prepared plugin (plugin.json + plugin.wasm) at
 * `manifestSubdir` into the dest dir — no network, no git subprocess. Records the
 * remote + ref it was asked to clone so ref-parsing can be asserted. */
function stubClone(
	options: { manifestSubdir?: string; manifest?: unknown; withEntry?: boolean } = {},
): { clone: CloneRepo; calls: Array<{ remote: string; ref?: string }> } {
	const calls: Array<{ remote: string; ref?: string }> = [];
	const clone: CloneRepo = async ({ remote, ref, dest }) => {
		calls.push({ remote, ref });
		const manifestDir = path.join(dest, options.manifestSubdir ?? ".");
		fs.mkdirSync(manifestDir, { recursive: true });
		fs.writeFileSync(
			path.join(manifestDir, "plugin.json"),
			JSON.stringify(options.manifest ?? MANIFEST),
		);
		if (options.withEntry !== false) {
			fs.writeFileSync(path.join(manifestDir, "plugin.wasm"), WASM_BYTES);
		}
	};
	return { clone, calls };
}

function install(input: Partial<GitInstallInput> & { cloneRepo: CloneRepo }) {
	return buildGitInstallReport({
		ref: "git+https://host/owner/repo.git",
		grantedCapabilities: ["storage:v1"],
		policyMode: "fail-fast",
		...input,
	});
}

beforeEach(() => {
	prevHome = process.env.REFARM_HOME;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-git-home-"));
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

describe("plugin install from git — clone a prepared repo, then review-first install (ADR-086 Fase 7c)", () => {
	it("clones a repo that ships plugin.json + entry and installs it", async () => {
		const { clone } = stubClone();
		const report = (await install({ cloneRepo: clone })) as ExtensionInstallReport;

		expect(report.ok).toBe(true);
		expect(report.pluginId).toBe("@example/git-plugin");
		expect(report.integrity).toBe(WASM_INTEGRITY);

		const installedWasm = path.join(report.installedTo, "plugin.wasm");
		expect(fs.existsSync(installedWasm)).toBe(true);
		expect(fs.readFileSync(installedWasm)).toEqual(WASM_BYTES);
	});

	it("strips git+ and passes a #ref to the clone as a branch/tag", async () => {
		const { clone, calls } = stubClone();
		await install({
			ref: "git+https://host/owner/repo.git#v2.0.0",
			cloneRepo: clone,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.remote).toBe("https://host/owner/repo.git");
		expect(calls[0]?.ref).toBe("v2.0.0");
	});

	it("finds the manifest under dist/ too", async () => {
		const { clone } = stubClone({ manifestSubdir: "dist" });
		const report = (await install({ cloneRepo: clone })) as ExtensionInstallReport;
		expect(report.ok).toBe(true);
		expect(report.pluginId).toBe("@example/git-plugin");
	});

	it("fails loudly when the clone fails", async () => {
		const clone: CloneRepo = async () => {
			throw new Error("fatal: repository not found");
		};
		const report = await install({ cloneRepo: clone });
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("git_clone_failed");
	});

	it("fails loudly when the cloned repo ships no plugin.json", async () => {
		const clone: CloneRepo = async ({ dest }) => {
			fs.mkdirSync(dest, { recursive: true });
			fs.writeFileSync(path.join(dest, "README.md"), "# not a plugin\n");
		};
		const report = await install({ cloneRepo: clone });
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("git_manifest_not_found");
	});

	it("fails loudly when the repo ships a manifest but no built entry (installers don't build)", async () => {
		const { clone } = stubClone({ withEntry: false });
		const report = await install({ cloneRepo: clone });
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("extension_entry_missing");
	});

	it("enforces the review gate: a required capability not granted refuses install", async () => {
		const { clone } = stubClone();
		const report = await install({ cloneRepo: clone, grantedCapabilities: [] });
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("extension_not_ready");
	});

	it("does not leave the temp clone behind after a successful install", async () => {
		let capturedDest = "";
		const clone: CloneRepo = async ({ dest }) => {
			capturedDest = dest;
			fs.mkdirSync(dest, { recursive: true });
			fs.writeFileSync(path.join(dest, "plugin.json"), JSON.stringify(MANIFEST));
			fs.writeFileSync(path.join(dest, "plugin.wasm"), WASM_BYTES);
		};
		await install({ cloneRepo: clone });
		expect(capturedDest).not.toBe("");
		expect(fs.existsSync(capturedDest)).toBe(false); // cleaned up in finally
	});
});
