import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { isSha256Hex, verifyContentHash, type AssetRef } from "./index.js";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("verifyContentHash", () => {
	const bytes = new TextEncoder().encode("hello content");
	const hash = digest(bytes);

	it("accepts bytes whose hash matches the ref", async () => {
		await expect(verifyContentHash(bytes, { hash }, digest)).resolves.toBe(true);
	});

	it("rejects bytes whose hash does not match", async () => {
		const wrong: AssetRef = { hash: "0".repeat(64) };
		await expect(verifyContentHash(bytes, wrong, digest)).resolves.toBe(false);
	});

	it("rejects a non-sha-256 algorithm (v1 is sha-256 only)", async () => {
		await expect(verifyContentHash(bytes, { hash, alg: "sha-512" as never }, digest)).resolves.toBe(
			false,
		);
	});

	it("is length-safe: a differently-sized digest never matches", async () => {
		await expect(verifyContentHash(bytes, { hash: hash.slice(0, 12) }, digest)).resolves.toBe(
			false,
		);
	});
});

describe("isSha256Hex", () => {
	it("accepts a 64-char lowercase hex string", () => {
		expect(isSha256Hex("a".repeat(64))).toBe(true);
		expect(isSha256Hex(digest(new Uint8Array([1, 2, 3])))).toBe(true);
	});

	it("rejects a truncated / uppercase / non-hex value", () => {
		expect(isSha256Hex("a".repeat(12))).toBe(false); // 48-bit prefix — the bug
		expect(isSha256Hex("A".repeat(64))).toBe(false); // uppercase
		expect(isSha256Hex("z".repeat(64))).toBe(false); // non-hex
		expect(isSha256Hex(123)).toBe(false);
	});
});
