import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";

/**
 * RECOVERY — "perdi o celular, recupero minha identidade."
 *
 * A sovereign identity that lived only on a lost device would be gone forever. The substrate's
 * `deriveFromSession` is the recovery primitive: the citizen re-authenticates (an OPAQUE/WebAuthn
 * handshake — here the resulting session secret) and the provider DETERMINISTICALLY re-derives
 * the SAME identity — same id, same public key. The private key never leaves the provider's
 * boundary (the WASM signer holds it in the sandbox); recovery restores the ability to sign
 * without ever exposing the key. This is what makes "your identity is yours, not the device's"
 * true rather than a slogan.
 */

/**
 * `recover --session <secret>` — recover the citizen's identity from a re-authenticated session.
 * Requires an identity provider that supports the `deriveFromSession` contract hook.
 */
export function createRecoverCapability(identity: IdentityProvider): CapabilityDescriptor {
	return {
		name: "recover",
		summary: "Recover your sovereign identity from a re-authenticated session (lost device)",
		args: [{ name: "session", required: true }],
		options: [
			{ name: "protocol", kind: "string", summary: "Session protocol label (default: opaque)" },
		],
		transports: { http: { path: "/wallet/recover" } },
		renderers: { tui: { section: "wallet" }, web: { route: "/recover", icon: "key-round" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const secret = String(input.args.session ?? "");
			if (!secret) {
				return buildJsonErrorEnvelope({
					command: "recover",
					operation: "recover",
					error: "no_session",
					message: "Pass the session secret from your re-authentication.",
					nextAction: "recover <session-secret>",
				});
			}
			if (!identity.deriveFromSession) {
				return buildJsonErrorEnvelope({
					command: "recover",
					operation: "recover",
					error: "recovery_unsupported",
					message: "This identity provider does not support session-based recovery.",
					nextAction: "Use a provider implementing deriveFromSession (e.g. the WASM signer).",
				});
			}

			const protocol = String(input.options?.protocol ?? "opaque");
			try {
				const handle = await identity.deriveFromSession({
					protocol,
					session: new TextEncoder().encode(secret),
				});
				// Prove the recovered identity can sign again — recovery restored the key material
				// inside the provider without ever exposing it.
				const signature = await identity.sign(handle.identity.id, "recovery-proof");
				const check = await identity.verify(signature.signature, "recovery-proof");
				return buildJsonSuccessEnvelope({
					command: "recover",
					operation: "recover",
					nextCommand: "wallet",
					extra: {
						recovered: true,
						holder: handle.identity.id,
						publicKey: handle.identity.publicKey,
						algorithm: handle.algorithm,
						// The key was NOT exposed — only a proof it works again.
						signingRestored: check.valid,
						protocol,
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "recover",
					operation: "recover",
					error: "recovery_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the session secret is the one from your re-authentication.",
				});
			}
		},
	};
}
