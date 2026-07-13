import { canonicalJson } from "./canonical.js";
import {
	AUTHORIZATION_CAPABILITY,
	type AttributeSet,
	type AuthorizationCheck,
	type AuthorizationChecks,
	type AuthorizationProvider,
	type AuthorizationReceipt,
	type AuthorizationVerificationResult,
	type RevocationEvent,
	type SelectivePresentation,
	type ServiceRequest,
} from "./types.js";

/** The proof `type` label the reference provider stamps. Names the algorithm family
 * without claiming a specific standardized suite (a deployment binds a real one). */
const REFERENCE_PROOF_TYPE = "AuthorizationSignature2026";

/**
 * How the reference provider signs and verifies the canonical payload. Injected so the
 * contract stays crypto-agnostic and testable: a deployment passes Ed25519 (node:crypto,
 * as the wallet PoC proved) or a WASM signer; a fixture passes a deterministic stub.
 */
export interface AuthorizationSigner {
	readonly algorithm: string;
	/** Sign the canonical bytes; return a base64url signature. */
	sign(canonical: string): string | Promise<string>;
	/** Verify a signature over the canonical bytes. */
	verify(canonical: string, signature: string): boolean | Promise<boolean>;
}

export interface ReferenceAuthorizationProviderOptions {
	signer: AuthorizationSigner;
	/** The holder identity id this provider signs on behalf of. */
	holderId: string;
	/** Clock — injected so tests are deterministic (defaults to Date.now-based ISO). */
	now?: () => Date;
	/** Id factory — injected for deterministic ids in tests. */
	newId?: (prefix: string) => string;
	pluginId?: string;
}

/** Strip the proof to get the exact payload the signature covers. */
function receiptPayload(receipt: AuthorizationReceipt): Omit<AuthorizationReceipt, "proof"> {
	const { proof: _proof, ...payload } = receipt;
	return payload;
}

/**
 * The reference authorization:v1 provider — the citizen wallet journey as a capability.
 * Pure over its injected signer/clock/id, so it runs the same in a test, a CLI, or a
 * sandboxed plugin. The wallet PoC's inline flow, promoted to a reusable contract impl.
 */
export class ReferenceAuthorizationProvider implements AuthorizationProvider {
	readonly capability = AUTHORIZATION_CAPABILITY;
	readonly pluginId: string;
	private readonly signer: AuthorizationSigner;
	private readonly holderId: string;
	private readonly now: () => Date;
	private readonly newId: (prefix: string) => string;

	constructor(options: ReferenceAuthorizationProviderOptions) {
		this.signer = options.signer;
		this.holderId = options.holderId;
		this.now = options.now ?? (() => new Date());
		this.newId = options.newId ?? ((prefix) => `${prefix}-${this.now().toISOString()}`);
		this.pluginId = options.pluginId ?? "@refarm.dev/authorization-reference";
	}

	async authorize(request: ServiceRequest): Promise<AuthorizationReceipt> {
		const payload: Omit<AuthorizationReceipt, "proof"> = {
			id: this.newId("authz"),
			holder: this.holderId,
			requester: request.requester,
			purpose: request.purpose,
			scope: [...request.requestedAttributes],
			issuedAt: this.now().toISOString(),
			expiresAt: request.expiresAt,
			status: "active",
		};
		const signature = await this.signer.sign(canonicalJson(payload));
		return {
			...payload,
			proof: { type: REFERENCE_PROOF_TYPE, algorithm: this.signer.algorithm, signature },
		};
	}

	async present(
		receipt: AuthorizationReceipt,
		attributes: AttributeSet,
	): Promise<SelectivePresentation> {
		const verification = await this.verify(receipt);
		if (!verification.valid) {
			throw new Error(
				`authorization not usable: ${verification.failures.join(", ") || "invalid"}`,
			);
		}
		// Disclose ONLY the authorized attributes — never more than the scope.
		const presented: Record<string, unknown> = {};
		for (const name of receipt.scope) {
			if (name in attributes.attributes) presented[name] = attributes.attributes[name];
		}
		return {
			id: this.newId("presentation"),
			holder: receipt.holder,
			requester: receipt.requester,
			authorizationId: receipt.id,
			presentedAt: this.now().toISOString(),
			attributes: presented,
		};
	}

	async verify(
		receipt: AuthorizationReceipt,
		presentation?: SelectivePresentation,
	): Promise<AuthorizationVerificationResult> {
		const checks: AuthorizationChecks = {};
		const failures: string[] = [];
		const record = (check: AuthorizationCheck) => {
			checks[check.name] = check;
			if (!check.ok) failures.push(check.detail ? `${check.name}: ${check.detail}` : check.name);
		};

		const signatureOk = await this.signer.verify(
			canonicalJson(receiptPayload(receipt)),
			receipt.proof.signature,
		);
		record({ name: "signature", ok: signatureOk });

		const notRevoked = receipt.status !== "revoked";
		record({ name: "not-revoked", ok: notRevoked });

		const notExpired = this.now().toISOString() < receipt.expiresAt;
		record({
			name: "not-expired",
			ok: notExpired,
			detail: notExpired ? undefined : `expired at ${receipt.expiresAt}`,
		});

		if (presentation) {
			const outOfScope = Object.keys(presentation.attributes).filter(
				(name) => !receipt.scope.includes(name),
			);
			record({
				name: "scope",
				ok: outOfScope.length === 0,
				detail: outOfScope.length ? `disclosed out-of-scope: ${outOfScope.join(", ")}` : undefined,
			});
		}

		return {
			valid: failures.length === 0,
			holder: receipt.holder,
			requester: receipt.requester,
			checks,
			failures,
		};
	}

	async revoke(
		receipt: AuthorizationReceipt,
		reason?: string,
	): Promise<{ event: RevocationEvent; receipt: AuthorizationReceipt }> {
		const event: RevocationEvent = {
			id: this.newId("revocation"),
			authorizationId: receipt.id,
			holder: receipt.holder,
			revokedAt: this.now().toISOString(),
			statusBefore: receipt.status,
			statusAfter: "revoked",
			...(reason ? { reason } : {}),
		};
		return { event, receipt: { ...receipt, status: "revoked" } };
	}
}

export function createReferenceAuthorizationProvider(
	options: ReferenceAuthorizationProviderOptions,
): ReferenceAuthorizationProvider {
	return new ReferenceAuthorizationProvider(options);
}
