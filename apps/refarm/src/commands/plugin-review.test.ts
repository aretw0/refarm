import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExtensionReviewReport, loadReviewableManifest } from "./plugin-review-capability.js";

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
		expect(() => loadReviewableManifest(root)).toThrow("No plugin.json or ext.json");
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

	it("blocks when a manifest requires a connection the host has not declared", () => {
		const manifest = {
			...structuredClone(VALID_MANIFEST),
			capabilities: {
				...structuredClone(VALID_MANIFEST.capabilities),
				requiresConnections: ["corporate-vpn"],
			},
		};
		const dir = writePreparedExtension(manifest);
		const report = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: ["network:v1", "storage:v1"],
			availableConnections: [],
			policyMode: "fail-fast",
		});
		expect(report.readyToInstall).toBe(false);
		expect(report.missingConnections).toEqual(["corporate-vpn"]);
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

// ADR-086: the same builder projects under either verb (extension|plugin). The
// commandName param is what lets `plugin review` reuse this builder while the
// envelope + install handoff name the verb the operator actually used.
describe("buildExtensionReviewReport commandName (ADR-086 neutralization)", () => {
	it("defaults to the legacy `extension` verb, byte-identical to before", () => {
		const dir = writePreparedExtension(VALID_MANIFEST);
		const report = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: ["network:v1", "storage:v1"],
			policyMode: "fail-fast",
		});
		expect(report.command).toBe("extension");
		// The install handoff still names `extension install <path>` — the closed
		// review→install loop the legacy call-site emitted.
		expect(report.nextCommands[0]).toMatch(/^extension install /);
	});

	it("stamps `plugin` into the envelope and the install handoff when asked", () => {
		const dir = writePreparedExtension(VALID_MANIFEST);
		const report = buildExtensionReviewReport({
			targetPath: dir,
			grantedCapabilities: ["network:v1", "storage:v1"],
			policyMode: "fail-fast",
			commandName: "plugin",
		});
		expect(report.command).toBe("plugin");
		expect(report.operation).toBe("review");
		// The loop stays closed under the new verb: review → `plugin install <path>`.
		expect(report.nextCommands[0]).toMatch(/^plugin install /);
		// The grant flags ride along so the handoff re-reviews with the same grants.
		expect(report.nextCommands[0]).toContain("--grant network:v1");
		expect(report.nextCommands[0]).toContain("--grant storage:v1");
	});
});
