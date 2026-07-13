import { describe, expect, it } from "vitest";

import { isSha256Hex, timingSafeHexEqual } from "./hash.js";
import { sha256Hex } from "./node.js";

describe("isSha256Hex", () => {
	it("accepts a 64-char lowercase hex, rejects everything else", () => {
		expect(isSha256Hex("a".repeat(64))).toBe(true);
		expect(isSha256Hex("A".repeat(64))).toBe(false); // uppercase
		expect(isSha256Hex("a".repeat(63))).toBe(false); // too short
		expect(isSha256Hex(123)).toBe(false);
	});
});

describe("timingSafeHexEqual", () => {
	it("compares equal / unequal / different-length", () => {
		expect(timingSafeHexEqual("abcd", "abcd")).toBe(true);
		expect(timingSafeHexEqual("abcd", "abce")).toBe(false);
		expect(timingSafeHexEqual("abcd", "abc")).toBe(false);
	});
});

describe("sha256Hex (node)", () => {
	it("hashes bytes and strings to a 64-char lowercase hex", () => {
		const h = sha256Hex("hello");
		expect(isSha256Hex(h)).toBe(true);
		// Known SHA-256 of "hello".
		expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
		expect(sha256Hex(new TextEncoder().encode("hello"))).toBe(h);
	});
});
