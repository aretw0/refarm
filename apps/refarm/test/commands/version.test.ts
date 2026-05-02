import { describe, expect, it } from "vitest";
import {
	__resetRefarmVersionCacheForTests,
	resolveRefarmVersion,
} from "../../src/commands/version.js";

describe("resolveRefarmVersion", () => {
	it("prefers REFARM_VERSION from env", () => {
		__resetRefarmVersionCacheForTests();
		const version = resolveRefarmVersion({
			env: { REFARM_VERSION: "9.9.9" },
			readPackageJson: () => '{"version":"1.0.0"}',
		});
		expect(version).toBe("9.9.9");
	});

	it("falls back to npm_package_version", () => {
		__resetRefarmVersionCacheForTests();
		const version = resolveRefarmVersion({
			env: { npm_package_version: "2.3.4" },
			readPackageJson: () => '{"version":"1.0.0"}',
		});
		expect(version).toBe("2.3.4");
	});

	it("reads version from package json without importing package.json module", () => {
		__resetRefarmVersionCacheForTests();
		const version = resolveRefarmVersion({
			env: {},
			readPackageJson: () => '{"name":"@refarm.dev/refarm","version":"0.7.1"}',
		});
		expect(version).toBe("0.7.1");
	});

	it("returns unknown when version cannot be resolved", () => {
		__resetRefarmVersionCacheForTests();
		const version = resolveRefarmVersion({
			env: {},
			readPackageJson: () => "not-json",
		});
		expect(version).toBe("unknown");
	});
});
