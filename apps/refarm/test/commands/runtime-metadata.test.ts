import { describe, expect, it } from "vitest";
import {
	__resetRefarmRuntimeMetadataCacheForTests,
	resolveRefarmHostIdentity,
	resolveRefarmRuntimeMetadata,
	resolveRefarmVersion,
	resolveWorkingTreeFacts,
} from "../../src/commands/runtime-metadata.js";

describe("resolveRefarmHostIdentity", () => {
	it("returns default host identity", () => {
		expect(resolveRefarmHostIdentity()).toEqual({
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
		});
	});

	it("allows overriding host identity fields", () => {
		expect(
			resolveRefarmHostIdentity({
				app: "apps/custom",
				command: "custom",
				profile: "prod",
			}),
		).toEqual({
			app: "apps/custom",
			command: "custom",
			profile: "prod",
		});
	});
});

describe("resolveRefarmRuntimeMetadata", () => {
	it("returns default host metadata", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const metadata = resolveRefarmRuntimeMetadata({
			env: { REFARM_VERSION: "1.0.0", REFARM_PACKAGE_MANAGER: "npm" },
		});
		expect(metadata).toEqual({
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			version: "1.0.0",
		});
	});

	it("allows overriding app/command/profile", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const metadata = resolveRefarmRuntimeMetadata({
			env: { REFARM_VERSION: "2.0.0", REFARM_PACKAGE_MANAGER: "npm" },
			app: "apps/custom",
			command: "custom",
			profile: "prod",
		});
		expect(metadata).toEqual({
			app: "apps/custom",
			command: "custom",
			profile: "prod",
			version: "2.0.0",
		});
	});

	it("no longer carries the package manager — that moved to the working tree (ISS-093)", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const metadata = resolveRefarmRuntimeMetadata({
			env: { REFARM_VERSION: "1.0.0", REFARM_PACKAGE_MANAGER: "bun" },
		});
		expect("packageManager" in metadata).toBe(false);
	});
});

describe("resolveRefarmVersion (runtime metadata)", () => {
	it("prefers REFARM_VERSION from env", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const version = resolveRefarmVersion({
			env: { REFARM_VERSION: "9.9.9" },
			readPackageJson: () => '{"version":"1.0.0"}',
		});
		expect(version).toBe("9.9.9");
	});

	it("falls back to npm_package_version", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const version = resolveRefarmVersion({
			env: { npm_package_version: "2.3.4" },
			readPackageJson: () => '{"version":"1.0.0"}',
		});
		expect(version).toBe("2.3.4");
	});

	it("reads version from package metadata without module import", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const version = resolveRefarmVersion({
			env: {},
			readPackageJson: () => '{"name":"@refarm.dev/refarm","version":"0.7.1"}',
		});
		expect(version).toBe("0.7.1");
	});

	it("returns unknown when version cannot be resolved", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const version = resolveRefarmVersion({
			env: {},
			readPackageJson: () => "not-json",
		});
		expect(version).toBe("unknown");
	});
});

// ISS-093. `host` promised the HOST — and carried one field that was a fact about the working tree.
// Measured 2026-08-10: `refarm doctor --json` reported host.packageManager as "pnpm" from this
// checkout and "npm" from both /tmp and another workspace, and seven advice fields moved with it. A
// field named host.* cannot depend on which directory the operator is standing in; the resolution
// was never wrong, its NAME was.
describe("host identity versus working tree (ISS-093)", () => {
	it("host carries only what is true of the binary, wherever it was invoked", () => {
		__resetRefarmRuntimeMetadataCacheForTests();
		const metadata = resolveRefarmRuntimeMetadata({ env: { REFARM_VERSION: "1.0.0" } });
		expect(Object.keys(metadata).sort()).toEqual(["app", "command", "profile", "version"]);
	});

	it("the working tree reports where it looked as well as what it found", () => {
		const tree = resolveWorkingTreeFacts({
			cwd: "/some/project",
			env: { REFARM_PACKAGE_MANAGER: "bun" },
		});
		expect(tree).toEqual({ path: "/some/project", packageManager: "bun" });
	});

	it("takes the directory EXPLICITLY — there is no default to forget", () => {
		// The old site was `cwd: options?.cwd ?? process.cwd()`, which is the exact shape
		// scripts/no-os-resolution.mjs counts and the burn-down plan calls the footgun.
		expect(resolveWorkingTreeFacts.length).toBe(1);
	});
});
