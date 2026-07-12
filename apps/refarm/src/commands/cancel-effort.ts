import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";

import { resolveSidecarUrlAsync } from "./sidecar-url.js";

/**
 * CANCEL AN IN-FLIGHT EFFORT over the sidecar — the surface-neutral primitive every
 * interactive surface (TUI ESC, web cancel button, a future Telegram /stop) drives to
 * STOP a running agent turn. It POSTs `/efforts/:id/cancel`, which force-interrupts the
 * plugin (the host flips the plugin's cancel flag; its epoch callback traps at the next
 * tick and unwinds a wedged call) and transitions the effort to `cancelled`. This is the
 * real interrupt, not a cooperative flag a wedged WASM turn would never poll.
 *
 * `task-support.ts`'s `HttpTransportClient.cancel` also POSTs `/efforts/:id/cancel`, but
 * it is task-management shaped: it takes a pre-resolved `baseUrl`, returns a bare boolean
 * (true/409-or-404-false/throw), and lives among retry/summary/list. This helper is for an
 * INTERACTIVE surface instead: it resolves the sidecar URL itself, NEVER throws (a dead
 * runtime becomes a verdict, so an ESC handler stays a one-liner), and returns a rich
 * verdict (cancelled vs already-finished vs unreachable) the surface can show verbatim.
 * (Neither is the file-based control-request path in `task-support.ts` — a `.cancel.json`
 * a reaper picks up — which suits DETACHED tasks, not a live turn being answered now.)
 */

/** The outcome vocabulary of a cancel request — each state gets an honest message so a
 * surface can render the truth (cancelled vs already-done vs unreachable), not a coarse
 * boolean. */
export type CancelEffortStatus =
	/** The effort was running and is now cancelled. */
	| "cancelled"
	/** The effort had already reached a terminal state — nothing to cancel (a race with
	 * the answer landing; benign). */
	| "already-terminal"
	/** No such effort id at the sidecar (unknown / never submitted). */
	| "not-found"
	/** Could not reach the runtime to request the cancel. */
	| "runtime-unreachable";

export interface CancelEffortResult {
	status: CancelEffortStatus;
	/** Human sentence for the surface to show. */
	message: string;
}

/** Classify the sidecar's cancel response (HTTP status) into a verdict. PURE — the I/O
 * caller passes what it observed, so this is unit-testable without a server. The sidecar
 * answers 202 (accepted → cancelled), 409 (already terminal), 404 (not found); anything
 * else is treated as the runtime being unreachable/unhappy. */
export function classifyCancel(httpStatus: number | null): CancelEffortResult {
	if (httpStatus === 202) {
		return { status: "cancelled", message: "Cancelled — the agent turn was interrupted." };
	}
	if (httpStatus === 409) {
		return {
			status: "already-terminal",
			message: "Nothing to cancel — the turn had already finished.",
		};
	}
	if (httpStatus === 404) {
		return { status: "not-found", message: "No such in-flight turn to cancel." };
	}
	return {
		status: "runtime-unreachable",
		message: "Could not reach the runtime to cancel the turn.",
	};
}

export interface CancelEffortOptions {
	env?: NodeJS.ProcessEnv;
	/** Override the sidecar URL resolution (tests / non-default runtimes). */
	sidecarUrl?: string;
	/** Injectable fetch for tests. */
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

/**
 * Request cancellation of `effortId` over the sidecar and report the outcome. Resolves
 * the sidecar URL, POSTs `/efforts/:id/cancel`, and classifies the response. Never
 * throws — a network failure becomes `runtime-unreachable`, so a surface's ESC handler
 * stays simple (call it, render the returned message).
 */
export async function cancelEffortViaSidecar(
	effortId: string,
	options: CancelEffortOptions = {},
): Promise<CancelEffortResult> {
	const env = options.env ?? process.env;

	let sidecarUrl: string;
	try {
		sidecarUrl = options.sidecarUrl ?? (await resolveSidecarUrlAsync(env));
	} catch {
		return classifyCancel(null);
	}

	const url = `${sidecarUrl.replace(/\/+$/, "")}/efforts/${encodeURIComponent(effortId)}/cancel`;
	try {
		const response = await fetchSidecarWithTimeout(
			url,
			{ method: "POST" },
			{ env, fetch: options.fetchImpl, timeoutMs: options.timeoutMs },
		);
		return classifyCancel(response.status);
	} catch {
		return classifyCancel(null);
	}
}
