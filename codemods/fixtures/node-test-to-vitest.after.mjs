import { describe, it, beforeEach, afterAll, expect, vi } from "vitest";

describe("sample", () => {
	beforeEach(() => {
		vi.fn();
	});

	afterAll(() => {
		expect(true, "cleanup ran").toBeTruthy();
	});

	it("rewrites common assertions", async () => {
		expect("a").toBe("a");
		expect("a").not.toBe("b");
		expect({ a: 1 }).toEqual({ a: 1 });
		expect("value", "value should be truthy").toBeTruthy();
		expect("hello", "hello should match").toMatch(/ell/);
		expect("multiline", "multiline match should work").toMatch(/line/);
		expect("hello").not.toMatch(/xyz/);
		await expect(async () => {
			throw new Error("boom");
		}).rejects.toThrow(/boom/);
		await expect(async () => {
			return "ok";
		}, "does not reject").resolves.not.toThrow();
		expect.fail("explicit failure");
	});
});
