import { describe, expect, it } from "vitest";

import { bytesEqual, fromBase64Url, toBase64Url } from "./base64url.js";

describe("base64url, hand-rolled because three runtimes disagree about the obvious answer", () => {
	it("agrees with Node's Buffer over every length that exercises the padding cases", () => {
		// Node is the reference here ONLY in the test — the implementation must not
		// import it, or the block stops being loadable from a page. A disagreement of
		// one byte would silently change a transcript on one side.
		for (let length = 0; length < 130; length += 1) {
			const bytes = new Uint8Array(length);
			globalThis.crypto.getRandomValues(bytes);
			const ours = toBase64Url(bytes);
			expect(ours).toBe(Buffer.from(bytes).toString("base64url"));
			expect(bytesEqual(fromBase64Url(ours), bytes)).toBe(true);
		}
	});

	it("emits no padding and no URL-hostile characters", () => {
		const bytes = new Uint8Array(64);
		globalThis.crypto.getRandomValues(bytes);
		expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("refuses malformed input rather than truncating it", () => {
		expect(() => fromBase64Url("A")).toThrow(SyntaxError);
		expect(() => fromBase64Url("AAA=")).toThrow(SyntaxError);
		expect(() => fromBase64Url("AA+A")).toThrow(SyntaxError);
		expect(() => fromBase64Url("AA/A")).toThrow(SyntaxError);
	});

	it("bytesEqual is total over mismatched lengths", () => {
		expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
		expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
		expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
	});
});
