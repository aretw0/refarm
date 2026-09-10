/**
 * MODEL-ACCOUNT IDENTITY — the contract that lets one provider hold many credentials.
 *
 * The governing design is `docs/superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md`.
 * Its D1 separates three identities this repository used to collapse into one: a PROVIDER is a
 * protocol and billing product, a MODEL ACCOUNT is one credential-bearing identity on this node,
 * and a WORKSPACE BINDING says which account a workspace's work spends.
 *
 * Measured 2026-08-12, against a real silo: `oauthCredentials` is keyed by provider and holds one
 * slot, so a second GitHub Copilot login destroyed the first with no warning. The operator holds
 * three quotas across two providers; two of them are the same provider.
 *
 * NOTHING HERE MAY BRANCH ON AN ALIAS. `blue`, `personal` and `client-x` have exactly the same
 * contract meaning: none. Refarm does not prescribe an account taxonomy (D1).
 */
import { createHash } from "node:crypto";

export const MODEL_ACCOUNT_CAPABILITY = "model-account:v1" as const;

/** Crockford base32, so an id is copyable by voice and cannot be mistaken for hex. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A node-local, stable, semantically opaque credential id.
 *
 * DERIVED FROM A SEED RATHER THAN FROM RANDOMNESS so the same login produces the same id on a
 * re-run, and DIGESTED so the seed — which may be a provider subject — never travels inside it.
 * The id appears in logs, status and budget exports, where the design permits the id and nothing
 * else about the account.
 */
export function newCredentialId(seed: string): string {
	const digest = createHash("sha256").update(seed).digest();
	let out = "";
	for (let i = 0; i < 26; i += 1) out += CROCKFORD[digest[i]! % 32];
	return `model-account:${out}`;
}

/** Whether a catalog entry may be routed to, and when not, why not. */
export type ModelAccountHealth =
	| "healthy"
	/** A descriptor whose secret is missing. Never silently deleted, never eligible (D2). */
	| "incomplete"
	/** A secret with no descriptor. Redacted, requires repair or removal (D2). */
	| "unclaimed";

export interface ModelAccountIdentity {
	/** `verified` only when the provider confirmed it. A migrated legacy credential is `unverified`. */
	readonly status: "verified" | "unverified";
	/** The provider's immutable identifier when one exists — never a display login. */
	readonly subject?: string;
	readonly host?: string;
}

export interface ModelAccountDescriptor {
	readonly credentialId: string;
	readonly provider: string;
	/** Operator-chosen, renameable, unique per provider on this node, and MEANINGLESS to code. */
	readonly alias: string;
	readonly identity: ModelAccountIdentity;
	/** Where the secret lives in Silo — a reference, never the secret. */
	readonly secretRef: string;
	readonly health: ModelAccountHealth;
	/** Changes when metadata or the secret changes, so a snapshot can pin what it selected. */
	readonly revision: string;
}

/** The node's workspace registry owns this and persists the OPAQUE ID, never the alias (D2). */
export interface ModelAccountBinding {
	readonly workspaceId: string;
	readonly credentialId: string;
}

/** What the resolver returns when it can select. Immutable, and the only thing a surface reads. */
export interface DispatchSnapshot {
	readonly workspaceId: string | null;
	readonly provider: string;
	readonly credentialId: string;
	readonly credentialAlias: string;
	readonly credentialRevision: string;
	readonly source: "dispatch-override" | "workspace-binding" | "node-default" | "env";
}

export const REFUSAL_CODES = {
	ambiguous: "model_credential_ambiguous",
	none: "model_credential_none",
	incomplete: "model_credential_incomplete",
	unclaimed: "model_credential_unclaimed",
} as const;

export type RefusalCode = (typeof REFUSAL_CODES)[keyof typeof REFUSAL_CODES];

export interface ModelAccountRefusal {
	readonly code: RefusalCode;
	readonly message: string;
	/** SAFE candidates — aliases and ids only, so a refusal can be printed anywhere. */
	readonly candidates: readonly { readonly credentialId: string; readonly alias: string }[];
}
