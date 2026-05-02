import { describe, expect, it } from "vitest";
import {
	__resetRefarmVersionCacheForTests,
	resolveRefarmVersion,
} from "../../src/commands/version.js";

describe("resolveRefarmVersion (compat wrapper)", () => {
	it("still resolves through runtime metadata implementation", () => {
		__resetRefarmVersionCacheForTests();
		const version = resolveRefarmVersion({
			env: { REFARM_VERSION: "9.9.9" },
			readPackageJson: () => '{"version":"1.0.0"}',
		});
		expect(version).toBe("9.9.9");
	});

	it("still supports package metadata fallback", () => {
		__resetRefarmVersionCacheForTests();
		const version = resolveRefarmVersion({
			env: {},
			readPackageJson: () => '{"name":"@refarm.dev/refarm","version":"0.7.1"}',
		});
		expect(version).toBe("0.7.1");
	});
});
