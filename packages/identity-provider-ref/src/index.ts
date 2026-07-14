import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	IDENTITY_CAPABILITY,
	type Identity,
	type IdentityProvider,
	type SignatureResult,
	type VerificationResult,
} from "@refarm.dev/identity-contract-v1";

/**
 * The host-side loader for the sovereign identity component — the "host dispatch"
 * for a WASM signer. It instantiates the transpiled component under a DENY-ALL
 * capability table: the plugin's wasi imports are satisfied by stubs that trap on
 * every fs/io op, and it is given no `tractor-bridge` beyond the no-op it never
 * calls. The plugin is pure compute over the payload the host hands it.
 *
 * This is the concrete second layer of the sovereign guarantee (see README): the
 * host grants nothing through which the key could leave. The first layer — no
 * exported function returns key material — is in the component itself.
 */

// The transpiled module uses --instantiation, so the loader supplies imports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const bundledPkgDir = fileURLToPath(new URL("../pkg/", import.meta.url));

/** wasi imports that grant NOTHING: no env, no args, no preopened dirs, and every
 * filesystem/io op throws. Mirrors the quality-checker-ref deny-all table — the
 * sandbox is the absence of capability, made explicit by the host. */
function denyAllWasiImports(): Any {
	const noop = () => {};
	const denyingClass = (label: string) =>
		new Proxy(class {}, {
			get() {
				return () => {
					throw new Error(`capability denied: ${label}`);
				};
			},
		});
	const emptyOut = class {
		blockingWriteAndFlush() {}
		write() {}
		checkWrite() {
			return 0n;
		}
	};
	return {
		"wasi:cli/environment": {
			getEnvironment: () => [],
			getArguments: () => [],
			initialCwd: () => undefined,
		},
		"wasi:cli/exit": { exit: noop },
		"wasi:cli/stderr": { getStderr: () => new emptyOut() },
		"wasi:cli/stdin": { getStdin: () => ({}) },
		"wasi:cli/stdout": { getStdout: () => new emptyOut() },
		"wasi:clocks/wall-clock": { now: () => ({ seconds: 0n, nanoseconds: 0 }), resolution: () => ({ seconds: 0n, nanoseconds: 0 }) },
		"wasi:filesystem/preopens": { getDirectories: () => [] },
		"wasi:filesystem/types": {
			Descriptor: denyingClass("filesystem"),
			filesystemErrorCode: () => undefined,
		},
		"wasi:io/error": { Error: class {} },
		"wasi:io/streams": {
			InputStream: denyingClass("io.read"),
			OutputStream: emptyOut,
		},
	};
}

/** The raw sovereign signer surface — the WIT `identity-provider` funcs, camelCased
 * by jco. The key never appears in any of these signatures. */
export interface SovereignSigner {
	/** Sign a payload with the managed key. No key argument — it lives in the sandbox. */
	sign(payload: Uint8Array): Uint8Array;
	/** Verify a signature against an externally supplied public key (pure). */
	verify(payload: Uint8Array, sig: Uint8Array, pubkey: Uint8Array): boolean;
	/** The public half of the managed key — the only key material that crosses out. */
	publicKey(): Uint8Array;
	/** Unlock/derive the managed identity from a session key; returns an opaque handle. */
	deriveFromSession(sessionKey: Uint8Array): bigint;
}

/**
 * Load and instantiate ANY sandboxed `identity-provider` component from a
 * transpiled pkg dir, returning its signer surface under the DENY-ALL capability
 * table. The same sovereign boundary for the bundled reference signer AND any
 * plugin-contributed one.
 */
export async function loadIdentityComponent(options: {
	pkgDir: string;
	entry: string;
}): Promise<SovereignSigner> {
	const { pkgDir, entry } = options;
	const getCoreModule = (path: string): WebAssembly.Module =>
		new WebAssembly.Module(readFileSync(join(pkgDir, path)));
	const mod = (await import(pathToFileURL(join(pkgDir, entry)).href)) as Any;
	const root = await mod.instantiate(getCoreModule, denyAllWasiImports());
	const signer = root.identityProvider as SovereignSigner;
	return {
		sign: (payload) => signer.sign(payload),
		verify: (payload, sig, pubkey) => signer.verify(payload, sig, pubkey),
		publicKey: () => signer.publicKey(),
		deriveFromSession: (sessionKey) => signer.deriveFromSession(sessionKey),
	};
}

/** Instantiate the BUNDLED reference signer (this package's own component). */
export function createReferenceSigner(): Promise<SovereignSigner> {
	return loadIdentityComponent({ pkgDir: bundledPkgDir, entry: "identity_provider.js" });
}

// ── The IdentityProvider contract adapter ────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}
function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}
const enc = new TextEncoder();

const WASM_IDENTITY_ALGORITHM = "ed25519-wasm-sovereign";

/**
 * Adapt the sovereign WASM signer to the `IdentityProvider` contract so T2 (and
 * any identity:v1 consumer) can use it in place of the TS reference — and pass the
 * same conformance suite.
 *
 * The model bridge: the contract is multi-identity (`create` mints one, `sign`
 * takes an id), while the sovereign component holds ONE key at a time, unlocked
 * from a session key. So the adapter keeps a map of `identityId → sessionKey` and
 * re-unlocks the component (`deriveFromSession`) before each `sign`. The crucial
 * difference from `HeartwoodIdentityProvider`: what TS holds here is the SESSION
 * KEY, not the private key. The private key is re-derived inside the sandbox on
 * demand and never materialises in JS. In a real OPAQUE deployment the session key
 * is ephemeral and host-held; here we generate one per identity for a self-
 * contained demo.
 */
export function createWasmIdentityProvider(
	signer: SovereignSigner,
	options: { sessionKeyFor?: (displayName: string | undefined, seq: number) => Uint8Array } = {},
): IdentityProvider {
	const identities = new Map<string, { identity: Identity; sessionKey: Uint8Array }>();
	let seq = 0;

	// A deterministic session key per identity by default (demo-reproducible); a
	// deployment injects `sessionKeyFor` bound to a live OPAQUE/WebAuthn handshake.
	const sessionKeyFor =
		options.sessionKeyFor ??
		((displayName: string | undefined, n: number) => enc.encode(`session:${displayName ?? ""}:${n}`));

	function pubKeyOfSession(sessionKey: Uint8Array): string {
		signer.deriveFromSession(sessionKey);
		return bytesToHex(signer.publicKey());
	}

	return {
		pluginId: "@refarm.dev/identity-provider-ref",
		capability: IDENTITY_CAPABILITY,

		async create(displayName?: string): Promise<Identity> {
			const sessionKey = sessionKeyFor(displayName, seq++);
			const publicKey = pubKeyOfSession(sessionKey);
			const identity: Identity = {
				id: `did:refarm-wasm:${publicKey}`,
				publicKey,
				displayName,
				// createdAt from a caller clock is out of scope for a signer; a stable
				// marker keeps the identity deterministic. A deployment can overwrite.
				createdAt: "1970-01-01T00:00:00.000Z",
			};
			identities.set(identity.id, { identity, sessionKey });
			return identity;
		},

		async sign(identityId: string, data: string): Promise<SignatureResult> {
			const stored = identities.get(identityId);
			if (!stored) throw new Error(`identity not found: ${identityId}`);
			// Re-unlock the sovereign key inside the sandbox, then sign. The private
			// key is never read into TS — only the session key was ever held here.
			signer.deriveFromSession(stored.sessionKey);
			const signature = signer.sign(enc.encode(data));
			return {
				signature: `${WASM_IDENTITY_ALGORITHM}:${encodeURIComponent(identityId)}:${bytesToHex(signature)}`,
				algorithm: WASM_IDENTITY_ALGORITHM,
			};
		},

		async verify(signature: string, data: string): Promise<VerificationResult> {
			const [algorithm, encodedId, sigHex, ...extra] = signature.split(":");
			if (algorithm !== WASM_IDENTITY_ALGORITHM || !encodedId || !sigHex || extra.length > 0) {
				throw new Error("unsupported sovereign identity signature");
			}
			const identityId = decodeURIComponent(encodedId);
			const stored = identities.get(identityId);
			if (!stored) throw new Error(`identity not found: ${identityId}`);
			const valid = signer.verify(
				enc.encode(data),
				hexToBytes(sigHex),
				hexToBytes(stored.identity.publicKey),
			);
			return { valid, identity: stored.identity };
		},

		async get(identityId: string): Promise<Identity | null> {
			return identities.get(identityId)?.identity ?? null;
		},

		async deriveFromSession(input) {
			// The contract's optional session hook maps straight onto the component's:
			// hand the protocol-owned session bytes to the sandbox, which unlocks the
			// key internally and hands back an opaque handle.
			const sessionKey = input.session;
			const handle = signer.deriveFromSession(sessionKey);
			const publicKey = bytesToHex(signer.publicKey());
			const identity: Identity = {
				id: `did:refarm-wasm:${publicKey}`,
				publicKey,
				displayName: input.displayName,
				createdAt: "1970-01-01T00:00:00.000Z",
			};
			identities.set(identity.id, { identity, sessionKey });
			// The opaque handle is the component's fingerprint — a consumer must not
			// parse it or assume it is a key (per the contract).
			return { handle: handle.toString(), identity, algorithm: WASM_IDENTITY_ALGORITHM };
		},
	};
}

/** Convenience: instantiate the bundled sovereign signer AND wrap it as an
 * `IdentityProvider` in one call — the drop-in T2 uses. */
export async function createReferenceWasmIdentityProvider(): Promise<IdentityProvider> {
	return createWasmIdentityProvider(await createReferenceSigner());
}
