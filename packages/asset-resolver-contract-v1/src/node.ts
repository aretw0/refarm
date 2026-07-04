import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	ASSET_RESOLVER_CAPABILITY,
	type AssetRef,
	type AssetResolution,
	type AssetResolver,
	verifyContentHash,
} from "./index.js";

/** The Node digest for the resolver: lowercase-hex SHA-256 of the bytes. */
export function nodeSha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A content-addressed asset resolver backed by a local filesystem content-store:
 * bytes live at `<root>/<hash>` (sharded or flat — flat here). This is the
 * BOOTSTRAP backend; the same `AssetResolver` contract is later satisfied by an
 * OPFS or p2p/peerd backend without any caller change. The store may hold bytes
 * from any origin (a local copy, a synced org dir, a peer download); the hash gate
 * is what makes that safe — a file whose contents do not hash to the requested
 * ref is REJECTED (`hash-mismatch`), never returned. So even a tampered or
 * corrupt content-store entry cannot hand back unverified bytes.
 */
export function createFsAssetResolver(root: string): AssetResolver {
	return {
		capability: ASSET_RESOLVER_CAPABILITY,
		async resolve(ref: AssetRef): Promise<AssetResolution> {
			let bytes: Uint8Array;
			try {
				bytes = await readFile(join(root, ref.hash));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return { ok: false, reason: "not-found" };
				}
				throw error;
			}
			const verified = await verifyContentHash(bytes, ref, nodeSha256Hex);
			if (!verified) return { ok: false, reason: "hash-mismatch" };
			return { ok: true, bytes };
		},
	};
}

/**
 * Compose several resolvers into one that tries each in order and returns the
 * FIRST verified hit — the seam a host uses to layer backends (a local fs store,
 * then an org-synced store, then a p2p network). A `hash-mismatch` from one
 * backend does NOT stop the search: a tampered copy in one place must not deny a
 * good copy elsewhere. Only when every backend misses does the layered resolver
 * report `not-found` (or `hash-mismatch` if that was the closest any got).
 */
export function layeredAssetResolver(
	resolvers: readonly AssetResolver[],
): AssetResolver {
	return {
		capability: ASSET_RESOLVER_CAPABILITY,
		async resolve(ref: AssetRef): Promise<AssetResolution> {
			let sawMismatch = false;
			for (const resolver of resolvers) {
				const result = await resolver.resolve(ref);
				if (result.ok) return result;
				if (result.reason === "hash-mismatch") sawMismatch = true;
			}
			return { ok: false, reason: sawMismatch ? "hash-mismatch" : "not-found" };
		},
	};
}
