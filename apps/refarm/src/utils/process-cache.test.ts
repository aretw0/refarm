import { describe, expect, it } from "vitest";
import { makeProcessCache, resetAllProcessCaches } from "./process-cache.js";

describe("makeProcessCache", () => {
	it("memoizes a value and returns it from get()", () => {
		const cache = makeProcessCache<number>();
		expect(cache.get()).toBeUndefined();
		expect(cache.set(42)).toBe(42);
		expect(cache.get()).toBe(42);
	});

	it("clear() drops the memoized value", () => {
		const cache = makeProcessCache<string>();
		cache.set("x");
		cache.clear();
		expect(cache.get()).toBeUndefined();
	});

	it("resetAllProcessCaches clears every registered cache at once", () => {
		const a = makeProcessCache<number>();
		const b = makeProcessCache<string>();
		a.set(1);
		b.set("two");
		resetAllProcessCaches();
		expect(a.get()).toBeUndefined();
		expect(b.get()).toBeUndefined();
	});
});
