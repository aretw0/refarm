import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import type {
	CredentialsProvider,
	CredentialVerificationPolicy,
	VerifiablePresentation,
} from "@refarm.dev/credentials-contract-v1";
import { readFileSync } from "node:fs";

import { DEFAULT_WALLET_VERIFY_POLICY } from "./credentials.js";

/**
 * The VERIFIER side — the other end of the sovereignty loop.
 *
 * `share`/`present` are the CITIZEN producing a signed presentation; this is the SERVICE that
 * RECEIVES one and validates it. Same substrate (`credentialsProvider.verify` auto-dispatches a
 * VerifiablePresentation to the presentation path), viewed from the relying party: every
 * credential is genuine (signature + issuer-match), the holder who presents IS who signed it
 * (holder-binding), and — under `--strict` — each credential is unrevoked from a trusted issuer.
 *
 * Without this verb the demo shows only half the exchange (the citizen presents into the void);
 * with it, an evaluator sees both sides — present AND accept — which is what makes the "só você
 * controla o que compartilha, e o serviço confia nisso" claim legible.
 */

/** Parse a presentation file — the JSON `share` emits (or a wrapped `{ presentation }`). */
export function parsePresentationFile(content: string): VerifiablePresentation {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("INVALID_PRESENTATION: not JSON");
	}
	// Accept either a bare presentation or the `{ presentation, holder, … }` envelope `share` prints.
	const candidate =
		parsed && typeof parsed === "object" && "presentation" in (parsed as Record<string, unknown>)
			? (parsed as { presentation: unknown }).presentation
			: parsed;
	const vp = candidate as VerifiablePresentation;
	if (
		!vp ||
		typeof vp !== "object" ||
		!Array.isArray(vp.type) ||
		!vp.holder ||
		!Array.isArray(vp.verifiableCredential)
	) {
		throw new Error(
			"INVALID_PRESENTATION: not a Verifiable Presentation (needs type, holder, verifiableCredential)",
		);
	}
	return vp;
}

/**
 * `verify-presentation <file>` — the relying party validates a presentation a citizen shared.
 * Holder-binding is always required (the point of a presentation); `--strict` also requires each
 * credential's revocation status + issuer trust, exactly like `verify --strict`.
 */
export function createVerifyPresentationCapability(
	provider: CredentialsProvider,
	options: { policy?: CredentialVerificationPolicy } = {},
): CapabilityDescriptor {
	const basePolicy = options.policy ?? DEFAULT_WALLET_VERIFY_POLICY;
	return {
		name: "verify-presentation",
		summary: "Validate a presentation a citizen shared (the receiving service's side)",
		args: [{ name: "file", required: true }],
		options: [
			{
				name: "strict",
				kind: "boolean",
				summary: "Also require each credential's revocation status + issuer trust",
			},
		],
		transports: { http: { path: "/wallet/verify-presentation" } },
		renderers: { tui: { section: "wallet" }, web: { route: "/verifier", icon: "shield-check" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const file = String(input.args.file ?? "");
			if (!file) {
				return buildJsonErrorEnvelope({
					command: "verify-presentation",
					operation: "verify-presentation",
					error: "no_file",
					message: "Pass the presentation file the citizen shared.",
					nextAction: "verify-presentation <presentation.json>",
				});
			}
			let vp: VerifiablePresentation;
			try {
				vp = parsePresentationFile(readFileSync(file, "utf-8"));
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "verify-presentation",
					operation: "verify-presentation",
					error: "invalid_presentation",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the file is the JSON presentation `share` produced.",
				});
			}

			const strict = input.options?.strict === true;
			// Holder-binding is the essence of a presentation — always required here. Strict raises
			// each credential to revocation + issuer-trust (issuers pinned from the VP's own issuers
			// when no allow-list is configured — self-consistent, deployment overrides).
			const issuers = Array.from(new Set(vp.verifiableCredential.map((c) => c.issuer)));
			const policy: CredentialVerificationPolicy = {
				...basePolicy,
				holderBinding: true,
				...(strict
					? { validity: "required", revocation: "required", trustedIssuers: basePolicy.trustedIssuers ?? issuers }
					: {}),
			};
			const result = await provider.verify(vp, policy);

			if (!result.valid) {
				return buildJsonErrorEnvelope({
					command: "verify-presentation",
					operation: "verify-presentation",
					error: "presentation_rejected",
					message: `Presentation from ${vp.holder} is NOT valid: ${result.failures.join("; ")}`,
					nextAction: "Do not accept this presentation — it failed verification.",
					extra: { holder: vp.holder, valid: false, checks: result.checks, failures: result.failures, strict },
				});
			}

			const enforced = Object.keys(result.checks).filter(
				(k) => (result.checks as Record<string, { ok?: boolean }>)[k]?.ok === true,
			);
			return buildJsonSuccessEnvelope({
				command: "verify-presentation",
				operation: "verify-presentation",
				nextCommand: "wallet",
				extra: {
					holder: vp.holder,
					valid: true,
					// What the citizen disclosed — the credentials the service now accepts.
					accepted: vp.verifiableCredential.map((c) => ({
						type: c.type.find((t) => t !== "VerifiableCredential") ?? "VerifiableCredential",
						issuer: c.issuer,
						subject: typeof c.credentialSubject?.id === "string" ? c.credentialSubject.id : undefined,
					})),
					checks: result.checks,
					enforced,
					strict,
				},
			});
		},
	};
}
