import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAssetResolverV1Conformance, type AssetResolverConformanceHarness } from "./conformance.js";
import {
	createInMemoryAssetResolverConformanceHarness,
	runInMemoryAssetResolverConformance,
	webCryptoSha256Hex,
} from "./in-memory.js";
import { createFsAssetResolver, createPeerAssetResolver, nodeSha256Hex } from "./node.js";

describe("runAssetResolverV1Conformance — the in-memory reference backend is contract-conformant", () => {
	it("the reference resolver passes every invariant (incl. hash-mismatch)", async () => {
		const result = await runAssetResolverV1Conformance(
			createInMemoryAssetResolverConformanceHarness(webCryptoSha256Hex),
			webCryptoSha256Hex,
		);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
		expect(result.skipped).toEqual([]); // the in-memory backend can tamper, so nothing skipped
	});

	it("the runInMemoryAssetResolverConformance convenience runner is green", async () => {
		const result = await runInMemoryAssetResolverConformance();
		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});
});

describe("runAssetResolverV1Conformance — the fs backend is contract-conformant", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "asset-conf-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("the real filesystem resolver passes every invariant (incl. hash-mismatch)", async () => {
		const harness: AssetResolverConformanceHarness = {
			makeResolver(contents) {
				for (const { hash, bytes } of contents) writeFileSync(join(root, hash), bytes);
				return createFsAssetResolver(root);
			},
			// Tamper = store wrong bytes at the ref's path (a corrupt content-store / a lying peer).
			makeTamperedResolver(ref, wrongBytes) {
				writeFileSync(join(root, ref.hash), wrongBytes);
				return createFsAssetResolver(root);
			},
		};
		const result = await runAssetResolverV1Conformance(harness, nodeSha256Hex);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
		expect(result.skipped).toEqual([]); // fs can tamper, so nothing skipped
	});
});

describe("runAssetResolverV1Conformance — the peer backend is contract-conformant", () => {
	it("the peer resolver rejects tampered peer bytes (the security invariant)", async () => {
		// A peer fetcher returns bytes by hash. The harness stores a map; tampering returns wrong
		// bytes for the ref — the peer resolver's hash gate must reject them.
		const harness: AssetResolverConformanceHarness = {
			makeResolver(contents) {
				const byHash = new Map(contents.map((c) => [c.hash, c.bytes]));
				return createPeerAssetResolver(async (ref) => byHash.get(ref.hash) ?? null);
			},
			makeTamperedResolver(_ref, wrongBytes) {
				// The malicious peer returns wrongBytes for ANY ref.
				return createPeerAssetResolver(async () => wrongBytes);
			},
		};
		const result = await runAssetResolverV1Conformance(harness, nodeSha256Hex);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("the conformance suite catches a broken backend", () => {
	it("FAILS a resolver that returns unverified (tampered) bytes — the suite has teeth", async () => {
		// A deliberately BROKEN resolver: it returns whatever bytes it's given without hashing.
		const broken: AssetResolverConformanceHarness = {
			makeResolver(contents) {
				const byHash = new Map(contents.map((c) => [c.hash, c.bytes]));
				return {
					capability: "asset-resolver:v1" as const,
					async resolve(ref) {
						const bytes = byHash.get(ref.hash);
						return bytes ? { ok: true, bytes } : { ok: false, reason: "not-found" };
					},
				};
			},
			// The broken resolver returns the wrong bytes WITHOUT verifying → the suite must fail it.
			makeTamperedResolver(_ref, wrongBytes) {
				return {
					capability: "asset-resolver:v1" as const,
					async resolve() {
						return { ok: true, bytes: wrongBytes }; // no hash check — the bug
					},
				};
			},
		};
		const result = await runAssetResolverV1Conformance(broken, nodeSha256Hex);
		expect(result.pass).toBe(false);
		expect(result.failures.some((f) => f.includes("SECURITY"))).toBe(true);
	});
});
