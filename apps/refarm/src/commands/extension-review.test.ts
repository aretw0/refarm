import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildExtensionReviewReport,
	loadReviewableManifest,
} from "./extension-review-capability.js";

const tempRoots: string[] = [];

const VALID_MANIFEST = {
	id: "@example/log-forwarder",
	name: "Log Forwarder",
	version: "0.1.0",
	entry: "https://example.test/plugin.wasm",
	integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	capabilities: {
		provides: ["telemetry:v1"],
		requires: ["network:v1", "storage:v1"],
		providesApi: [],
		requiresApi: [],
	},
	permissions: [],
	observability: {
		hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
	},
	targets: ["server"],
	ui: { icon: "lucide:plug", slots: ["main"], color: "#238636" },
	certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
	trust: { profile: "strict" },
};

function writePreparedExtension(manifest: unknown, filename = "plugin.json"): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-review-"));
	tempRoots.push(root);
	fs.writeFileSync(path.join(root, filename), JSON.stringify(manifest));
	return root;
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("loadReviewableManifest", () => {
	it("finds plugin.json in a prepared extension directory", () => {
		const dir = writePreparedExtension(VALID_MANIFEST);
		const { manifest, manifestPath } = loadReviewableManifest(dir);
		expect(manifestPath).toBe(path.join(dir, "plugin.json"));
		expect((manifest as { id: string }).id).toBe("@example/log-forwarder");
	});

	it("accepts a manifest file directly", () => {
		const dir = writePreparedExtension(VALID_MANIFEST, "ext.json");
		const { manifestPath } = loadReviewableManifest(path.join(dir, "ext.json"));
		expect(manifestPath).toBe(path.join(dir, "ext.json"));
	});

	it("throws for a missing path", () => {
		expect(() => loadReviewableManifest("/no/such/path")).toThrow("No such path");
	});

	it("throws when no manifest is found in a directory", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-review-"));
		tempRoots.push(root);
		expect(() => loadReviewableManifest(root)).toThrow(
			"No plugin.json or ext.json",
		);
	});
});

describe("buildExtensionReviewReport", () => {
	it("blocks a review-first install with all required capabilities denied", () => {
		const dir = writePreparedExtension(VALID_MANIFEST);
		const report = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: [],
			policyMode: "fail-fast",
		});
		expect(report.readyToInstall).toBe(false);
		expect(report.decision.status).toBe("blocked-fail-fast");
		expect(report.deniedCapabilities).toEqual(["network:v1", "storage:v1"]);
		expect(report.nextCommands).toEqual([]);
	});

	it("narrows denied capabilities as grants are supplied", () => {
		const dir = writePreparedExtension(VALID_MANIFEST);
		const report = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: ["storage:v1"],
			policyMode: "fail-fast",
		});
		expect(report.deniedCapabilities).toEqual(["network:v1"]);
		expect(report.readyToInstall).toBe(false);
	});

	it("is ready to install once every required capability is granted", () => {
		const dir = writePreparedExtension(VALID_MANIFEST);
		const report = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: ["network:v1", "storage:v1"],
			policyMode: "fail-fast",
		});
		expect(report.decision.status).toBe("completed");
		expect(report.readyToInstall).toBe(true);
		expect(report.deniedCapabilities).toEqual([]);
		expect(report.nextCommands.length).toBeGreaterThan(0);
	});

	it("reports invalid-manifest without leaking a capability decision", () => {
		const dir = writePreparedExtension({ ...VALID_MANIFEST, id: "no-scope" });
		const report = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: [],
			policyMode: "fail-fast",
		});
		expect(report.decision.status).toBe("invalid-manifest");
		expect(report.readyToInstall).toBe(false);
	});
});
