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
		expect("hello").toMatch(/ell/);
		expect("hello").not.toMatch(/xyz/);
		await expect(async () => {
			throw new Error("boom");
		}).rejects.toThrow(/boom/);
	});
});
