import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
	downloadAttachment,
	extensionFromMimeOrTitle,
	resolveAttachmentPolicy,
	type BinaryFetchDriver,
} from "./attachment.js";
import type { WebSourceSessionEvidence } from "./types.js";

const session: WebSourceSessionEvidence = { kind: "authenticated", authenticated: true };

describe("extensionFromMimeOrTitle", () => {
	it("prefers the MIME type", () => {
		expect(extensionFromMimeOrTitle("image/png", "diagrama")).toBe(".png");
		expect(extensionFromMimeOrTitle("application/pdf; charset=x", "doc")).toBe(".pdf");
	});
	it("falls back to the title extension, then .bin", () => {
		expect(extensionFromMimeOrTitle(undefined, "planilha.xlsx")).toBe(".xlsx");
		expect(extensionFromMimeOrTitle(undefined, "sem-extensao")).toBe(".bin");
	});
});

describe("resolveAttachmentPolicy", () => {
	it("allows a renderable image under the cap", () => {
		expect(resolveAttachmentPolicy({ mimeType: "image/png", title: "x", sizeBytes: 1000 })).toEqual({
			extension: ".png",
			allowed: true,
		});
	});
	it("rejects an unsupported type (a zip)", () => {
		const d = resolveAttachmentPolicy({ mimeType: "application/zip", title: "a.zip" });
		expect(d.allowed).toBe(false);
		expect(d.skipReason).toBe("unsupported_type");
	});
	it("rejects an oversized asset", () => {
		const d = resolveAttachmentPolicy({ mimeType: "image/png", title: "big.png", sizeBytes: 10 * 1024 * 1024 });
		expect(d.allowed).toBe(false);
		expect(d.skipReason).toBe("size_limit");
	});
});

function binaryDriver(bytes: Uint8Array, mediaType: string, declaredSize?: number): BinaryFetchDriver {
	return async () => ({ bytes, mediaType, ...(declaredSize !== undefined ? { declaredSize } : {}) });
}

describe("downloadAttachment", () => {
	it("materializes an allowed asset with a sha256 fingerprint", async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const result = await downloadAttachment("https://alm/att/1", {
			session,
			title: "diagrama.png",
			fetcher: binaryDriver(bytes, "image/png"),
		});
		expect(result.kind).toBe("materialized");
		expect(result.bytes).toBe(bytes);
		expect(result.extension).toBe(".png");
		expect(result.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
		expect(result.sizeBytes).toBe(4);
	});

	it("makes a placeholder for an unsupported type — WITHOUT fetching", async () => {
		const fetcher = vi.fn(binaryDriver(new Uint8Array([0]), "application/zip"));
		const result = await downloadAttachment("https://alm/att/2", { session, title: "pacote.zip", fetcher });
		expect(result.kind).toBe("placeholder");
		expect(result.skipReason).toBe("unsupported_type");
		// The type is unsupported by title alone, so we never spend a fetch on it.
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("makes a placeholder for an oversized asset (by actual bytes)", async () => {
		const big = new Uint8Array(6 * 1024 * 1024);
		const result = await downloadAttachment("https://alm/att/3", {
			session,
			title: "grande.png",
			fetcher: binaryDriver(big, "image/png"),
			maxBytes: 5 * 1024 * 1024,
		});
		expect(result.kind).toBe("placeholder");
		expect(result.skipReason).toBe("size_limit");
		expect(result.sizeBytes).toBe(big.byteLength);
		expect(result.bytes).toBeUndefined();
	});

	it("respects a custom maxBytes", async () => {
		const bytes = new Uint8Array(2048);
		const result = await downloadAttachment("https://alm/att/4", {
			session,
			title: "media.png",
			fetcher: binaryDriver(bytes, "image/png"),
			maxBytes: 1024,
		});
		expect(result.kind).toBe("placeholder");
		expect(result.skipReason).toBe("size_limit");
	});
});
