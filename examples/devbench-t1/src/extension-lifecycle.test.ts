import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { computeIntegrity, runExtensionLifecycle } from "./extension-lifecycle.js";

describe("extension-lifecycle — author → integrity → maturity → Barn install (one flow)", () => {
	it("computes a canonical sha256- integrity of the artifact bytes", () => {
		expect(computeIntegrity(new Uint8Array([1, 2, 3]))).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
	});

	it("threads a real artifact through integrity → maturity → Barn install (verified)", async () => {
		// A tiny synthetic artifact — the flow is over bytes, not a specific wasm.
		const dir = mkdtempSync(path.join(os.tmpdir(), "lifecycle-"));
		const file = path.join(dir, "plugin.wasm");
		writeFileSync(file, Buffer.from("fake wasm bytes for the lifecycle demo"));

		const report = await runExtensionLifecycle(file);
		// Integrity: a real sha256 of the bytes.
		expect(report.integrity).toMatch(/^sha256-/);
		// Maturity: an assessed rung + the next rung it would climb to.
		expect(report.maturity.level).toBeTruthy();
		expect(Array.isArray(report.maturity.missing)).toBe(true);
		// Install: the Barn fetched (local file), re-verified the sha256, and cached — an
		// install proves the bytes matched the declared integrity.
		expect(report.install.status).toBe("installed");
		expect(report.install.integrityVerified).toBe(true);
		expect(report.install.id).toContain("urn:sovereign:plugin:");
	});

	it("the Barn REJECTS a tampered artifact (integrity is enforced on install)", async () => {
		// Compute integrity for the original bytes, then install DIFFERENT bytes at the same
		// path under that integrity — the Barn's fetch+verify must reject the mismatch.
		const dir = mkdtempSync(path.join(os.tmpdir(), "lifecycle-tamper-"));
		const file = path.join(dir, "plugin.wasm");
		writeFileSync(file, Buffer.from("original bytes"));
		const goodIntegrity = computeIntegrity(new Uint8Array(Buffer.from("original bytes")));
		// Tamper: change the file after the integrity was recorded.
		writeFileSync(file, Buffer.from("TAMPERED bytes"));

		const { Barn } = await import("@refarm.dev/barn");
		const { readFileSync } = await import("node:fs");
		const { pathToFileURL, fileURLToPath } = await import("node:url");
		const barn = new Barn({
			fetchFn: (async (input: unknown) => {
				const url = typeof input === "string" ? input : String((input as { url?: string }).url);
				const bytes = readFileSync(fileURLToPath(url));
				return {
					ok: true,
					status: 200,
					arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
				} as Response;
			}) as typeof globalThis.fetch,
		});
		await expect(barn.installPlugin(pathToFileURL(file).href, goodIntegrity)).rejects.toThrow();
	});

	it("is mounted with a governance section + IDE command", () => {
		const verb = buildRegistry().get("extension-lifecycle");
		if (!verb || "actions" in verb) throw new Error("extension-lifecycle not mounted");
		const ide = verb.renderers?.ide as { command?: string } | undefined;
		expect(ide?.command).toBe("dgk.extension-lifecycle");
	});
});
