import type { Effort } from "@refarm.dev/effort-contract-v1";
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";

import { createRuntimeAgentRespondEffort } from "./runtime-agent-effort.js";
import type { RuntimeEffortResult } from "./runtime-stream.js";
import { resolveSidecarUrlAsync } from "./sidecar-url.js";

/**
 * AGENT LIVENESS — does the agent actually COMPLETE a respond? This closes the gap the other
 * checks miss: `doctor` proves the runtime is up, `model doctor` proves the provider pings, and
 * `ensureAgentReady` proves a defaultResponder is registered — but ALL of those pass while the
 * agent is a ZOMBIE (it receives the dispatch but never executes, e.g. after a half-broken
 * runtime reload). The only honest signal is a real end-to-end turn: submit a trivial respond
 * and see if it comes back. A timeout here is the zombie; the fix is a clean runtime restart.
 */

/** The outcome vocabulary of the agent-liveness probe — each state deserves its own advice, so
 * the signal is accurate, not a coarse pass/fail. */
export type AgentLivenessStatus =
	/** The agent completed a real respond — it's alive. */
	| "responsive"
	/** The respond was submitted but never produced a terminal result within the window — the
	 * ZOMBIE: dispatch received, nothing executed. A clean runtime restart recovers. */
	| "unresponsive"
	/** No agent is the active responder — nothing to probe (load/install the agent first). */
	| "no-agent"
	/** Could not submit / reach the runtime — a runtime problem, not an agent one. */
	| "runtime-unreachable";

export interface AgentLivenessResult {
	status: AgentLivenessStatus;
	/** Human sentence for the probe line. */
	message: string;
	/** Actionable next step for the operator. */
	nextAction: string;
	/** Round-trip of the probe respond, ms (when it completed). */
	elapsedMs?: number;
}

/** Classify a completed probe: the effort result (or null on timeout) → a liveness verdict.
 * PURE — the I/O caller passes what it observed. */
export function classifyAgentLiveness(
	result: RuntimeEffortResult | null,
	timedOut: boolean,
	elapsedMs: number,
): AgentLivenessResult {
	if (result && result.status === "ok") {
		return {
			status: "responsive",
			message: `responsive (${elapsedMs}ms)`,
			nextAction: 'The agent is ready — run `refarm ask "…"`.',
			elapsedMs,
		};
	}
	if (result && result.status === "error") {
		// The agent ran but the turn errored (model/tool error) — it's alive, just this turn failed.
		return {
			status: "responsive",
			message: `responsive, but the probe turn errored (${elapsedMs}ms)`,
			nextAction: "The agent runs; check the model route with `refarm model doctor`.",
			elapsedMs,
		};
	}
	if (timedOut) {
		return {
			status: "unresponsive",
			message: "UNRESPONSIVE — the agent received the request but produced no response",
			nextAction:
				"The agent is loaded but not executing (a zombie, often after a half-broken reload). " +
				"Restart the runtime cleanly: `refarm runtime stop` then `refarm runtime start`.",
		};
	}
	return {
		status: "runtime-unreachable",
		message: "could not read the probe result",
		nextAction: "Is the runtime up? Run `refarm runtime status` / `refarm doctor`.",
	};
}

export interface ProbeAgentLivenessOptions {
	/** How long to wait for the probe respond before calling it unresponsive (ms). Defaults to
	 * 45s to match the runtime's respond-watch window — a real model turn (Codex) can take tens
	 * of seconds, and a shorter window false-positives a live-but-slow agent as a zombie. A
	 * zombie never answers, so it always hits this deadline; a live agent answers within it. */
	timeoutMs?: number;
	/** Poll interval for the result file (ms). Default 500. */
	pollMs?: number;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Probe the agent with a minimal respond and report whether it completed. Submits `respond`
 * with a trivial prompt to the sidecar, then polls the effort result until it lands or the
 * window elapses. Detects the zombie (submit ok, no result) that every other check misses.
 */
export async function probeAgentLiveness(
	options: ProbeAgentLivenessOptions = {},
): Promise<AgentLivenessResult> {
	const timeoutMs = options.timeoutMs ?? 45_000;
	const pollMs = options.pollMs ?? 500;
	const env = options.env ?? process.env;
	const now = options.now ?? (() => Date.now());
	const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

	let sidecarUrl: string;
	try {
		sidecarUrl = await resolveSidecarUrlAsync(env);
	} catch {
		return {
			status: "runtime-unreachable",
			message: "could not resolve the runtime sidecar URL",
			nextAction: "Start the runtime: `refarm runtime start`.",
		};
	}

	const effort: Effort = createRuntimeAgentRespondEffort({
		prompt: "Reply with exactly: ok",
		system: "You are a liveness probe. Reply with exactly: ok",
		sessionId: `liveness-${effort_session_suffix(now)}`,
		source: "refarm-ask",
		historyTurns: 0,
	});

	const started = now();
	try {
		const response = await fetchSidecarWithTimeout(
			`${sidecarUrl.replace(/\/+$/, "")}/efforts`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(effort),
			},
			{ env },
		);
		if (!response.ok) {
			return {
				status: "no-agent",
				message: `the runtime rejected the probe (HTTP ${response.status})`,
				nextAction: "Is an agent loaded? Run `refarm plugin status` / `refarm plugin install`.",
			};
		}
	} catch {
		return {
			status: "runtime-unreachable",
			message: "could not submit the probe to the runtime",
			nextAction: "Is the runtime up? Run `refarm runtime status`.",
		};
	}

	// Read the result back over the sidecar (GET /efforts/:id) — NOT a result file: the daemon
	// writes results under ITS --refarm-dir, which need not be the CLI's home task-results dir,
	// so a file read false-negatives (the effort completes but the file never appears here). The
	// sidecar always knows where the result is.
	const base = `${sidecarUrl.replace(/\/+$/, "")}/efforts/${effort.id}`;
	const deadline = started + timeoutMs;
	for (;;) {
		const result = await readEffortViaSidecar(base, env);
		if (result) return classifyAgentLiveness(result, false, now() - started);
		if (now() >= deadline) return classifyAgentLiveness(null, true, now() - started);
		await sleep(pollMs);
	}
}

/** GET the effort from the sidecar; return a RuntimeEffortResult-shaped verdict once it reaches
 * a terminal state (done/delivered/partial/failed/…), else null (still running / not found). */
async function readEffortViaSidecar(
	url: string,
	env: NodeJS.ProcessEnv,
): Promise<RuntimeEffortResult | null> {
	let payload: { status?: unknown; results?: Array<{ status?: unknown; error?: unknown }> };
	try {
		const response = await fetchSidecarWithTimeout(url, {}, { env });
		if (!response.ok) return null; // 404 = not landed yet
		payload = (await response.json()) as typeof payload;
	} catch {
		return null;
	}
	const status = typeof payload.status === "string" ? payload.status : "";
	// A dispatch effort that reaches "done"/"delivered" completed; "pending"/"in-progress" hasn't.
	if (status === "pending" || status === "in-progress" || status === "") return null;
	// Terminal. An all-ok effort is "ok"; anything else (failed/partial/timed-out) is an error —
	// the agent still RAN (it's not a zombie), the turn just didn't fully succeed.
	const ok = status === "done" || status === "delivered";
	return ok
		? ({ status: "ok" } as RuntimeEffortResult)
		: ({ status: "error", error: `effort ${status}` } as RuntimeEffortResult);
}

/** A session suffix that doesn't need Math.random (unavailable in some contexts): the clock. */
function effort_session_suffix(now: () => number): string {
	return String(now()).slice(-8);
}
