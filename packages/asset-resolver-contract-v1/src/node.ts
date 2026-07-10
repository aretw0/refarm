import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/** The outcome of storing bytes: the content-address they now live at. */
export interface AssetStoreResult {
	/** The full sha-256 hex the bytes hashed to — their path and their identity. */
	hash: string;
	/** Byte length written. */
	bytes: number;
}

/** The write side of an fs content-store, paired with a read resolver. */
export interface FsAssetStore {
	/** Read side (verify-before-trust) over the same `<root>/<hash>` layout. */
	resolver: AssetResolver;
	/**
	 * Store bytes at `<root>/<hash>` and return their content-address. The hash IS
	 * the identity, so a re-store of identical bytes lands at the same path — the
	 * write is idempotent (dedup for free). Uses an atomic temp+rename so a reader
	 * never sees a half-written entry.
	 */
	store(content: Uint8Array): Promise<AssetStoreResult>;
}

/**
 * Open a filesystem content-store at `root` for both reading and writing. The
 * write side is what a host uses to move bytes OUT of an inline node-ledger and
 * INTO the content-store: it hashes the bytes, writes them at `<root>/<hash>`,
 * and hands back the address the node should point at. Read and write share the
 * one `<root>/<hash>` layout so a stored asset resolves under the same hash — the
 * round-trip that lets a node carry a pointer (`sha256`) instead of the bytes.
 */
export function createFsAssetStore(root: string): FsAssetStore {
	return {
		resolver: createFsAssetResolver(root),
		async store(content: Uint8Array): Promise<AssetStoreResult> {
			const hash = nodeSha256Hex(content);
			await mkdir(root, { recursive: true });
			const finalPath = join(root, hash);
			// Atomic publish: write to a hash-suffixed temp then rename, so a
			// concurrent reader never observes a partial file at the final path.
			const tempPath = `${finalPath}.tmp-${hash.slice(0, 8)}`;
			await writeFile(tempPath, content, { mode: 0o600 });
			await rename(tempPath, finalPath);
			return { hash, bytes: content.byteLength };
		},
	};
}

/**
 * Fetch the bytes for a content-addressed ref from a peer over some transport. The
 * transport is INJECTED — the resolver is agnostic to how bytes arrive (a WebRTC
 * data channel, a relay, libp2p). Returns the raw bytes (unverified — the resolver
 * verifies them) or `null` for a miss. A future real transport supplies this; today
 * it is the dormant seam, so a caller passes whatever fetch it has (or none).
 */
export type PeerAssetFetch = (ref: AssetRef) => Promise<Uint8Array | null>;

/**
 * A content-addressed asset resolver backed by a PEER over an injected transport
 * (E4). This is the p2p backend the `layeredAssetResolver` was designed to accept —
 * it slots in behind the local fs/org-synced stores with ZERO change to any caller
 * (E1–E3 are untouched). Because the resolver contract's invariant is enforced HERE
 * — the fetched bytes are run through `verifyContentHash` before they cross the
 * boundary — streaming an artifact from an UNTRUSTED peer is safe: bytes whose hash
 * does not match the ref are REJECTED (`hash-mismatch`), never returned. The hash is
 * the identity, so the peer cannot substitute different code for a requested hash.
 *
 * The transport itself is dormant today; this wires the verify-before-trust gate and
 * the composition point so that landing a real peer transport is purely additive.
 */
export function createPeerAssetResolver(fetchFromPeer: PeerAssetFetch): AssetResolver {
	return {
		capability: ASSET_RESOLVER_CAPABILITY,
		async resolve(ref: AssetRef): Promise<AssetResolution> {
			let bytes: Uint8Array | null;
			try {
				bytes = await fetchFromPeer(ref);
			} catch {
				// A transport error is a miss, not a crash — the layered resolver
				// moves on to the next backend (or reports not-found).
				return { ok: false, reason: "not-found" };
			}
			if (bytes === null) return { ok: false, reason: "not-found" };
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
export function layeredAssetResolver(resolvers: readonly AssetResolver[]): AssetResolver {
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
