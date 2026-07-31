/**
 * The pending exchange, its bounds, and the record a failure leaves behind.
 *
 * ── BOUNDS (E2/E5) ────────────────────────────────────────────────────────────────
 *
 * The start endpoint is reachable by a party with NO credential — that is the point,
 * and it is admissible only under E2's conditions: its sole effect is a pending request
 * that grants nothing, it is bounded, nothing is readable back before confirmation, and
 * a refusal says why. All four are enforced here rather than left to the host, because
 * "left to each adapter" is E5's stated way of being forgotten once per adapter.
 *
 * ── THE STORE IS AN INTERFACE, AND THAT IS NOT ABSTRACTION FOR ITS OWN SAKE ───────
 *
 * The exchange is STARTED in one process (`refarm web serve`) and CONFIRMED in another
 * (the CLI, which is the surface that holds authority — S4). They are not the same
 * process and cannot share memory, so the real store is filesystem-backed, next to the
 * auth policy the CLI already writes and the daemon already re-reads. An in-memory
 * implementation lives here for tests and for a host that runs both halves.
 *
 * Everything is async because the real one does I/O.
 */

import type { SealedSasPayload } from "./exchange.js";
import { SAS_WIRE } from "./exchange.js";

/** How many exchanges may be waiting for the operator at once. A start beyond this is
 *  REFUSED, loudly — not queued. One operator confirms one comparison at a time; more
 *  than a handful pending means something is wrong, and a wrong thing should say so. */
export const SAS_MAX_PENDING = 4;

/** Starts allowed per window, across all callers. Deliberately global rather than
 *  per-IP: this surface sits behind a listener whose whole reachability question is
 *  already answered by the surface declaration, and a per-IP bucket would be trivially
 *  defeated while giving the comforting appearance of a limit. */
export const SAS_START_LIMIT = 5;
export const SAS_START_WINDOW_MS = 60_000;

/** How long an unconfirmed exchange lives. Long enough to walk to the terminal; short
 *  enough that a screen left open does not stay approvable. */
export const SAS_EXCHANGE_TTL_MS = 5 * 60_000;

/** Stated, not implied — honest polling means a declared interval and a backoff (E5). */
export const SAS_POLL_INTERVAL_MS = 2_000;
export const SAS_POLL_MAX_INTERVAL_MS = 20_000;

export type SasExchangeState = "pending" | "granted" | "aborted";

/**
 * Why an exchange ended without a credential.
 *
 * `mismatch` is the one this whole mechanism exists to produce (S5) and it is never a
 * retry: the exchange is dead, the record is written, and the party must start again
 * from nothing. Treating a mismatch as transient discards exactly the information that
 * was worth having.
 */
export type SasAbortReason = "mismatch" | "expired" | "cancelled";

/** One exchange. `confirmerPrivateKeyJwk` is the only sensitive field and it exists
 *  ONLY while the exchange is pending — settling clears it. */
export interface SasExchange {
	readonly wire: typeof SAS_WIRE;
	readonly id: string;
	readonly state: SasExchangeState;
	/** The starting side's public key (the browser). */
	readonly initiatorPublicKey: string;
	/** This node's ephemeral public key for this exchange. */
	readonly confirmerPublicKey: string;
	/** This node's ephemeral PRIVATE key, so the confirming process can derive the row
	 *  independently rather than trusting a row computed elsewhere. Null once settled. */
	readonly confirmerPrivateKeyJwk: JsonWebKey | null;
	/** Which surface asked. */
	readonly surface: string;
	/** What it asked for. */
	readonly scope: readonly string[];
	/** How long the credential would live, if granted. */
	readonly lifetimeMs: number;
	/** What the caller called ITSELF (E5: a client identifies itself, so the other side
	 *  can attribute and throttle it). Untrusted, shown as a claim, never as a fact. */
	readonly client: string;
	readonly createdAt: number;
	/** When the EXCHANGE stops being confirmable — not the credential's lifetime. */
	readonly expiresAt: number;
	readonly settledAt: number | null;
	/** Present only on `granted`, and read exactly once. */
	readonly sealed: SealedSasPayload | null;
	/** The scoped credential this exchange minted, for the audit record. */
	readonly credentialId: string | null;
	readonly abortReason: SasAbortReason | null;
}

/** What an outcome leaves behind (S5). Carries no key, no token, no secret. */
export interface SasVerificationRecord {
	readonly wire: typeof SAS_WIRE;
	readonly at: number;
	readonly id: string;
	readonly outcome: "granted" | "aborted";
	readonly reason: SasAbortReason | null;
	readonly surface: string;
	readonly scope: readonly string[];
	/** The caller's own claim about itself, recorded as such. */
	readonly client: string;
	/** PUBLIC key of the party that started — public by construction, and the only
	 *  thing that distinguishes one grinding party from many honest ones. */
	readonly initiatorPublicKey: string;
	readonly credentialId: string | null;
}

/** How an exchange settles. */
export interface SasSettlement {
	readonly state: "granted" | "aborted";
	readonly at: number;
	readonly sealed?: SealedSasPayload | null;
	readonly credentialId?: string | null;
	readonly abortReason?: SasAbortReason | null;
}

export interface SasExchangeStore {
	/** Persist a NEW exchange. Throws if the id is taken. */
	create(exchange: SasExchange): Promise<void>;
	get(id: string): Promise<SasExchange | null>;
	/** Every exchange still on disk/in memory, oldest first. */
	list(): Promise<SasExchange[]>;
	/**
	 * Settle exactly once. Returns the settled exchange, or `null` when something else
	 * already settled it — a race between the operator confirming and the deadline
	 * passing must produce ONE outcome, and the loser must be able to tell.
	 */
	settle(id: string, settlement: SasSettlement): Promise<SasExchange | null>;
	/** Forget an exchange entirely (after its outcome has been delivered). */
	remove(id: string): Promise<void>;
	/** Append to the durable record. */
	record(entry: SasVerificationRecord): Promise<void>;
	/** Read the record back, newest last. Bounded by the caller's `limit`. */
	records(limit?: number): Promise<SasVerificationRecord[]>;
}

/** Build the record for an outcome. PURE, and the ONE place the mapping lives, so the
 *  CLI and the HTTP surface cannot record the same event two different ways. */
export function toVerificationRecord(exchange: SasExchange, at: number): SasVerificationRecord {
	return {
		wire: SAS_WIRE,
		at,
		id: exchange.id,
		outcome: exchange.state === "granted" ? "granted" : "aborted",
		reason: exchange.abortReason,
		surface: exchange.surface,
		scope: exchange.scope,
		client: exchange.client,
		initiatorPublicKey: exchange.initiatorPublicKey,
		credentialId: exchange.credentialId,
	};
}

/**
 * A fixed-window counter. Not a token bucket: the refusal must be able to say WHEN the
 * caller may try again (E5 — "refusal that says why, since a silent drop teaches a
 * caller to retry harder"), and a window has an obvious answer to that question.
 */
export interface SasRateLimiter {
	/** Consume one slot. Returns `null` when allowed, or the ms until the window rolls. */
	take(now: number): number | null;
}

export function createSasRateLimiter(
	options: { limit?: number; windowMs?: number } = {},
): SasRateLimiter {
	const limit = options.limit ?? SAS_START_LIMIT;
	const windowMs = options.windowMs ?? SAS_START_WINDOW_MS;
	let windowStart = 0;
	let used = 0;
	return {
		take(now: number): number | null {
			if (now - windowStart >= windowMs) {
				windowStart = now;
				used = 0;
			}
			if (used >= limit) return Math.max(1, windowStart + windowMs - now);
			used += 1;
			return null;
		},
	};
}

/** The in-memory store — for a host that runs both halves, and for tests. */
export function createInMemorySasExchangeStore(
	options: { recordCapacity?: number } = {},
): SasExchangeStore {
	const capacity = options.recordCapacity ?? 128;
	const exchanges = new Map<string, SasExchange>();
	const log: SasVerificationRecord[] = [];
	return {
		async create(exchange) {
			if (exchanges.has(exchange.id)) {
				throw new Error(`emoji-sas: exchange "${exchange.id}" already exists`);
			}
			exchanges.set(exchange.id, exchange);
		},
		async get(id) {
			return exchanges.get(id) ?? null;
		},
		async list() {
			return [...exchanges.values()].sort((a, b) => a.createdAt - b.createdAt);
		},
		async settle(id, settlement) {
			const existing = exchanges.get(id);
			// THE first-settlement-wins rule. Synchronous between the read and the write,
			// so on a single-threaded runtime this is a compare-and-set.
			if (!existing || existing.state !== "pending") return null;
			const settled: SasExchange = {
				...existing,
				state: settlement.state,
				settledAt: settlement.at,
				// The private key does not survive a settlement, in either direction.
				confirmerPrivateKeyJwk: null,
				sealed: settlement.sealed ?? null,
				credentialId: settlement.credentialId ?? null,
				abortReason: settlement.abortReason ?? null,
			};
			exchanges.set(id, settled);
			return settled;
		},
		async remove(id) {
			exchanges.delete(id);
		},
		async record(entry) {
			log.push(entry);
			while (log.length > capacity) log.shift();
		},
		async records(limit) {
			return limit === undefined ? [...log] : log.slice(-limit);
		},
	};
}
