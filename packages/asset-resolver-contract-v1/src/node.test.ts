import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	createFsAssetResolver,
	createFsAssetStore,
	createPeerAssetResolver,
	layeredAssetResolver,
	nodeSha256Hex,
} from "./node.js";

function write(root: string, bytes: Uint8Array): string {
	const hash = nodeSha256Hex(bytes);
	writeFileSync(join(root, hash), bytes);
	return hash;
}

describe("createFsAssetResolver (content-store, verify before trust)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "asset-store-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("resolves verified bytes for a content-addressed hash", async () => {
		const bytes = new TextEncoder().encode("skill body");
		const hash = write(root, bytes);
		const resolver = createFsAssetResolver(root);

		const result = await resolver.resolve({ hash });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(new TextDecoder().decode(result.bytes)).toBe("skill body");
		}
	});

	it("misses on an unknown hash (not-found)", async () => {
		const resolver = createFsAssetResolver(root);
		const result = await resolver.resolve({ hash: "0".repeat(64) });
		expect(result).toEqual({ ok: false, reason: "not-found" });
	});

	it("REJECTS tampered bytes — a file whose content no longer hashes to the ref", async () => {
		// Store good bytes, then corrupt the file at that path (a tampered/corrupt
		// content-store entry, or a peer that lied). The resolver must NOT return it.
		const bytes = new TextEncoder().encode("original");
		const hash = write(root, bytes);
		writeFileSync(join(root, hash), new TextEncoder().encode("TAMPERED"));

		const result = await createFsAssetResolver(root).resolve({ hash });
		expect(result).toEqual({ ok: false, reason: "hash-mismatch" });
	});
});

describe("createFsAssetStore (write side — round-trips through the resolver)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "asset-store-write-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("stores bytes at their hash and resolves them back verified", async () => {
		const store = createFsAssetStore(root);
		const bytes = new TextEncoder().encode("# Skill\n\nbody");
		const { hash, bytes: length } = await store.store(bytes);

		expect(hash).toBe(nodeSha256Hex(bytes));
		expect(length).toBe(bytes.byteLength);
		const result = await store.resolver.resolve({ hash });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(new TextDecoder().decode(result.bytes)).toBe("# Skill\n\nbody");
		}
	});

	it("is idempotent — re-storing identical bytes lands at the same address", async () => {
		const store = createFsAssetStore(root);
		const bytes = new TextEncoder().encode("same");
		const first = await store.store(bytes);
		const second = await store.store(bytes);
		expect(second.hash).toBe(first.hash);
		expect((await store.resolver.resolve({ hash: first.hash })).ok).toBe(true);
	});

	it("creates the store root on first write (no pre-mkdir needed)", async () => {
		const nested = join(root, "deep", "assets");
		const store = createFsAssetStore(nested);
		const { hash } = await store.store(new TextEncoder().encode("x"));
		expect((await store.resolver.resolve({ hash })).ok).toBe(true);
	});
});

describe("layeredAssetResolver (org → workspace → user byte fallback)", () => {
	let org: string;
	let workspace: string;
	let user: string;
	beforeEach(() => {
		org = mkdtempSync(join(tmpdir(), "asset-org-"));
		workspace = mkdtempSync(join(tmpdir(), "asset-ws-"));
		user = mkdtempSync(join(tmpdir(), "asset-user-"));
	});
	afterEach(() => {
		for (const dir of [org, workspace, user]) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns the first verified hit across layers", async () => {
		const bytes = new TextEncoder().encode("shared skill");
		const hash = write(org, bytes); // only the org layer has it
		const layered = layeredAssetResolver([
			createFsAssetResolver(org),
			createFsAssetResolver(workspace),
			createFsAssetResolver(user),
		]);
		const result = await layered.resolve({ hash });
		expect(result.ok).toBe(true);
	});

	it("a tampered copy in one layer does not deny a good copy in another", async () => {
		const bytes = new TextEncoder().encode("good bytes");
		const hash = nodeSha256Hex(bytes);
		// org has a TAMPERED file at this hash; user has the good one.
		writeFileSync(join(org, hash), new TextEncoder().encode("EVIL"));
		writeFileSync(join(user, hash), bytes);
		const layered = layeredAssetResolver([
			createFsAssetResolver(org),
			createFsAssetResolver(user),
		]);
		const result = await layered.resolve({ hash });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(new TextDecoder().decode(result.bytes)).toBe("good bytes");
		}
	});

	it("reports hash-mismatch when every layer has only tampered copies", async () => {
		const hash = "a".repeat(64);
		writeFileSync(join(org, hash), new TextEncoder().encode("x"));
		writeFileSync(join(user, hash), new TextEncoder().encode("y"));
		const layered = layeredAssetResolver([
			createFsAssetResolver(org),
			createFsAssetResolver(user),
		]);
		expect(await layered.resolve({ hash })).toEqual({
			ok: false,
			reason: "hash-mismatch",
		});
	});
});

describe("createPeerAssetResolver (E4 — verify-before-trust over an injected transport)", () => {
	it("resolves verified bytes fetched from a peer", async () => {
		const bytes = new TextEncoder().encode("plugin from a peer");
		const hash = nodeSha256Hex(bytes);
		const resolver = createPeerAssetResolver(async (ref) =>
			ref.hash === hash ? bytes : null,
		);
		const result = await resolver.resolve({ hash });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(new TextDecoder().decode(result.bytes)).toBe("plugin from a peer");
		}
	});

	it("REJECTS bytes from a lying peer — the hash gate makes an untrusted peer safe", async () => {
		// The peer returns DIFFERENT bytes than the requested hash (a malicious or
		// corrupt peer). The resolver must never hand these back.
		const wanted = nodeSha256Hex(new TextEncoder().encode("the real plugin"));
		const resolver = createPeerAssetResolver(async () =>
			new TextEncoder().encode("MALICIOUS SUBSTITUTE"),
		);
		const result = await resolver.resolve({ hash: wanted });
		expect(result).toEqual({ ok: false, reason: "hash-mismatch" });
	});

	it("a null fetch (peer miss) is not-found", async () => {
		const resolver = createPeerAssetResolver(async () => null);
		expect(await resolver.resolve({ hash: "0".repeat(64) })).toEqual({
			ok: false,
			reason: "not-found",
		});
	});

	it("a transport error is a miss, not a crash", async () => {
		const resolver = createPeerAssetResolver(async () => {
			throw new Error("transport down");
		});
		expect(await resolver.resolve({ hash: "0".repeat(64) })).toEqual({
			ok: false,
			reason: "not-found",
		});
	});

	it("composes behind the local stores in layeredAssetResolver (peer as last resort)", async () => {
		// Nothing local; the peer has it. The layered resolver falls through to the
		// peer backend and returns the verified bytes — E1–E3 callers unchanged.
		const bytes = new TextEncoder().encode("only on the network");
		const hash = nodeSha256Hex(bytes);
		const emptyLocal = createPeerAssetResolver(async () => null); // stand-in local miss
		const peer = createPeerAssetResolver(async (ref) =>
			ref.hash === hash ? bytes : null,
		);
		const layered = layeredAssetResolver([emptyLocal, peer]);
		const result = await layered.resolve({ hash });
		expect(result.ok).toBe(true);
	});
});
