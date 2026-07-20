/**
 * The SERVER tail behind T1's live web face: an SSE endpoint that streams the agent's `agent:*` events to
 * the browser as they are written. Closes the loop the web `followAgentActivity` opened — agent writes
 * events → this tails the file + pushes them as Server-Sent Events → the browser's EventSource grows the
 * live table (mountLiveEventTable). The SAME events the TUI agent-watch tails; the SAME EventStreamSource
 * shape (subscribe/unsubscribe) the browser + the SSE projector share. The poll (new-events-since-seen) is
 * behind injectable seams (snapshot + schedule), so it is unit-tested without a socket or a real timer.
 */
import { broadcastEventSource, createEventStreamHandler, type EventStreamSource } from "@refarm.dev/capabilities";
import type { IncomingMessage, ServerResponse } from "node:http";

import { readAgentEvents, type AgentEventLine } from "./live-telemetry.js";

export interface AgentEventStreamOptions {
	refarmDir?: string;
	/** Override the event snapshot (tests); default re-reads `{refarmDir}/scarecrow-audit.ndjson`. */
	snapshot?: () => readonly AgentEventLine[];
	/** Poll interval for the default schedule, ms. */
	intervalMs?: number;
	/** Schedule a repeating tick; returns a cancel fn. Injectable (tests tick manually); default setInterval. */
	schedule?: (tick: () => void, intervalMs: number) => () => void;
}

/**
 * An EventStreamSource that TAILS the agent event file: on subscribe it sends everything already recorded,
 * then on each tick sends the newly-appended `agent:*` events (by count), until the client disconnects. The
 * live tail never ends itself (SSE stays open); the caller's unsubscribe stops the poll.
 */
export function agentEventStreamSource(opts: AgentEventStreamOptions = {}): EventStreamSource {
	const refarmDir = opts.refarmDir ?? ".dgk";
	const snapshot = opts.snapshot ?? ((): readonly AgentEventLine[] => readAgentEvents(refarmDir));
	const intervalMs = opts.intervalMs ?? 500;
	const schedule =
		opts.schedule ??
		((tick: () => void, ms: number): (() => void) => {
			const id = setInterval(tick, ms);
			// Don't let the poll timer keep the process alive on its own — every subscription is cancelled on
			// socket close, but unref means a forgotten unsubscribe degrades to wasted CPU, not a hung exit.
			if (typeof id.unref === "function") id.unref();
			return () => clearInterval(id);
		});
	return {
		subscribe(send) {
			let seen = 0;
			const tick = (): void => {
				const all = snapshot();
				// If the file shrank (truncated / rotated / rewritten), `seen` is now past its end — resync
				// from the start instead of going permanently silent + misaligned against the new content.
				if (all.length < seen) seen = 0;
				for (; seen < all.length; seen++) send(all[seen]);
			};
			tick(); // flush what's already there immediately
			return schedule(tick, intervalMs);
		},
	};
}

/**
 * A node:http handler that streams the agent's `agent:*` events as SSE on GET `/agent/events` — mount it on
 * T1's face server beside createCapabilityRouteHandler; a browser page then calls
 * `followAgentActivity(container, "/agent/events")`. The file poll is shared across all connected browsers
 * via a broadcast hub (ONE poll fans out to N clients; a late joiner gets the run-so-far replayed), so ten
 * open tabs do not become ten file polls.
 */
export function createAgentEventStreamHandler(
	refarmDir: string,
	options: Omit<AgentEventStreamOptions, "refarmDir"> & { prefix?: string } = {},
): (req: IncomingMessage, res: ServerResponse) => boolean {
	const { prefix, ...sourceOptions } = options;
	return createEventStreamHandler(
		"/agent/events",
		broadcastEventSource(agentEventStreamSource({ refarmDir, ...sourceOptions })),
		prefix !== undefined ? { prefix } : {},
	);
}
