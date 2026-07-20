/**
 * `agent-activity` — the WEB twin of T1's TUI `agent-watch`: the agent's `agent:*` lifecycle events as a
 * LIVE, growing table in the browser. Same "watch the machine work" face, projected to the DOM via the
 * generic `mountLiveEventTable` (the browser twin of surface-terminal's live view) — one live-table engine,
 * two surfaces. REPLAY a recorded run offline, or FOLLOW a live SSE stream. The mapping + mount are behind
 * an injectable source, so the growing table is unit-tested headless in jsdom (agent-activity.test.ts);
 * only the real SSE server tail stays a manual/integration concern.
 */
import { createLiveActivityFace, type LiveEventSource } from "@refarm.dev/capability-homestead-surface";

import type { AgentEventLine } from "../live-telemetry.js";

const COLUMNS = [
	{ key: "#", header: "#" },
	{ key: "event", header: "Event" },
	{ key: "ts", header: "When" },
];

/** Map an `agent:*` event line to a numbered table row — the web twin of agent-watch's agentEventRows. */
export function agentActivityRow(event: AgentEventLine, index: number): Record<string, unknown> {
	return { "#": index + 1, event: event.event, ts: event.ts !== undefined ? String(event.ts) : "" };
}

// One declaration → the mount / replay / follow trio (the shared live-activity face factory).
const face = createLiveActivityFace<AgentEventLine>({
	columns: COLUMNS,
	toRow: agentActivityRow,
	caption: "Agent activity — live",
});

export interface MountAgentActivityOptions {
	container: HTMLElement;
	source: LiveEventSource<AgentEventLine>;
	/** Keep only the last N rows — a rolling window; default unbounded. */
	maxRows?: number;
}

/** Mount the live agent-activity table into `container`, growing a row per event from `source`. */
export function mountAgentActivity(opts: MountAgentActivityOptions): () => void {
	return face.mount(opts);
}

/** REPLAY a recorded run's events into the live table (the demo/offline path — testable headless). */
export function replayAgentActivity(
	container: HTMLElement,
	events: readonly AgentEventLine[],
	maxRows?: number,
): () => void {
	return face.replay(container, events, maxRows);
}

/** FOLLOW a live SSE stream of `agent:*` events (browser-only; the server tail). Each SSE message is one
 * JSON event line. The render/grow logic it feeds is proven by replayAgentActivity's tests. */
export function followAgentActivity(container: HTMLElement, url: string): () => void {
	return face.follow(container, url);
}
