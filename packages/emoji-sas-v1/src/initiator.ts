/**
 * The STARTING side, as a function — the browser's whole half of the exchange.
 *
 * It lives in the block rather than inside a page's `<script>` so that the code the
 * browser runs to derive its row is byte-identical to the code the node runs to derive
 * its own. A page that reimplemented the transcript encoding "just for the client" is
 * how two sides come to disagree about what they are comparing, and the failure would
 * look exactly like an attack: two rows that differ, forever, for no reason.
 *
 * Nothing here is browser-specific — `fetch` and `crypto.subtle` are both present in
 * Node too — so the node and the zero-dependency kit can start an exchange with the
 * same call.
 */

import {
	deriveSasEmoji,
	generateSasKeyPair,
	openSasPayload,
	SAS_WIRE,
	type SealedSasPayload,
} from "./exchange.js";
import type { SasEmoji } from "./emoji.js";
import { SAS_HTTP_BASE } from "./http.js";
import { SAS_POLL_INTERVAL_MS, SAS_POLL_MAX_INTERVAL_MS, type SasAbortReason } from "./store.js";
import type { SasTranscript } from "./transcript.js";

export type SasFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface StartSasVerificationOptions {
	/** Origin the exchange is mounted on. Defaults to same-origin (""). */
	readonly baseUrl?: string;
	readonly fetch?: SasFetch;
	/** What this client calls ITSELF (E5). Shown to the operator as a claim. */
	readonly client?: string;
	readonly scope?: readonly string[];
	readonly lifetimeMs?: number;
}

export type SasOutcome =
	| { readonly state: "granted"; readonly token: string; readonly scope: readonly string[]; readonly lifetimeMs: number }
	| { readonly state: "aborted"; readonly reason: SasAbortReason | null; readonly detail: string };

export interface SasVerificationHandle {
	readonly id: string;
	/** The seven to show the operator, in this order. */
	readonly emoji: SasEmoji[];
	readonly transcript: SasTranscript;
	readonly pollIntervalMs: number;
	/** Poll once. `null` means "still pending — ask again after `pollIntervalMs`". */
	poll(): Promise<SasOutcome | null>;
	/**
	 * Poll until it settles, backing off from the stated interval toward the stated
	 * ceiling (E5: honest polling is a declared interval and a backoff, never
	 * as-fast-as-possible).
	 */
	await(options?: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> }): Promise<SasOutcome>;
}

export class SasRefusedError extends Error {
	constructor(
		readonly error: string,
		detail: string,
		readonly status: number,
		readonly retryAfterMs?: number,
	) {
		super(detail);
		this.name = "SasRefusedError";
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start an exchange and derive the row to display. Does NOT wait for the operator —
 * the caller renders `emoji`, then awaits.
 */
export async function startSasVerification(
	options: StartSasVerificationOptions = {},
): Promise<SasVerificationHandle> {
	const base = options.baseUrl ?? "";
	const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
	// NOT extractable: the starting side never has to move this key anywhere, so it
	// should not be able to.
	const pair = await generateSasKeyPair({ extractable: false });

	const response = await doFetch(`${base}${SAS_HTTP_BASE}/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			wire: SAS_WIRE,
			publicKey: pair.publicKey,
			...(options.client ? { client: options.client } : {}),
			...(options.scope ? { scope: options.scope } : {}),
			...(options.lifetimeMs ? { lifetimeMs: options.lifetimeMs } : {}),
		}),
	});
	const payload = (await response.json()) as Record<string, unknown>;
	if (!response.ok) {
		throw new SasRefusedError(
			typeof payload.error === "string" ? payload.error : "refused",
			typeof payload.detail === "string" ? payload.detail : `start refused (${response.status})`,
			response.status,
			typeof payload.retryAfterMs === "number" ? payload.retryAfterMs : undefined,
		);
	}

	const id = String(payload.id);
	const confirmerPublicKey = String(payload.confirmerPublicKey);
	const transcript: SasTranscript = {
		sessionId: id,
		initiatorPublicKey: pair.publicKey,
		confirmerPublicKey,
	};
	const emoji = await deriveSasEmoji({
		privateKey: pair.privateKey,
		peerPublicKey: confirmerPublicKey,
		transcript,
	});
	const pollIntervalMs =
		typeof payload.pollIntervalMs === "number" ? payload.pollIntervalMs : SAS_POLL_INTERVAL_MS;

	async function poll(): Promise<SasOutcome | null> {
		const res = await doFetch(`${base}${SAS_HTTP_BASE}/${id}`, { method: "GET" });
		const body = (await res.json()) as Record<string, unknown>;
		if (res.status === 404) {
			return { state: "aborted", reason: null, detail: "this verification is no longer known" };
		}
		if (body.state === "pending") return null;
		if (body.state === "aborted") {
			return {
				state: "aborted",
				reason: (body.reason as SasAbortReason | null) ?? null,
				detail: typeof body.detail === "string" ? body.detail : "aborted",
			};
		}
		if (body.state === "granted") {
			const token = await openSasPayload({
				privateKey: pair.privateKey,
				peerPublicKey: confirmerPublicKey,
				transcript,
				sealed: body.sealed as SealedSasPayload,
			});
			return {
				state: "granted",
				token,
				scope: Array.isArray(body.scope) ? (body.scope as string[]) : [],
				lifetimeMs: typeof body.lifetimeMs === "number" ? body.lifetimeMs : 0,
			};
		}
		return { state: "aborted", reason: null, detail: "unrecognised answer from the node" };
	}

	async function awaitOutcome(
		waitOptions: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {},
	): Promise<SasOutcome> {
		const sleep = waitOptions.sleep ?? defaultSleep;
		let interval = pollIntervalMs;
		for (;;) {
			if (waitOptions.signal?.aborted) {
				return { state: "aborted", reason: "cancelled", detail: "the caller stopped waiting" };
			}
			const outcome = await poll();
			if (outcome) return outcome;
			await sleep(interval);
			// Backoff toward the stated ceiling — a screen left open all afternoon must
			// not keep costing the node a request every two seconds.
			interval = Math.min(Math.floor(interval * 1.5), SAS_POLL_MAX_INTERVAL_MS);
		}
	}

	return { id, emoji, transcript, pollIntervalMs, poll, await: awaitOutcome };
}
