/**
 * `agent-watch` — the live consumer of the TUI live-view engine, for T1 (the coding-agent bench).
 *
 * On every real WASM run the agent emits `agent:*` lifecycle events to `scarecrow-audit.ndjson`. This
 * replays a recorded run's events as a LIVE, growing table (`runLiveView`/`runLiveTerminal` +
 * `renderTable`) — the "watch the machine work" face. The rendering pipeline is behind a testable seam
 * (`watchAgentEvents` takes an injectable `output`, so the growing table is asserted headless from fixture
 * events); only the real terminal (alt-screen, Ctrl-C restore) + a live file tail stay manual (see
 * docs/manual-test-plan.md).
 */
import { arrayLiveSource, renderTable, runLiveTerminal, runLiveView } from "@refarm.dev/surface-terminal";

import { readAgentEvents, type AgentEventLine } from "./live-telemetry.js";

/** Map `agent:*` event lines to numbered table rows (#, event, when). Pure. */
export function agentEventRows(
	events: readonly AgentEventLine[],
): Array<{ "#": number; event: string; ts: string }> {
	return events.map((event, index) => ({
		"#": index + 1,
		event: event.event,
		ts: event.ts !== undefined ? String(event.ts) : "",
	}));
}

const COLUMNS = [
	{ key: "#", header: "#" },
	{ key: "event", header: "Event" },
	{ key: "ts", header: "When" },
];

export interface WatchAgentEventsOptions {
	events: readonly AgentEventLine[];
	width?: number;
	/** Headless (tests): capture each frame. Omit → drive the real terminal (alt-screen). */
	output?: (frame: string) => void;
}

/**
 * Replay a run's `agent:*` events as a LIVE, growing table. With `output` it runs headless (the growing
 * table is testable frame-by-frame); otherwise it drives the real terminal (Ctrl-C restores the screen).
 */
export async function watchAgentEvents(opts: WatchAgentEventsOptions): Promise<readonly AgentEventLine[]> {
	const width = opts.width ?? process.stdout.columns ?? 80;
	const source = arrayLiveSource(opts.events);
	const render = (shown: readonly AgentEventLine[]): Promise<string> =>
		renderTable(COLUMNS, agentEventRows(shown), { width });
	if (opts.output) return runLiveView({ source, render, output: opts.output });
	return runLiveTerminal({ source, render });
}

/**
 * Read the recorded `agent:*` events from `{refarmDir}/scarecrow-audit.ndjson` and replay them as a live
 * table on the real terminal — the node-only entry the `agent-watch` bin calls.
 */
export async function runAgentWatch(refarmDir: string): Promise<void> {
	await watchAgentEvents({ events: readAgentEvents(refarmDir) });
}
