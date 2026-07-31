/**
 * S3 — what comes back is a SCOPED credential, not the device token.
 *
 * ── WHERE IT LIVES, AND WHY THAT IS THE WHOLE DESIGN ──────────────────────────────
 *
 * The obvious implementation is to append to `auth-policy.json`'s `credentials` array
 * with a couple of extra fields (`scope`, `expiresAt`) alongside `identity` and
 * `tokenSha256`. That implementation is WRONG, and quietly so.
 *
 * `packages/tractor/src/sidecar/auth.rs` deserializes `credentials[]` into
 * `{ identity, tokenSha256 }` and ignores every other field — serde has no
 * `deny_unknown_fields` there, by design ("Unknown fields … are ignored so the file
 * format is stable across slices"). Its `authenticate()` matches a token hash and
 * returns an identity. There is no scope check and no clock. So a "scoped, expiring"
 * entry in `credentials[]` would be honoured by the Rust gate as a FULL device
 * credential, for every sidecar route, FOREVER. The browser would hold the device
 * token with extra steps — which is exactly the `localStorage` exposure the operator
 * rejected, wearing a new hat.
 *
 * So scoped credentials live under their OWN top-level key, `scopedCredentials`, which
 * the Rust `PolicyFile` does not deserialize at all. The consequence is the guarantee:
 * **the Rust gate can never authenticate a scoped credential**, because it never sees
 * one. "It is not a device credential" stops being a promise in a comment and becomes a
 * property of the parser on the other side.
 *
 * What CAN honour it is a TypeScript surface that knows about scope and expiry —
 * `authenticateScopedToken` below is the whole of that check, and it is the only door.
 *
 * ── WHY NOT A SECOND FILE ─────────────────────────────────────────────────────────
 *
 * Same file, because S3 asks for `refarm auth list` and `refarm auth revoke` to already
 * understand it — "a browser session must appear there as its own entry rather than
 * hiding behind the device that opened it". One file means one read, one write, one
 * 0600, and no way for the two to drift apart. `auth.ts` already carries unknown
 * top-level keys through verbatim (`{ ...policy, credentials: next }`), so this key
 * survives an enrol and a revoke without either learning it exists.
 *
 * PURE — every function here is a pure transformation over a parsed policy object.
 */

/** Wire discriminator for a scoped credential entry. */
export const SCOPED_CREDENTIAL_WIRE = "scoped-credential.v1" as const;

/** The one scope this slice issues: answer operator prompts, and nothing else. */
export const SCOPE_ANSWER_PROMPTS = "prompt:answer" as const;

/** Scopes a caller may legally ask for. A request naming anything else is refused
 *  rather than narrowed — a surface asking for authority we do not grant has
 *  misunderstood something, and silently downgrading it hides that. */
export const KNOWN_SCOPES: readonly string[] = [SCOPE_ANSWER_PROMPTS];

/** The default lifetime of a browser session's credential: one hour. A browser session
 *  is not a device enrolment, and S3 asks for that difference to be VISIBLE in the
 *  lifetime rather than asserted in prose. */
export const DEFAULT_SCOPED_LIFETIME_MS = 60 * 60 * 1000;

/** The ceiling. A caller may ask for less; nothing may ask for more. */
export const MAX_SCOPED_LIFETIME_MS = 12 * 60 * 60 * 1000;

/**
 * One scoped credential, as it sits in the policy file.
 *
 * `id` rather than `identity` alone as the handle: two browser sessions on the same
 * machine would carry indistinguishable labels, and S3 requires each to be revocable on
 * its own. The id is what `refarm auth revoke` names.
 */
export interface ScopedCredential {
	readonly wire: typeof SCOPED_CREDENTIAL_WIRE;
	/** Stable, unique, and what `auth revoke` takes. */
	readonly id: string;
	/** What a human reads in `auth list`. Never unique on its own. */
	readonly identity: string;
	/** SHA-256 (lowercase hex) of the bearer token. The raw token is never stored,
	 *  exactly as for a device credential. */
	readonly tokenSha256: string;
	/** What this credential may do. Never empty. */
	readonly scope: readonly string[];
	/** Which surface it was issued for — `web`, today. */
	readonly surface: string;
	/** How it was issued, so an audit can tell an SAS grant from anything later. */
	readonly issuedVia: string;
	/** Epoch ms. */
	readonly issuedAt: number;
	/** Epoch ms. Never null: a scoped credential that never expires is a device
	 *  credential with a different field name. */
	readonly expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Validate one entry off disk. Returns null rather than throwing: a single malformed
 *  entry must not make `auth list` unable to show the others. */
export function parseScopedCredential(value: unknown): ScopedCredential | null {
	if (!isRecord(value)) return null;
	if (value.wire !== SCOPED_CREDENTIAL_WIRE) return null;
	const id = asString(value.id);
	const identity = asString(value.identity);
	const tokenSha256 = asString(value.tokenSha256);
	const surface = asString(value.surface);
	const issuedVia = asString(value.issuedVia);
	const issuedAt = asFiniteNumber(value.issuedAt);
	const expiresAt = asFiniteNumber(value.expiresAt);
	if (!id || !identity || !tokenSha256 || !surface || !issuedVia) return null;
	if (issuedAt === null || expiresAt === null) return null;
	if (!Array.isArray(value.scope)) return null;
	const scope = value.scope.filter((entry): entry is string => typeof entry === "string" && entry !== "");
	if (scope.length === 0) return null;
	return {
		wire: SCOPED_CREDENTIAL_WIRE,
		id,
		identity,
		tokenSha256,
		scope,
		surface,
		issuedVia,
		issuedAt,
		expiresAt,
	};
}

/** Every scoped credential in a parsed policy, dropping entries that do not parse. */
export function readScopedCredentials(policy: Record<string, unknown>): ScopedCredential[] {
	const raw = policy.scopedCredentials;
	if (!Array.isArray(raw)) return [];
	const parsed: ScopedCredential[] = [];
	for (const entry of raw) {
		const credential = parseScopedCredential(entry);
		if (credential) parsed.push(credential);
	}
	return parsed;
}

/**
 * Add a scoped credential. PURE — returns a new policy, never mutates, and carries
 * every other key (`credentials`, and anything a later slice adds) through verbatim.
 */
export function addScopedCredential<T extends Record<string, unknown>>(
	policy: T,
	credential: ScopedCredential,
): T {
	const existing = Array.isArray(policy.scopedCredentials) ? policy.scopedCredentials : [];
	if (readScopedCredentials(policy).some((entry) => entry.id === credential.id)) {
		throw new Error(`scoped credential "${credential.id}" already exists`);
	}
	return { ...policy, scopedCredentials: [...existing, credential] };
}

/**
 * Remove ONE scoped credential, named by its id or (unambiguously) by its identity.
 * PURE. Throws when nothing matches, and when an identity matches more than one — an
 * ambiguous revoke that picked "the first" would cut off a session the operator did not
 * name and leave the one they meant running.
 */
export function removeScopedCredential<T extends Record<string, unknown>>(
	policy: T,
	handle: string,
): { policy: T; removed: ScopedCredential } {
	const credentials = readScopedCredentials(policy);
	const byId = credentials.find((entry) => entry.id === handle);
	const matches = byId ? [byId] : credentials.filter((entry) => entry.identity === handle);
	if (matches.length === 0) {
		throw new Error(`no scoped credential "${handle}" — nothing to revoke`);
	}
	if (matches.length > 1) {
		throw new Error(
			`"${handle}" names ${matches.length} scoped credentials — revoke one by its id: ` +
				matches.map((entry) => entry.id).join(", "),
		);
	}
	const removed = matches[0]!;
	return {
		policy: {
			...policy,
			scopedCredentials: credentials.filter((entry) => entry.id !== removed.id),
		},
		removed,
	};
}

/** Drop every credential whose deadline has passed. PURE. Returns the survivors and the
 *  ones dropped, so a caller can SAY what it swept rather than doing it silently. */
export function pruneExpiredScopedCredentials<T extends Record<string, unknown>>(
	policy: T,
	now: number,
): { policy: T; expired: ScopedCredential[] } {
	const credentials = readScopedCredentials(policy);
	const expired = credentials.filter((entry) => entry.expiresAt <= now);
	if (expired.length === 0) return { policy, expired: [] };
	const ids = new Set(expired.map((entry) => entry.id));
	return {
		policy: { ...policy, scopedCredentials: credentials.filter((entry) => !ids.has(entry.id)) },
		expired,
	};
}

/** Has this credential's deadline passed? */
export function isScopedCredentialExpired(credential: ScopedCredential, now: number): boolean {
	return credential.expiresAt <= now;
}

/**
 * THE gate for a scoped credential — the only place one is ever honoured.
 *
 * Three conditions, all of them, every time: the hash matches, the scope is held, and
 * the deadline has not passed. `null` for any failure; deliberately no reason is
 * returned to the CALLER (a gate that explains which of the three failed is a gate that
 * helps someone enumerate). A host that wants to log a reason has the credential list.
 *
 * Takes the token's DIGEST rather than the token, so a raw bearer never enters this
 * module and can never end up in one of its error strings.
 */
export function authenticateScopedToken(
	policy: Record<string, unknown>,
	tokenSha256: string,
	requiredScope: string,
	now: number,
): ScopedCredential | null {
	const digest = tokenSha256.trim().toLowerCase();
	if (!digest) return null;
	for (const credential of readScopedCredentials(policy)) {
		if (credential.tokenSha256.trim().toLowerCase() !== digest) continue;
		if (!credential.scope.includes(requiredScope)) return null;
		if (isScopedCredentialExpired(credential, now)) return null;
		return credential;
	}
	return null;
}

/** Clamp a requested lifetime into what this node will issue. A caller asking for more
 *  than the ceiling gets the ceiling, not a refusal: the request is a preference, and
 *  the node's maximum is the answer to it. */
export function clampScopedLifetime(requestedMs: number | undefined): number {
	if (requestedMs === undefined || !Number.isFinite(requestedMs) || requestedMs <= 0) {
		return DEFAULT_SCOPED_LIFETIME_MS;
	}
	return Math.min(Math.floor(requestedMs), MAX_SCOPED_LIFETIME_MS);
}

/** Are all requested scopes ones this node knows how to issue? Returns the offending
 *  scope, or null. */
export function unknownScope(scope: readonly string[]): string | null {
	for (const entry of scope) {
		if (!KNOWN_SCOPES.includes(entry)) return entry;
	}
	return null;
}

/** What the confirming surface must SHOW before it asks (S4) — one line per fact,
 *  never just the emoji. Kept here, beside the credential it describes, so a second
 *  confirming surface cannot invent its own vocabulary for the same grant. */
export function describeScopeForOperator(scope: readonly string[]): string[] {
	return scope.map((entry) =>
		entry === SCOPE_ANSWER_PROMPTS
			? `${entry} — may answer operator prompts, and nothing else`
			: entry,
	);
}
