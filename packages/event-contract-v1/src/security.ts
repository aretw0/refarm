/**
 * THE security event vocabulary — this bus's first consumer.
 *
 * `EventBus` has had `emit`, `on`, `once` and a conformance suite since it was written, and
 * has had nothing to carry. It is a transport without a vocabulary: channels are free-form
 * strings and payloads are `unknown`, so every consumer that wanted to route on a daemon event
 * ended up switching on raw string literals with `as` casts (see
 * `examples/devbench-t1/src/live-telemetry.ts`, which does exactly that for `agent:*`).
 *
 * This module is the other half. It names the facts the gate learns, types their payload, and
 * gives a plugin one function to subscribe with.
 *
 * # The facts, and why they had to be named
 *
 * The gate (`packages/tractor/src/sidecar/auth.rs`) conflated two things that need opposite
 * responses:
 *
 *   - **authentication failed** — the credential does not verify. Somebody is guessing.
 *   - **authorization refused** — the credential verifies; the scope is wrong. A caller this
 *     node issued a credential to has a bug.
 *
 * They shared a rate-limit budget, so a legitimate app with a scope bug was punished as an
 * attacker. They no longer share one — and the distinction reaches consumers HERE, because it
 * deliberately never reaches the HTTP response.
 *
 * # Why you cannot get this from a status code
 *
 * You cannot, and that is on purpose. Every refusal answers `401
 * {"error":"unauthorized","reason":"invalid"}` — identical bytes for all three — because a
 * distinct status for "valid credential, wrong scope" would tell whoever presented a guessed
 * token that the token EXISTS. Identical outward, distinguished inward: the wire says nothing,
 * these events say everything.
 *
 * # One vocabulary, two runtimes
 *
 * Every name below is mirrored, string for string, in
 * `packages/tractor/src/security_events.rs`. The two lists are held together by
 * `security-events.fixture.ndjson` in this package's root: one wire line per fact, asserted by
 * the Rust that writes them and by the TypeScript that parses them. A name changed on one side
 * alone fails on both.
 */

import type { EventBus, EventHandler, Unsubscribe } from "./types.js";

/** The namespace every security event carries. Route the whole family on this. */
export const SECURITY_EVENT_PREFIX = "auth:" as const;

/** A credential verified and the route's authority was satisfied. */
export const AUTH_ACCEPTED = "auth:accepted" as const;

/**
 * The credential does not verify — nothing this node holds matches the token presented.
 * THE attack signal, and the only fact that spends the credential-guessing budget.
 */
export const AUTH_AUTHENTICATION_FAILED = "auth:authentication-failed" as const;

/**
 * The credential verifies and does not hold the authority the route requires. A caller bug,
 * not an attack — this node issued this credential and still honours it. Act on this by
 * fixing the caller, never by treating the holder as hostile.
 */
export const AUTH_AUTHORIZATION_REFUSED = "auth:authorization-refused" as const;

/** The credential verifies and its deadline has passed. The remedy is "issue another". */
export const AUTH_CREDENTIAL_EXPIRED = "auth:credential-expired" as const;

/**
 * A budget reached its bound. Read {@link SecurityEventLine.budget}: `authentication` means
 * this node is being ground by somebody guessing; `authorization` means one known caller is
 * asking for authority it does not have. Opposite meanings, opposite responses.
 */
export const AUTH_RATE_LIMIT_ENGAGED = "auth:rate-limit-engaged" as const;

/** Every name in the vocabulary. Enumerate this rather than transcribing the strings. */
export const SECURITY_EVENT_NAMES = [
	AUTH_ACCEPTED,
	AUTH_AUTHENTICATION_FAILED,
	AUTH_AUTHORIZATION_REFUSED,
	AUTH_CREDENTIAL_EXPIRED,
	AUTH_RATE_LIMIT_ENGAGED,
] as const;

export type SecurityEventName = (typeof SECURITY_EVENT_NAMES)[number];

/**
 * The channel the whole family is published on, for a consumer that wants every security
 * event without subscribing five times. `EventBus` has no wildcards, so
 * {@link publishSecurityEvent} emits on both this channel and the event's own name — a
 * subscriber picks whichever granularity it needs.
 */
export const SECURITY_EVENT_CHANNEL = "auth" as const;

/** Which bound a refusal spent. `"-"` when the fact moved no budget. */
export type SecurityBudget = "authentication" | "authorization" | "-";

/**
 * The absent value, as the wire renders it. Every line carries every key — a refusal that
 * resolved no identity says `"-"` rather than omitting the field, so a consumer never has to
 * know which fields a given fact happens to carry.
 */
export const ABSENT = "-" as const;

/**
 * One security event, exactly as it appears on the wire — a line of
 * `<refarm-dir>/scarecrow-audit.ndjson`, which is the trail the daemon already writes,
 * already rotates (8 MiB × 16 segments) and already prunes.
 *
 * Note what is NOT here, in any form: the token, its digest, a truncated digest, the rate
 * limiter's tag. The Rust that renders these lines is not given them, so no rendering of it
 * can contain one.
 *
 * `scope` is the authority the ROUTE required, not an enumeration of what the credential
 * holds — the question is "what was done with this", not "what else could this have done".
 */
export interface SecurityEventLine {
	/** Epoch milliseconds. */
	readonly ts: number;
	/** The fact. The discriminant. */
	readonly event: SecurityEventName;
	/** The same statement without the namespace. */
	readonly outcome: string;
	/** Which bound this fact moved. */
	readonly budget: SecurityBudget;
	/** The identity the gate RESOLVED, or `"-"`. Never one a caller claimed. */
	readonly identity: string;
	/** `"device"`, `"scoped"`, or `"-"` when no credential was recognised. */
	readonly credential: string;
	/** The scope the route required, or `"-"` when it declared none. */
	readonly scope: string;
	/** The HTTP method of the request. */
	readonly method: string;
}

const NAMES = new Set<string>(SECURITY_EVENT_NAMES);

function isName(value: unknown): value is SecurityEventName {
	return typeof value === "string" && NAMES.has(value);
}

function isBudget(value: unknown): value is SecurityBudget {
	return value === "authentication" || value === "authorization" || value === ABSENT;
}

/**
 * Parse one NDJSON line into a typed event, or `null` when it is not one.
 *
 * Structural, not optimistic: an unknown `event` name, a missing field, a `budget` outside the
 * three legal values — all `null`. The trail is a shared file carrying `agent:*` and
 * `host-effect:*` lines too, so "this is not one of mine" is the ordinary case and must not
 * throw.
 */
export function parseSecurityEventLine(raw: string): SecurityEventLine | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const line = value as Record<string, unknown>;
	if (!isName(line.event)) return null;
	if (typeof line.ts !== "number" || !Number.isFinite(line.ts)) return null;
	if (typeof line.outcome !== "string") return null;
	if (!isBudget(line.budget)) return null;
	if (typeof line.identity !== "string") return null;
	if (typeof line.credential !== "string") return null;
	if (typeof line.scope !== "string") return null;
	if (typeof line.method !== "string") return null;
	return {
		ts: line.ts,
		event: line.event,
		outcome: line.outcome,
		budget: line.budget,
		identity: line.identity,
		credential: line.credential,
		scope: line.scope,
		method: line.method,
	};
}

/**
 * Publish one event onto a bus, on BOTH its own channel and the family channel.
 *
 * Two emissions rather than one because `EventBus.on` keys on an exact string and has no
 * wildcard: a plugin that cares only about expiries subscribes to
 * {@link AUTH_CREDENTIAL_EXPIRED}, and a security dashboard that wants everything subscribes
 * to {@link SECURITY_EVENT_CHANNEL}, and neither pays for the other.
 */
export function publishSecurityEvent(bus: EventBus, event: SecurityEventLine): void {
	bus.emit(event.event, event);
	bus.emit(SECURITY_EVENT_CHANNEL, event);
}

/**
 * Feed a chunk of NDJSON — a tail of the audit trail, an SSE frame batch, a whole file — onto
 * a bus as typed events. Lines that are not security events (the `agent:*` and `host-effect:*`
 * ones sharing the file) are skipped, not thrown on.
 *
 * Returns how many were published, so a caller can tell "nothing happened" from "nothing
 * parsed".
 */
export function publishSecurityEventLines(bus: EventBus, ndjson: string): number {
	let published = 0;
	for (const raw of ndjson.split("\n")) {
		if (raw.trim() === "") continue;
		const event = parseSecurityEventLine(raw);
		if (event === null) continue;
		publishSecurityEvent(bus, event);
		published += 1;
	}
	return published;
}

/**
 * Subscribe to one fact, typed. The whole DX point: a plugin writes
 *
 * ```ts
 * onSecurityEvent(bus, AUTH_AUTHORIZATION_REFUSED, (event) => {
 *   warnTheTeamThat(event.identity, "has a scope bug");
 * });
 * ```
 *
 * and never parses a status code, greps a log line, or casts an `unknown`.
 */
export function onSecurityEvent(
	bus: EventBus,
	event: SecurityEventName,
	handler: EventHandler<SecurityEventLine>,
): Unsubscribe {
	return bus.on(event, (data) => handler(data as SecurityEventLine));
}

/**
 * Subscribe to EVERY security event, typed — the dashboard's subscription.
 */
export function onAnySecurityEvent(
	bus: EventBus,
	handler: EventHandler<SecurityEventLine>,
): Unsubscribe {
	return bus.on(SECURITY_EVENT_CHANNEL, (data) => handler(data as SecurityEventLine));
}

/**
 * What a consumer should DO about a fact — the judgement the vocabulary exists to make
 * possible, stated once so every consumer does not restate it (differently).
 *
 * This is the "tell attack from scope bug from expiry" question, answered as a total function
 * over the vocabulary rather than as an `if` chain in each plugin.
 */
export type SecurityResponse =
	/** Somebody is guessing credentials, or the node is being ground. Treat as hostile. */
	| "hostile"
	/** A caller this node knows has a bug. Fix the caller; do not treat it as hostile. */
	| "caller-bug"
	/** A credential reached the end of its life. Re-issue. */
	| "expired"
	/** Nothing to do. */
	| "none";

export function securityResponseFor(event: SecurityEventLine): SecurityResponse {
	switch (event.event) {
		case AUTH_ACCEPTED:
			return "none";
		case AUTH_AUTHENTICATION_FAILED:
			return "hostile";
		case AUTH_AUTHORIZATION_REFUSED:
			return "caller-bug";
		case AUTH_CREDENTIAL_EXPIRED:
			return "expired";
		case AUTH_RATE_LIMIT_ENGAGED:
			// THE case that cannot be decided from the name alone, and the reason `budget` is
			// carried as its own field. The authentication bound engaging means guessing has
			// been throttled; the authorization bound engaging means one known caller is
			// asking loudly for the wrong thing. Reading only the event name here would call
			// a misconfigured app an attacker — the exact mistake being fixed.
			return event.budget === "authorization" ? "caller-bug" : "hostile";
	}
}
