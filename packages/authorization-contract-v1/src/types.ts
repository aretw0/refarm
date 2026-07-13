/**
 * authorization:v1 — the purpose-bound consent, selective-presentation, and revocation
 * contract. A citizen (holder) authorizes a service (requester) to see a NAMED subset of
 * their attributes, FOR a stated purpose, WITHIN a scope and expiry — signs that decision
 * — and can revoke it later, leaving an auditable trail. This is the "wallet authorization
 * journey" as a versioned capability, so any surface/plugin drives it the same way (the
 * sibling of credentials:v1, which proves a credential; this governs its DISCLOSURE).
 *
 * The domain shapes mirror the W3C/EUDI vocabulary in spirit (purpose, scope, selective
 * disclosure, status) without claiming conformance — a deployment maps these to
 * OpenID4VP/VC as a later step.
 */

export const AUTHORIZATION_CAPABILITY = "authorization:v1" as const;

/** The stable JSON-LD-ish context IRI for authorization artifacts (parallels credentials). */
export const AUTHORIZATION_CONTEXT_IRI = "https://refarm.dev/contexts/authorization/v1" as const;

/** The lifecycle status of an authorization. */
export type AuthorizationStatus = "active" | "revoked" | "expired";

/** A service's REQUEST for attributes — what it wants, why, for how long. The holder reads
 * this to decide. Purpose/scope/expiry are mandatory so consent is never open-ended. */
export interface ServiceRequest {
	id: string;
	/** The service asking (the verifier). */
	requester: string;
	/** The citizen whose attributes are requested (the holder/subject). */
	subject: string;
	/** WHY the attributes are needed — the operator-facing justification of purpose. */
	purpose: string;
	/** A longer human-readable justification (optional). */
	justification?: string;
	/** The attribute NAMES requested — the scope. Disclosure never exceeds this set. */
	requestedAttributes: string[];
	/** When the request/authorization should lapse (ISO 8601). */
	expiresAt: string;
}

/** A cryptographic proof over the canonical authorization payload. */
export interface AuthorizationProof {
	type: string;
	algorithm: string;
	/** base64url signature over the canonical JSON of the (proof-less) payload. */
	signature: string;
}

/** The holder's granted authorization — a signed receipt of a consent decision. Carries
 * purpose, scope, and expiry from the request, plus a status the holder can change. */
export interface AuthorizationReceipt {
	id: string;
	holder: string;
	requester: string;
	purpose: string;
	/** The authorized attribute names (a subset of / equal to the request's scope). */
	scope: string[];
	issuedAt: string;
	expiresAt: string;
	status: AuthorizationStatus;
	proof: AuthorizationProof;
}

/** The attributes a holder actually holds, keyed by name. The source for presentation. */
export interface AttributeSet {
	subject: string;
	issuer: string;
	issuedAt: string;
	attributes: Record<string, unknown>;
}

/** A SELECTIVE presentation — only the attributes the authorization's scope permits, never
 * more. This is the minimized-disclosure artifact a verifier receives. */
export interface SelectivePresentation {
	id: string;
	holder: string;
	requester: string;
	authorizationId: string;
	presentedAt: string;
	/** Only the authorized attributes — a strict subset of the holder's AttributeSet. */
	attributes: Record<string, unknown>;
}

/** A revocation — the holder withdrawing a prior authorization, with the status transition
 * recorded for audit. After this the authorization must not be usable. */
export interface RevocationEvent {
	id: string;
	authorizationId: string;
	holder: string;
	revokedAt: string;
	statusBefore: AuthorizationStatus;
	statusAfter: "revoked";
	reason?: string;
}

/** The named checks a verify() runs over an authorization or presentation. */
export type AuthorizationCheckName =
	| "signature" // the proof verifies against the canonical payload
	| "not-expired" // now < expiresAt
	| "not-revoked" // status is not revoked
	| "scope"; // a presentation discloses only in-scope attributes

export interface AuthorizationCheck {
	name: AuthorizationCheckName;
	ok: boolean;
	detail?: string;
}

export type AuthorizationChecks = Partial<Record<AuthorizationCheckName, AuthorizationCheck>>;

/** The result of verifying an authorization (and optionally a presentation against it). */
export interface AuthorizationVerificationResult {
	/** All required checks passed. */
	valid: boolean;
	holder?: string;
	requester?: string;
	checks: AuthorizationChecks;
	failures: string[];
}

/**
 * The authorization:v1 provider — the full journey as one capability:
 *   authorize → present → verify → revoke.
 * A reference implementation signs with an injected signer + clock; a deployment binds it
 * to the citizen's identity/storage. All async to match the sibling contracts.
 */
export interface AuthorizationProvider {
	readonly pluginId: string;
	readonly capability: typeof AUTHORIZATION_CAPABILITY;

	/** Grant a request: produce a signed AuthorizationReceipt (status active). The holder's
	 * consent decision — purpose/scope/expiry are copied from the request. */
	authorize(request: ServiceRequest): Promise<AuthorizationReceipt>;

	/** Present ONLY the authorized attributes from `attributes`, per the receipt's scope.
	 * Throws / rejects if the receipt is not usable (revoked/expired). */
	present(receipt: AuthorizationReceipt, attributes: AttributeSet): Promise<SelectivePresentation>;

	/** Verify a receipt (signature/expiry/status), and — when `presentation` is given —
	 * that the presentation discloses only in-scope attributes. */
	verify(
		receipt: AuthorizationReceipt,
		presentation?: SelectivePresentation,
	): Promise<AuthorizationVerificationResult>;

	/** Revoke a receipt: return the revocation event and the receipt in revoked status. */
	revoke(receipt: AuthorizationReceipt, reason?: string): Promise<{
		event: RevocationEvent;
		receipt: AuthorizationReceipt;
	}>;
}

export interface AuthorizationConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
