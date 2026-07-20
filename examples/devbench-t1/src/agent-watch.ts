/**
 * `agent-watch` — the live consumer of the TUI live-view engine, for T1 (the coding-agent bench).
 *
 * On every real WASM run the agent emits `agent:*` lifecycle events to `scarecrow-audit.ndjson`. This
 * renders those events as a LIVE, growing table (`runLiveView`/`runLiveTerminal` + `renderTable`) — the
 * "watch the machine work" face — in two modes:
 *   • REPLAY (`watchAgentEvents`): a recorded run's events, one array, replayed to completion.
 *   • FOLLOW (`followAgentEvents`): a live TAIL — re-read the (growing) event file each poll and paint
 *     each newly-appended `agent:*` line as it arrives, until stopped (Ctrl-C on the real terminal).
 *
 * Both run behind testable seams: they take an injectable `output` (assert the growing table frame by
 * frame headless), and `followAgentEvents` also takes an injectable `snapshot`/`wait`/`done` (assert the
 * live tail without the real fs poll). Only the real terminal (alt-screen, Ctrl-C restore) and the
 * fs-backed default snapshot against a live run stay manual (see docs/manual-test-plan.md).
 */
import {
	arrayLiveSource,
	type LiveSource,
	pollingSnapshotSource,
	renderTable,
	runLiveTerminal,
	runLiveView,
} from "@refarm.dev/surface-terminal";

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

const DEFAULT_WIDTH = 80;
const DEFAULT_POLL_MS = 300;

/** Drive the growing agent-event table from a source: headless when `output` is given, else the terminal. */
async function runEventTable(
	source: LiveSource<AgentEventLine>,
	width: number,
	output?: (frame: string) => void,
): Promise<readonly AgentEventLine[]> {
	const render = (shown: readonly AgentEventLine[]): Promise<string> =>
		renderTable(COLUMNS, agentEventRows(shown), { width });
	if (output) return runLiveView({ source, render, output });
	return runLiveTerminal({ source, render });
}

export interface WatchAgentEventsOptions {
	events: readonly AgentEventLine[];
	width?: number;
	/** Headless (tests): capture each frame. Omit → drive the real terminal (alt-screen). */
	output?: (frame: string) => void;
}

/**
 * REPLAY a run's `agent:*` events as a LIVE, growing table. With `output` it runs headless (the growing
 * table is testable frame-by-frame); otherwise it drives the real terminal (Ctrl-C restores the screen).
 */
export async function watchAgentEvents(opts: WatchAgentEventsOptions): Promise<readonly AgentEventLine[]> {
	const width = opts.width ?? process.stdout.columns ?? DEFAULT_WIDTH;
	return runEventTable(arrayLiveSource(opts.events), width, opts.output);
}

export interface FollowAgentEventsOptions {
	/** Where `{refarmDir}/scarecrow-audit.ndjson` lives (the fs-backed default snapshot). */
	refarmDir?: string;
	/** Override the event snapshot (tests: a growing in-memory source; default: re-read the file). */
	snapshot?: () => readonly AgentEventLine[];
	width?: number;
	/** Poll interval for the default `wait`, ms. */
	intervalMs?: number;
	/** Await between polls (tests: tick instantly; default: setTimeout intervalMs). */
	wait?: () => Promise<void>;
	/** End the tail (tests: stop after the fixture drains; default: never — quit with Ctrl-C). */
	done?: () => boolean;
	/** Headless (tests): capture each frame. Omit → drive the real terminal. */
	output?: (frame: string) => void;
}

/**
 * FOLLOW a run's `agent:*` events LIVE: re-read the growing event file each poll and paint each newly
 * appended line as a new row, until `done()` (default: never — Ctrl-C quits on the real terminal). The
 * fs read, the poll interval, and the stop condition are all injectable, so the live-grows behaviour is
 * unit-testable headless (a growing in-memory snapshot + an instant wait) — only the real fs poll against
 * a live run stays manual.
 */
export async function followAgentEvents(
	opts: FollowAgentEventsOptions = {},
): Promise<readonly AgentEventLine[]> {
	const width = opts.width ?? process.stdout.columns ?? DEFAULT_WIDTH;
	const refarmDir = opts.refarmDir ?? ".dgk";
	const snapshot = opts.snapshot ?? ((): readonly AgentEventLine[] => readAgentEvents(refarmDir));
	const intervalMs = opts.intervalMs ?? DEFAULT_POLL_MS;
	const wait =
		opts.wait ?? ((): Promise<void> => new Promise((resolve) => setTimeout(resolve, intervalMs)));
	const source = pollingSnapshotSource<AgentEventLine>({
		snapshot,
		wait,
		...(opts.done ? { done: opts.done } : {}),
	});
	return runEventTable(source, width, opts.output);
}

export interface RunAgentWatchOptions {
	/** Live tail (follow the file as a run writes it) instead of replaying what's already recorded. */
	follow?: boolean;
}

/**
 * The node-only entry the `agent-watch` bin calls: replay the recorded `agent:*` events (default), or
 * `--follow` to tail the file live on the real terminal (Ctrl-C restores the screen).
 */
export async function runAgentWatch(refarmDir: string, opts: RunAgentWatchOptions = {}): Promise<void> {
	if (opts.follow) {
		await followAgentEvents({ refarmDir });
		return;
	}
	await watchAgentEvents({ events: readAgentEvents(refarmDir) });
}
