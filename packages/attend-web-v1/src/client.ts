/**
 * The two requests, and the only place in this block that performs I/O.
 *
 * Everything else is pure so it can be tested with a table; this is thin so that what it
 * adds over `fetch` is exactly three things and they are all visible at once:
 *
 *   1. the bearer goes in an `Authorization` header and NOWHERE else — never a query
 *      string, never a cookie, never a log line;
 *   2. a thrown fetch becomes `unreachable`, so the caller's `catch` is never the place
 *      where "the node is down" is confused with "the node said no";
 *   3. a body that is not JSON is treated as no body rather than as a crash — a proxy
 *      returning an HTML error page must not take the page down with a parse error.
 *
 * `fetch` is injected, so every path here is exercised in Node with no server listening.
 */

import {
	classifyAttendAnswerResponse,
	classifyAttendListResponse,
	unreachableRefusal,
	type AttendAnswerOutcome,
	type AttendRefusal,
} from "./refusal.js";
import { declaredAttendPollIntervalMs } from "./poll.js";
import { ATTEND_PROMPTS_PATH, attendAnswerPath, readPendingPromptList } from "./wire.js";

import type { PendingPrompt } from "@refarm.dev/prompt-contract-v1";

export type AttendFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface AttendClientOptions {
	/** Origin to call. Defaults to same-origin (""), which is what the page uses: the
	 *  listener that served the page proxies `/prompts` to the node's sidecar, so there is
	 *  no cross-origin request to arrange and no CORS to weaken. */
	readonly baseUrl?: string;
	readonly fetch?: AttendFetch;
	/** Reads the CURRENT bearer each call, rather than capturing one at construction: the
	 *  credential is replaced whenever the handshake runs again, and a client holding a
	 *  stale copy would keep presenting the token that just expired. */
	readonly token: () => string | null;
}

export interface AttendListResult {
	readonly ok: true;
	readonly prompts: readonly PendingPrompt[];
	/** What the node said its polling cadence is. The caller must not undercut it. */
	readonly pollIntervalMs: number;
}

export type AttendListOutcome = AttendListResult | { readonly ok: false; readonly refusal: AttendRefusal };

export interface AttendClient {
	list(signal?: AbortSignal): Promise<AttendListOutcome>;
	answer(promptId: string, value: boolean | string, signal?: AbortSignal): Promise<AttendAnswerOutcome>;
}

/** Parse a response body as JSON, or `undefined`. A non-JSON body from a proxy is a
 *  reason to fall back on the STATUS, never a reason to throw. */
async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

export function createAttendClient(options: AttendClientOptions): AttendClient {
	const base = options.baseUrl ?? "";
	const doFetch: AttendFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

	/** The bearer, as a header — or no header at all. An `Authorization: Bearer null` is
	 *  a request that gets refused for the wrong reason and teaches the operator nothing. */
	function authHeaders(): Record<string, string> {
		const token = options.token();
		return token ? { authorization: `Bearer ${token}` } : {};
	}

	return {
		async list(signal): Promise<AttendListOutcome> {
			let response: Response;
			try {
				response = await doFetch(`${base}${ATTEND_PROMPTS_PATH}`, {
					method: "GET",
					headers: { accept: "application/json", ...authHeaders() },
					...(signal ? { signal } : {}),
				});
			} catch (error) {
				return { ok: false, refusal: unreachableRefusal(error) };
			}
			const body = await readJson(response);
			const classified = classifyAttendListResponse(response.status, body);
			if (!classified.ok) return { ok: false, refusal: classified.refusal };
			return {
				ok: true,
				prompts: readPendingPromptList(classified.body),
				pollIntervalMs: declaredAttendPollIntervalMs(classified.body),
			};
		},

		async answer(promptId, value, signal): Promise<AttendAnswerOutcome> {
			let response: Response;
			try {
				response = await doFetch(`${base}${attendAnswerPath(promptId)}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json",
						...authHeaders(),
					},
					// `value` and nothing else. A `device` field would be ignored by the node
					// anyway (the gate's identity is the only attribution there is), and
					// sending one would suggest otherwise.
					body: JSON.stringify({ value }),
					...(signal ? { signal } : {}),
				});
			} catch (error) {
				return { ok: false, refusal: unreachableRefusal(error) };
			}
			return classifyAttendAnswerResponse(response.status, await readJson(response));
		},
	};
}
