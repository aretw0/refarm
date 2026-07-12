import { ambientActivitySink, type ActivitySink, type ProcessActivity } from "@refarm.dev/capabilities";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The SOVEREIGN half of the activity bridge, CLI side: tail the daemon's
 * `activity.ndjson` and feed each `process:*` line into an `ActivitySink`, so remote work
 * running in the runtime (an agent turn, a plugin dispatch) shows the operator "working"
 * in this separate CLI process — WITHOUT a live socket. It mirrors how `followStreamFile`
 * tails a response stream: the writer is another process, so we poll on an interval and
 * read only what's new (by byte offset), never re-emitting a line.
 *
 * The renderer (renderActivityOnCli) is already subscribed to the ambient sink; this just
 * pumps the daemon's events into it, so a command that drives the runtime lights up the
 * same spinner as local `withActivity` work — the operator never knows the origin.
 */
export interface ActivityFollowerHandle {
	/** Stop polling (idempotent). */
	stop(): void;
}

export interface ActivityFollowOptions {
	sink?: ActivitySink;
	/** The dir holding `activity.ndjson` (defaults to the runtime streams dir). */
	streamsDir?: string;
	/** Poll cadence in ms (default 100 — same as the stream follower). */
	pollIntervalMs?: number;
}

/** The single append-only activity file the daemon writes (mirrors the RS
 * `ACTIVITY_STREAM_NAME`). */
const ACTIVITY_FILE = "activity.ndjson";

/**
 * Start tailing `<streamsDir>/activity.ndjson` into `sink` (default: the ambient sink the
 * CLI renderer listens to). Returns a handle to stop. Missing file / read errors are
 * ignored (the daemon may not have started writing yet) — polling simply retries.
 */
export function followActivityFile(options: ActivityFollowOptions = {}): ActivityFollowerHandle {
	const sink = options.sink ?? ambientActivitySink;
	const pollIntervalMs = options.pollIntervalMs ?? 100;
	const filePath = path.join(
		options.streamsDir ?? resolveStreamsDir(),
		ACTIVITY_FILE,
	);

	// Byte offset already consumed — we only parse bytes appended since the last poll, so a
	// line is emitted exactly once. Start at the CURRENT end so a fresh follower does not
	// replay historical activity from a long-lived file.
	let offset = fileSize(filePath);
	let carry = ""; // a partial trailing line held until its newline arrives
	let stopped = false;

	const poll = () => {
		if (stopped) return;
		let size: number;
		try {
			size = fileSize(filePath);
		} catch {
			return;
		}
		if (size < offset) {
			// The file was truncated/rotated — restart from its new start.
			offset = 0;
			carry = "";
		}
		if (size <= offset) return;

		let chunk: string;
		try {
			const fd = fs.openSync(filePath, "r");
			try {
				const buf = Buffer.alloc(size - offset);
				fs.readSync(fd, buf, 0, buf.length, offset);
				chunk = buf.toString("utf-8");
			} finally {
				fs.closeSync(fd);
			}
		} catch {
			return;
		}
		offset = size;

		const text = carry + chunk;
		const lines = text.split("\n");
		carry = lines.pop() ?? ""; // last element is the partial (or empty) trailing line
		for (const line of lines) {
			const event = parseActivityLine(line);
			if (event) sink.emit(event);
		}
	};

	const timer = setInterval(poll, pollIntervalMs);
	// Do not keep the process alive just for the follower (mirrors stream polling).
	timer.unref?.();

	return {
		stop() {
			if (stopped) return;
			stopped = true;
			clearInterval(timer);
		},
	};
}

/** Parse one ndjson line into a ProcessActivity, or null if it isn't a well-formed
 * activity event (a partial/garbage line is skipped, never crashes the follower). */
function parseActivityLine(line: string): ProcessActivity | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		const value = JSON.parse(trimmed) as Partial<ProcessActivity>;
		if (
			typeof value.activityRef === "string" &&
			(value.phase === "started" || value.phase === "progress" || value.phase === "finished") &&
			typeof value.label === "string" &&
			typeof value.kind === "string"
		) {
			return value as ProcessActivity;
		}
	} catch {
		// Not JSON (yet) — skip.
	}
	return null;
}

function fileSize(filePath: string): number {
	try {
		return fs.statSync(filePath).size;
	} catch {
		return 0;
	}
}

/** Resolve the runtime streams dir the daemon writes to (REFARM_STREAMS_DIR), falling
 * back to the conventional path. Kept local so this util has no command-layer import. */
function resolveStreamsDir(): string {
	const fromEnv = process.env.REFARM_STREAMS_DIR?.trim();
	if (fromEnv) return fromEnv;
	return path.join(process.env.HOME ?? ".", ".refarm", "streams");
}
