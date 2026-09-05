/**
 * The exchange as an HTTP surface, framework-free.
 *
 * Same doctrine as `prompt-contract-v1`'s `handlePendingPromptHttp`: the semantics of
 * the wire belong with the shape, not with whichever server happens to mount them. A
 * host adapts its own request/response objects to these two plain records and gets
 * identical behaviour — which is also what lets the bounds and the refusals be tested
 * without a socket.
 *
 * ── WHAT THIS SURFACE MAY DO, EXACTLY ────────────────────────────────────────────
 *
 * E2's admissible shape, and nothing beyond it:
 *
 *   - **start** — creates a pending exchange and answers with two public values (this
 *     node's ephemeral public key, and the exchange id). It grants nothing. Bounded by
 *     a pending ceiling and a rate limit, both of which refuse with a reason.
 *   - **poll** — reports `pending`, `aborted`, or `granted`. NOTHING is readable back
 *     before confirmation: while pending, the answer is the word "pending" and the
 *     interval at which the caller is welcome to ask again. A start cannot be used to
 *     probe.
 *
 * There is deliberately no listing route and no confirmation route. Confirmation
 * happens on a surface that already holds authority (S4) — the node's CLI — and a
 * confirm endpoint here would hand that authority to whoever can reach this listener,
 * which is the entire population this exchange exists to be suspicious of.
 */

import {
	exportSasPrivateKey,
	generateSasKeyPair,
	importSasPublicKey,
	newSasSessionId,
	SAS_WIRE,
} from "./exchange.js";
import {
	clampScopedLifetime,
	SCOPE_ANSWER_PROMPTS,
	unknownScope,
} from "./scoped-credential.js";
import {
	SAS_EXCHANGE_TTL_MS,
	SAS_MAX_PENDING,
	SAS_POLL_INTERVAL_MS,
	toVerificationRecord,
	type SasExchange,
	type SasExchangeStore,
	type SasRateLimiter,
} from "./store.js";

export interface SasHttpRequest {
	readonly method: string;
	/** Path only — no query string, no origin. */
	readonly path: string;
	/** Parsed JSON body, if any. */
	readonly body?: unknown;
}

export interface SasHttpResponse {
	readonly status: number;
	readonly body: Record<string, unknown>;
	/**
	 * Set on a rate-limited refusal, in seconds, as RFC 9110 spells it (the
	 * `Retry-After` field). Source: https://www.rfc-editor.org/rfc/rfc9110.html.
	 * Recorded 2026-07-31 (commit 8175ae5d) — a stable, ratified IETF spec, low
	 * rot-risk relative to a vendor price page, but undated until now.
	 */
	readonly retryAfterSeconds?: number;
}

export interface SasHttpOptions {
	readonly store: SasExchangeStore;
	readonly limiter: SasRateLimiter;
	/** Which surface this listener is. Recorded and shown to the operator. */
	readonly surface: string;
	/** The operator-facing binary, so `nextStep` names a command that can be typed. Neutral
	 *  default: a generic package never spells the brand (ADR-087, ISS-114). */
	readonly binary?: string;
	readonly now?: () => number;
	readonly maxPending?: number;
	readonly ttlMs?: number;
}

/** Where this surface is mounted. One constant, so the page, the server and the tests
 *  cannot disagree about it. */
export const SAS_HTTP_BASE = "/auth/sas";
const START_PATH = `${SAS_HTTP_BASE}/start`;
const SESSION_PATH = new RegExp(`^${SAS_HTTP_BASE}/([A-Za-z0-9_-]{8,64})$`);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A refusal that says why, and what to do about it (E5). Never quotes a key. */
function refuse(status: number, error: string, detail: string, extra: Record<string, unknown> = {}): SasHttpResponse {
	return { status, body: { wire: SAS_WIRE, ok: false, error, detail, ...extra } };
}

/**
 * Sweep exchanges whose deadline has passed, settling each as `expired` and recording
 * it. Runs before the pending ceiling is measured, so an operator who walked away does
 * not permanently consume a slot — and runs before a poll answers, so a caller is told
 * `aborted/expired` rather than being left on `pending` forever.
 */
async function sweepExpired(options: SasHttpOptions, now: number): Promise<void> {
	for (const exchange of await options.store.list()) {
		if (exchange.state !== "pending") continue;
		if (exchange.expiresAt > now) continue;
		const settled = await options.store.settle(exchange.id, {
			state: "aborted",
			at: now,
			abortReason: "expired",
		});
		if (settled) await options.store.record(toVerificationRecord(settled, now));
	}
}

async function handleStart(options: SasHttpOptions, request: SasHttpRequest, now: number): Promise<SasHttpResponse> {
	const body = isRecord(request.body) ? request.body : {};
	const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
	if (!publicKey) {
		return refuse(400, "public-key-required", "start expects a base64url raw P-256 public key as `publicKey`");
	}
	try {
		// Validated BEFORE anything is created: a malformed key must not consume a
		// pending slot, and it must not reach the transcript, where a second encoding of
		// the same point would silently produce two different rows.
		await importSasPublicKey(publicKey);
	} catch (error) {
		return refuse(400, "invalid-public-key", error instanceof Error ? error.message : String(error));
	}

	const requestedScope = Array.isArray(body.scope)
		? body.scope.filter((entry): entry is string => typeof entry === "string")
		: [SCOPE_ANSWER_PROMPTS];
	const scope = requestedScope.length > 0 ? requestedScope : [SCOPE_ANSWER_PROMPTS];
	const rejected = unknownScope(scope);
	if (rejected !== null) {
		// Refused, never narrowed: a surface asking for authority this node does not
		// issue has misunderstood something, and silently downgrading hides that.
		return refuse(400, "unknown-scope", `this node does not issue the scope ${JSON.stringify(rejected)}`, {
			scopes: [SCOPE_ANSWER_PROMPTS],
		});
	}

	// The rate limit is taken AFTER the request is known to be well-formed, so a
	// mistyped body does not burn an honest caller's budget — and before anything is
	// created, so a well-formed flood still cannot.
	const retryMs = options.limiter.take(now);
	if (retryMs !== null) {
		return {
			status: 429,
			body: {
				wire: SAS_WIRE,
				ok: false,
				error: "rate-limited",
				detail: `this node accepts a bounded number of verification starts per minute; try again in ${Math.ceil(retryMs / 1000)}s`,
				retryAfterMs: retryMs,
			},
			retryAfterSeconds: Math.ceil(retryMs / 1000),
		};
	}

	const maxPending = options.maxPending ?? SAS_MAX_PENDING;
	const pending = (await options.store.list()).filter((entry) => entry.state === "pending");
	if (pending.length >= maxPending) {
		return refuse(
			503,
			"too-many-pending",
			`${pending.length} verifications are already waiting for the operator — refusing to queue more. ` +
				"Confirm or cancel one at the node first.",
			{ maxPending },
		);
	}

	const lifetimeMs = clampScopedLifetime(
		typeof body.lifetimeMs === "number" ? body.lifetimeMs : undefined,
	);
	const ttlMs = options.ttlMs ?? SAS_EXCHANGE_TTL_MS;
	// EXTRACTABLE, and only here: this key must cross a process boundary to reach the
	// confirming CLI (S4). The browser's own keypair is generated non-extractable.
	const pair = await generateSasKeyPair({ extractable: true });
	const exchange: SasExchange = {
		wire: SAS_WIRE,
		id: newSasSessionId(),
		state: "pending",
		initiatorPublicKey: publicKey,
		confirmerPublicKey: pair.publicKey,
		confirmerPrivateKeyJwk: await exportSasPrivateKey(pair.privateKey),
		surface: options.surface,
		scope,
		lifetimeMs,
		client: typeof body.client === "string" && body.client ? body.client.slice(0, 120) : "(unnamed client)",
		createdAt: now,
		expiresAt: now + ttlMs,
		settledAt: null,
		sealed: null,
		credentialId: null,
		abortReason: null,
	};
	await options.store.create(exchange);

	return {
		status: 201,
		body: {
			wire: SAS_WIRE,
			ok: true,
			id: exchange.id,
			// Both PUBLIC values, and the only two the caller needs to derive the row it
			// will show the operator. Nothing else about the exchange is readable.
			confirmerPublicKey: exchange.confirmerPublicKey,
			scope: exchange.scope,
			lifetimeMs: exchange.lifetimeMs,
			expiresAt: exchange.expiresAt,
			pollIntervalMs: SAS_POLL_INTERVAL_MS,
			nextStep:
				`Compare the seven emoji with the ones shown by \`${options.binary ?? "the host CLI"} auth verify\` on the node, ` +
				"and confirm there. A mismatch aborts this exchange for good.",
		},
	};
}

async function handlePoll(options: SasHttpOptions, id: string): Promise<SasHttpResponse> {
	const exchange = await options.store.get(id);
	// An unknown id and a settled-and-collected id are the same answer on purpose:
	// distinguishing them would turn the poll into an oracle over which ids ever
	// existed.
	if (!exchange) return refuse(404, "unknown-exchange", "no such verification");

	if (exchange.state === "pending") {
		// NOTHING readable before confirmation. Not the emoji, not the transcript, not
		// how long the operator has been looking at it.
		return {
			status: 200,
			body: { wire: SAS_WIRE, ok: true, state: "pending", pollIntervalMs: SAS_POLL_INTERVAL_MS },
		};
	}

	if (exchange.state === "aborted") {
		// Collected and forgotten: an abort is terminal, and re-reading it forever would
		// let a party poll a dead exchange as a heartbeat.
		await options.store.remove(exchange.id);
		return {
			status: 200,
			body: {
				wire: SAS_WIRE,
				ok: false,
				state: "aborted",
				reason: exchange.abortReason,
				detail:
					exchange.abortReason === "mismatch"
						? "the emoji did not match — this verification is over. Starting again is a NEW exchange; " +
							"a mismatch is never retried."
						: exchange.abortReason === "expired"
							? "nobody confirmed before the deadline"
							: "the operator cancelled at the node",
			},
		};
	}

	// Granted — delivered EXACTLY ONCE, then forgotten. The sealed credential sitting
	// readable in a store is a credential at rest that nobody is waiting for.
	await options.store.remove(exchange.id);
	return {
		status: 200,
		body: {
			wire: SAS_WIRE,
			ok: true,
			state: "granted",
			sealed: exchange.sealed,
			scope: exchange.scope,
			lifetimeMs: exchange.lifetimeMs,
			credentialId: exchange.credentialId,
		},
	};
}

/** Serve the exchange. Returns `null` for a path this surface does not own, so a host
 *  can mount it beside its own routes without this deciding their 404s. */
export async function handleSasHttp(
	options: SasHttpOptions,
	request: SasHttpRequest,
): Promise<SasHttpResponse | null> {
	const now = (options.now ?? (() => Date.now()))();
	const method = request.method.toUpperCase();

	if (request.path === START_PATH) {
		if (method !== "POST") return refuse(405, "method-not-allowed", "start is a POST");
		await sweepExpired(options, now);
		return handleStart(options, request, now);
	}

	const match = SESSION_PATH.exec(request.path);
	if (match) {
		if (method !== "GET") return refuse(405, "method-not-allowed", "a verification is polled with GET");
		await sweepExpired(options, now);
		return handlePoll(options, match[1]!);
	}

	if (request.path === SAS_HTTP_BASE) {
		// Not listable, ever. Enumerating pending verifications is precisely the
		// "readable back before confirmation" E2 refuses.
		return refuse(404, "not-listable", "pending verifications are not enumerable");
	}

	return null;
}
