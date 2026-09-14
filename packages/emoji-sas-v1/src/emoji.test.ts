import { describe, expect, it } from "vitest";

import {
	formatSasRow,
	MATRIX_SAS_EMOJI,
	SAS_BITS,
	SAS_EMOJI_COUNT,
	SAS_EMOJI_SET_SIZE,
	sasEmojiFromIndices,
	sasIndicesFromBytes,
} from "./emoji.js";

describe("Matrix's set, used verbatim", () => {
	it("is 64 entries, indexed 0..63, with no gaps and no duplicates", () => {
		expect(MATRIX_SAS_EMOJI).toHaveLength(SAS_EMOJI_SET_SIZE);
		expect(MATRIX_SAS_EMOJI.map((e) => e.index)).toEqual(
			Array.from({ length: SAS_EMOJI_SET_SIZE }, (_, i) => i),
		);
		expect(new Set(MATRIX_SAS_EMOJI.map((e) => e.emoji)).size).toBe(SAS_EMOJI_SET_SIZE);
		expect(new Set(MATRIX_SAS_EMOJI.map((e) => e.description)).size).toBe(SAS_EMOJI_SET_SIZE);
	});

	it("carries Matrix's exact code points, variation selectors included", () => {
		// PIN against a corrupted paste. Every one of these was mangled at least once
		// while this file was being written — ⌛ (U+231B) arriving as ⛛, and the
		// U+FE0F-carrying entries silently losing it, which a terminal will not show
		// you but a comparison against another renderer very much will.
		const codePoints = (index: number) =>
			[...MATRIX_SAS_EMOJI[index]!.emoji].map((c) => c.codePointAt(0));
		expect(codePoints(0)).toEqual([0x1f436]); // Dog
		expect(codePoints(21)).toEqual([0x2601, 0xfe0f]); // Cloud
		expect(codePoints(29)).toEqual([0x2764, 0xfe0f]); // Heart
		expect(codePoints(38)).toEqual([0x231b]); // Hourglass — NOT ⛛
		expect(codePoints(53)).toEqual([0x2708, 0xfe0f]); // Aeroplane
		expect(codePoints(63)).toEqual([0x1f4cc]); // Pin
		expect(MATRIX_SAS_EMOJI[38]!.description).toBe("Hourglass");
	});

	it("compares SEVEN, which is 42 bits — the security parameter, not a layout choice", () => {
		expect(SAS_EMOJI_COUNT).toBe(7);
		expect(SAS_BITS).toBe(42);
		// The count and the alphabet together are the strength. A regression that trims
		// either for a prettier screen must fail here rather than in the field.
		expect(Math.log2(SAS_EMOJI_SET_SIZE) * SAS_EMOJI_COUNT).toBe(42);
	});
});

describe("the bit slicing", () => {
	it("takes Matrix's seven 6-bit groups from the first six bytes", () => {
		expect(sasIndicesFromBytes(new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab]))).toEqual([
			0, 18, 13, 5, 25, 56, 38,
		]);
	});

	it("agrees with an independent big-integer derivation over random material", () => {
		// A second implementation of the SAME rule — "the top 42 bits of the first 48,
		// most-significant first" — so a transposed shift in the byte-wise version is
		// caught by construction rather than by a hand-computed fixture that could have
		// been computed with the same mistake.
		for (let round = 0; round < 200; round += 1) {
			const bytes = new Uint8Array(6);
			globalThis.crypto.getRandomValues(bytes);
			let value = 0n;
			for (const byte of bytes) value = (value << 8n) | BigInt(byte);
			const top42 = value >> 6n;
			const expected = Array.from({ length: 7 }, (_, i) =>
				Number((top42 >> BigInt(6 * (6 - i))) & 0x3fn),
			);
			expect(sasIndicesFromBytes(bytes)).toEqual(expected);
		}
	});

	it("refuses short material rather than padding it", () => {
		// Zero-padding would produce a valid-looking row from less entropy than 42 bits
		// — a weakening in the one direction nobody would notice.
		expect(() => sasIndicesFromBytes(new Uint8Array(5))).toThrow(RangeError);
	});

	it("every legal index maps to an entry, and an illegal one throws", () => {
		for (let i = 0; i < SAS_EMOJI_SET_SIZE; i += 1) {
			expect(sasEmojiFromIndices([i])[0]!.index).toBe(i);
		}
		expect(() => sasEmojiFromIndices([64])).toThrow(RangeError);
		expect(() => sasEmojiFromIndices([-1])).toThrow(RangeError);
	});
});

describe("the row a human reads", () => {
	it("shows the glyph AND Matrix's name, in derivation order", () => {
		const row = formatSasRow(sasEmojiFromIndices([0, 63, 38]));
		expect(row).toBe("🐶 Dog   📌 Pin   ⌛ Hourglass");
	});
});
