import { describe, expect, it } from "vitest";
import {
	__resetRefarmRuntimeMetadataCacheForTests,
	resolveRefarmHostIdentity,
	resolveRefarmRuntimeMetadata,
	resolveRefarmVersion,
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
			env: { REFARM_VERSION: "1.0.0" },
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
			env: { REFARM_VERSION: "2.0.0" },
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
