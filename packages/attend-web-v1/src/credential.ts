/**
 * Holding the scoped credential in the browser — which is now a defensible thing to do,
 * and only because of what the credential IS.
 *
 * `/auth/verify` deliberately keeps its token in memory and says so, because that page
 * exists to demonstrate the exchange. This page has to survive a phone locking its screen
 * and a tab being restored, so it stores it. The reason that is acceptable is E3's whole
 * point (S3 of the emoji-SAS design): what is stored is not the device token. It may
 * answer prompts and nothing else, it dies on a deadline the node chose, and
 * `refarm auth revoke` cuts it off by its own id. Storing the DEVICE token — the thing
 * the operator refused — would have none of those three properties.
 *
 * Three rules this module keeps, and they are what make the storage honest rather than
 * merely convenient:
 *
 *   1. **`expiresAt` is stored beside the token and shown in the UI.** A credential whose
 *      lifetime the operator cannot see is a credential they cannot reason about.
 *   2. **An expired entry is never returned.** `loadAttendCredential` deletes it and
 *      answers `null`, so the page runs the handshake instead of sending a token the gate
 *      will refuse. Expiry is judged here AND at the gate; this side is a courtesy, the
 *      gate is the rule.
 *   3. **Nothing here logs, formats or returns the token as part of a message.** It comes
 *      back only inside the record, for the one caller that sets an `Authorization`
 *      header with it.
 *
 * The storage is INJECTED (`localStorage` in the page, a plain object in tests), so every
 * rule above is testable without a browser.
 */

/** Where the record lives. Namespaced, so a hub sharing this origin cannot collide. */
export const ATTEND_CREDENTIAL_KEY = "refarm.attend.credential.v1";

/** The scope this surface asks for and the gate declares on both prompt routes. */
export const ATTEND_SCOPE = "prompt:answer";

/**
 * How long the page asks the node to make it good for.
 *
 * Deliberately shorter than the node's own one-hour default: the shorter a stored bearer
 * lives, the smaller the window in which a stolen copy is worth anything, and re-running
 * the handshake costs the operator seven emoji. The node CLAMPS this — a page cannot ask
 * for more than the ceiling — so the value here is a preference, never an authority.
 */
export const ATTEND_LIFETIME_MS = 30 * 60 * 1000;

/** Below this much remaining, the page stops trusting the credential and re-handshakes
 *  BEFORE the operator types rather than after they submit. Losing a typed secret to an
 *  expiry that happened mid-form is the failure this margin exists to prevent. */
export const ATTEND_EXPIRY_MARGIN_MS = 30 * 1000;

export interface AttendCredential {
	/** The bearer. Never rendered, never logged, never put in a URL. */
	readonly token: string;
	/** What it may do. Stored so the page can SHOW it rather than assert it. */
	readonly scope: readonly string[];
	/** Epoch ms. Never optional — that is the difference from a device credential. */
	readonly expiresAt: number;
}

/** The narrow slice of `Storage` this needs. `localStorage` satisfies it; so does `{}`
 *  wrapped by `createMemoryAttendStorage` below. */
export interface AttendStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** An `AttendStorage` backed by a plain object — what the tests use, and what a page in a
 *  browser with storage disabled falls back to so it degrades to in-memory instead of
 *  throwing on the first write. */
export function createMemoryAttendStorage(): AttendStorage {
	const map = new Map<string, string>();
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a stored record. Returns null for anything that is not exactly the shape —
 *  a half-written entry from an older version must produce a fresh handshake, never a
 *  request with an undefined bearer. */
export function parseAttendCredential(value: unknown): AttendCredential | null {
	if (!isRecord(value)) return null;
	const token = typeof value.token === "string" ? value.token : "";
	if (token === "") return null;
	if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return null;
	const scope = Array.isArray(value.scope)
		? value.scope.filter((entry): entry is string => typeof entry === "string" && entry !== "")
		: [];
	if (scope.length === 0) return null;
	return { token, scope, expiresAt: value.expiresAt };
}

/** Milliseconds left, floored at zero. */
export function attendCredentialRemainingMs(credential: AttendCredential, now: number): number {
	return Math.max(0, credential.expiresAt - now);
}

/** Is this credential past using? True inside the margin as well as past the deadline —
 *  see `ATTEND_EXPIRY_MARGIN_MS`. */
export function attendCredentialExpired(
	credential: AttendCredential,
	now: number,
	marginMs: number = ATTEND_EXPIRY_MARGIN_MS,
): boolean {
	return attendCredentialRemainingMs(credential, now) <= marginMs;
}

/** The expiry, as a line to put on the screen. Coarse on purpose: a countdown to the
 *  second invites watching a clock instead of answering a question. */
export function describeAttendExpiry(credential: AttendCredential, now: number): string {
	const remaining = attendCredentialRemainingMs(credential, now);
	if (remaining <= 0) return "expired";
	const seconds = Math.round(remaining / 1000);
	if (seconds < 90) return `expires in ${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 90) return `expires in ${minutes} min`;
	return `expires in ${Math.round(minutes / 60)} h`;
}

/** Store it. Overwrites whatever was there — a fresh handshake supersedes, it never
 *  accumulates. Storage failures (private mode, quota) are swallowed: a page that cannot
 *  persist must still work for this session. */
export function saveAttendCredential(storage: AttendStorage, credential: AttendCredential): void {
	try {
		storage.setItem(ATTEND_CREDENTIAL_KEY, JSON.stringify(credential));
	} catch {
		/* a page that cannot persist is still a page that works */
	}
}

/** Forget it. Called on expiry and whenever the gate refuses one. */
export function clearAttendCredential(storage: AttendStorage): void {
	try {
		storage.removeItem(ATTEND_CREDENTIAL_KEY);
	} catch {
		/* nothing to do about a storage that will not forget */
	}
}

/**
 * The stored credential, or null — and null is also what an EXPIRED one produces, after
 * this has deleted it. There is deliberately no way to read back an expired credential:
 * a caller holding one would be holding a bearer whose only remaining use is to be sent
 * somewhere and refused.
 */
export function loadAttendCredential(
	storage: AttendStorage,
	now: number,
	marginMs: number = ATTEND_EXPIRY_MARGIN_MS,
): AttendCredential | null {
	let raw: string | null = null;
	try {
		raw = storage.getItem(ATTEND_CREDENTIAL_KEY);
	} catch {
		return null;
	}
	if (raw === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		clearAttendCredential(storage);
		return null;
	}
	const credential = parseAttendCredential(parsed);
	if (credential === null) {
		clearAttendCredential(storage);
		return null;
	}
	if (attendCredentialExpired(credential, now, marginMs)) {
		clearAttendCredential(storage);
		return null;
	}
	return credential;
}

/** Turn a granted SAS outcome into the record to store. `lifetimeMs` is the node's
 *  clamped answer, so the deadline this computes is the node's, not the page's wish. */
export function attendCredentialFromGrant(
	grant: { token: string; scope: readonly string[]; lifetimeMs: number },
	now: number,
): AttendCredential {
	return {
		token: grant.token,
		scope: [...grant.scope],
		expiresAt: now + Math.max(0, grant.lifetimeMs),
	};
}
