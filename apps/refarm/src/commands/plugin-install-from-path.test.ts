import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildExtensionInstallReport,
	type ExtensionInstallReport,
} from "./plugin-install-from-path.js";
import { buildExtensionReviewReport } from "./plugin-review-capability.js";

const tempRoots: string[] = [];
let prevHome: string | undefined;

/** A manifest whose only required capability is granted below — so with the grant
 * it is `readyToInstall`, and without it review denies it. */
// The integrity of the fake wasm bytes below — a .wasm-entry manifest is invalid
// without it (the reviewer must know the hash before approving).
const WASM_BYTES = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x42]);
const WASM_INTEGRITY =
	"sha256-e7afd3a94acc8c9488c613adfb39d03db39536e70eb1c57d5f3798197122734f";

const MANIFEST = {
	id: "@example/note-linter",
	name: "Note Linter",
	version: "1.2.0",
	entry: "plugin.wasm", // relative to the manifest dir — the install resolves it
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

/** Write a prepared extension dir: plugin.json + a (fake but real-bytes) plugin.wasm. */
function writePreparedExtension(): { dir: string; wasmBytes: Buffer } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-ext-install-"));
	tempRoots.push(dir);
	fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(MANIFEST));
	fs.writeFileSync(path.join(dir, "plugin.wasm"), WASM_BYTES);
	return { dir, wasmBytes: WASM_BYTES };
}

beforeEach(() => {
	prevHome = process.env.REFARM_HOME;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-home-"));
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

describe("extension install — closing the review→install loop", () => {
	it("installs the REVIEWED path when the required capability is granted", async () => {
		const { dir, wasmBytes } = writePreparedExtension();

		// review confirms it is ready with the grant, and its handoff points at THIS path.
		const review = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		});
		expect(review.readyToInstall).toBe(true);
		expect(review.nextCommands[0]).toContain(`extension install ${path.join(dir, "plugin.json")}`);

		// install the same path with the same grant.
		const report = (await buildExtensionInstallReport({
			targetPath: dir,
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		})) as ExtensionInstallReport;

		expect(report.ok).toBe(true);
		expect(report.pluginId).toBe("@example/note-linter");
		expect(report.bytes).toBe(wasmBytes.byteLength);

		// The plugin actually landed on disk under REFARM_HOME/plugins/<token>/.
		const installedWasm = path.join(report.installedTo, "plugin.wasm");
		const installedManifest = path.join(report.installedTo, "plugin.json");
		expect(fs.existsSync(installedWasm)).toBe(true);
		expect(fs.readFileSync(installedWasm)).toEqual(wasmBytes);

		// The installed manifest rewrites entry → file:// + carries the real integrity.
		const manifest = JSON.parse(fs.readFileSync(installedManifest, "utf-8"));
		expect(manifest.entry).toBe(`file://${installedWasm}`);
		expect(manifest.integrity).toBe(report.integrity);
		expect(manifest.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
	});

	it("REFUSES to install when a required capability is NOT granted (review-first)", async () => {
		const { dir } = writePreparedExtension();

		const report = await buildExtensionInstallReport({
			targetPath: dir,
			grantedCapabilities: [], // storage:v1 NOT granted
			policyMode: "fail-fast",
		});

		expect(report.ok).toBe(false);
		expect((report as { error?: string }).error).toBe("extension_not_ready");
		expect((report as { message?: string }).message).toContain("storage:v1");

		// Nothing was written — the gate held. (token: @example/note-linter → example_note-linter)
		const home = process.env.REFARM_HOME as string;
		expect(
			fs.existsSync(path.join(home, "plugins", "example_note-linter", "plugin.wasm")),
		).toBe(false);
	});

	it("REJECTS a .wasm that no longer matches the reviewed integrity (tamper guard)", async () => {
		const { dir } = writePreparedExtension();
		// Swap the .wasm for different bytes AFTER the manifest declared its integrity.
		fs.writeFileSync(path.join(dir, "plugin.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x99]));

		const report = await buildExtensionInstallReport({
			targetPath: dir,
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		});

		expect(report.ok).toBe(false);
		expect((report as { error?: string }).error).toBe("extension_integrity_mismatch");
	});

	it("fails clearly when the .wasm is missing beside the manifest", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-ext-nowasm-"));
		tempRoots.push(dir);
		fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(MANIFEST));
		// no plugin.wasm written

		const report = await buildExtensionInstallReport({
			targetPath: dir,
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		});

		expect(report.ok).toBe(false);
		expect((report as { error?: string }).error).toBe("extension_wasm_missing");
	});
});
