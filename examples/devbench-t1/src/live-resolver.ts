import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import { createFsAssetStore } from "@refarm.dev/asset-resolver-contract-v1/node";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CONTENT-ADDRESSED PROVENANCE — a plugin is an IDENTITY (its hash), not a location.
 *
 * A content-store addresses bytes by their SHA-256: the hash IS the path and the identity. The
 * resolver's invariant is that it NEVER returns bytes whose hash does not match the ref —
 * verification happens inside, before bytes cross the boundary, so streaming from an untrusted
 * peer is safe (tampered bytes are rejected). This verb stores a real plugin by hash, resolves it
 * back (verified), and then TAMPERS the stored bytes to show the resolver refuse them
 * (hash-mismatch) — sovereign provenance: adulterated bytes never reach the runtime.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The plugin whose content-address we demonstrate (a real, built artifact). */
export function defaultResolverPlugin(): string {
	return resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");
}

export interface ResolverReport {
	/** The content-address the bytes stored at (their sha-256 identity). */
	hash: string;
	byteLength: number;
	/** Did resolving the stored ref return the verified bytes? */
	resolvedVerified: boolean;
	/** After tampering the stored file, did the resolver REFUSE it? */
	tamperRejected: boolean;
	/** The miss reason the tampered resolve returned (expected: hash-mismatch). */
	tamperReason?: string;
	/** Resolving a hash nothing stored → a not-found miss (not a crash). */
	absentReason?: string;
}

/**
 * Store a plugin by content-address, resolve it (verified), then tamper the stored bytes and show
 * the resolver reject them. Pure of external I/O beyond a temp content-store dir.
 */
export async function runResolver(pluginPath: string): Promise<ResolverReport> {
	const root = mkdtempSync(join(tmpdir(), "t1-content-store-"));
	const store = createFsAssetStore(root);
	const bytes = new Uint8Array(readFileSync(pluginPath));

	// STORE: the hash is the identity; the write is idempotent (same bytes → same path).
	const stored = await store.store(bytes);

	// RESOLVE: the ref (hash) → verified bytes. The resolver re-hashes before returning.
	const resolved = await store.resolver.resolve({ hash: stored.hash });
	const resolvedVerified = resolved.ok === true && resolved.bytes.byteLength === bytes.byteLength;

	// TAMPER: overwrite the stored file at <root>/<hash> with different bytes, then resolve the
	// SAME ref. The resolver must refuse — the bytes no longer hash to the ref.
	const storedFile = join(root, stored.hash);
	const tampered = new Uint8Array(bytes);
	tampered[0] = (tampered[0]! ^ 0xff) & 0xff; // flip a byte
	writeFileSync(storedFile, tampered);
	const afterTamper = await store.resolver.resolve({ hash: stored.hash });
	const tamperRejected = afterTamper.ok === false;

	// ABSENT: a ref nothing stored → a structured not-found miss (never a crash).
	const absent = await store.resolver.resolve({ hash: "0".repeat(64) });

	return {
		hash: stored.hash,
		byteLength: stored.bytes,
		resolvedVerified,
		tamperRejected,
		...(afterTamper.ok === false ? { tamperReason: afterTamper.reason } : {}),
		...(absent.ok === false ? { absentReason: absent.reason } : {}),
	};
}

/**
 * `plugin-resolve` — store a plugin by SHA-256 in a content-store and resolve it back verified,
 * then prove a TAMPERED copy is rejected (hash-mismatch). A plugin is its hash, not its path;
 * adulterated bytes never reach the runtime. Offline (fs + crypto, no daemon).
 */
export function createPluginResolveCapability(): CapabilityDescriptor {
	return {
		name: "plugin-resolve",
		summary: "Resolve a plugin by content-address (SHA-256) and prove tampered bytes are rejected",
		transports: { http: { path: "/plugin/resolve" } },
		renderers: { tui: { section: "extension" }, web: { route: "/plugin-resolve", icon: "fingerprint" }, ide: { command: "dgk.plugin-resolve" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const pluginPath = defaultResolverPlugin();
			if (!existsSync(pluginPath)) {
				return buildJsonErrorEnvelope({
					command: "plugin-resolve",
					operation: "plugin-resolve",
					error: "artifact_missing",
					message: `Build the plugin first (missing: ${pluginPath}).`,
					nextAction: "pnpm --filter @refarm.dev/source-provider-ref run build:plugin",
				});
			}
			try {
				const report = await runResolver(pluginPath);
				return buildJsonSuccessEnvelope({
					command: "plugin-resolve",
					operation: "plugin-resolve",
					nextCommand: "dgk plugin-catalog",
					nextCommands: ["dgk plugin-catalog"],
					extra: {
						// The plugin's content-address — its sovereign identity.
						hash: report.hash,
						byteLength: report.byteLength,
						// Resolving the ref returns the VERIFIED bytes …
						resolvedVerified: report.resolvedVerified,
						// … and a TAMPERED copy is refused (hash-mismatch) — bytes never cross unverified.
						tamperRejected: report.tamperRejected,
						tamperReason: report.tamperReason,
						absentReason: report.absentReason,
						invariant: "the resolver NEVER returns bytes whose hash does not match the ref — verification is inside the boundary",
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "plugin-resolve",
					operation: "plugin-resolve",
					error: "resolve_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the plugin artifact is built and readable.",
				});
			}
		},
	};
}
