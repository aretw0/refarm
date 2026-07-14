import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { defaultResolverPlugin, runResolver } from "./live-resolver.js";

/**
 * plugin-resolve stores a plugin by SHA-256, resolves it back verified, and proves a tampered copy
 * is rejected (hash-mismatch). Runs OFFLINE (fs + crypto, no daemon), so it needs no gate — but it
 * reads a built .wasm, so it skips gracefully when absent.
 */

const artifactReady = existsSync(defaultResolverPlugin());

describe("plugin-resolve — content-addressed provenance", () => {
	it("is mounted with an IDE command + web route", () => {
		const verb = buildRegistry().get("plugin-resolve");
		if (!verb || "actions" in verb) throw new Error("plugin-resolve not mounted");
		expect(verb.renderers?.web?.route).toBe("/plugin-resolve");
		expect((verb.renderers?.ide as { command?: string } | undefined)?.command).toBe("dgk.plugin-resolve");
	});

	it.skipIf(!artifactReady)("resolves a stored plugin verified, rejects a tampered copy, misses on absent", async () => {
		const report = await runResolver(defaultResolverPlugin());
		// The content-address is a 64-hex sha-256.
		expect(report.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(report.byteLength).toBeGreaterThan(0);
		// The stored ref resolves to the verified bytes …
		expect(report.resolvedVerified).toBe(true);
		// … a TAMPERED copy at the same path is REFUSED (the security-critical invariant) …
		expect(report.tamperRejected).toBe(true);
		expect(report.tamperReason).toBe("hash-mismatch");
		// … and a ref nothing stored is a structured miss, not a crash.
		expect(report.absentReason).toBe("not-found");
	});

	it.skipIf(!artifactReady)("the plugin-resolve VERB reports the content-address + tamper rejection", async () => {
		const verb = buildRegistry().get("plugin-resolve");
		if (!verb || "actions" in verb) throw new Error("plugin-resolve not mounted");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			hash: string;
			resolvedVerified: boolean;
			tamperRejected: boolean;
			tamperReason: string;
		};
		expect(env.ok).toBe(true);
		expect(env.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(env.resolvedVerified).toBe(true);
		expect(env.tamperRejected).toBe(true);
		expect(env.tamperReason).toBe("hash-mismatch");
	});
});
