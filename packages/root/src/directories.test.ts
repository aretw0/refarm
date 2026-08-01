import path from "node:path";
import { describe, expect, it } from "vitest";
import { sovereignDirectories } from "./directories.js";

describe("sovereignDirectories", () => {
	it("classifies one host-selected root without knowing its brand", () => {
		const directories = sovereignDirectories("/srv/acme");

		expect(directories).toEqual({
			root: "/srv/acme",
			config: "/srv/acme",
			data: "/srv/acme/data",
			state: "/srv/acme/state",
			cache: "/srv/acme/cache",
			runtime: "/srv/acme/runtime",
			distribution: "/srv/acme/dist",
			plugins: "/srv/acme/plugins",
		});
		expect(Object.isFrozen(directories)).toBe(true);
	});

	it("normalizes the root before deriving children", () => {
		expect(sovereignDirectories("/srv/acme/../farm").root).toBe(path.normalize("/srv/farm"));
	});

	it("refuses relative roots so cwd cannot silently change ownership", () => {
		expect(() => sovereignDirectories(".refarm")).toThrow(/must be absolute/);
	});
});
