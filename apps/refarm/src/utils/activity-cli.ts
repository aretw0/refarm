import {
	ambientActivitySink,
	type ActivitySink,
	type ProcessActivity,
	type Unsubscribe,
} from "@refarm.dev/capabilities";

import { startProgressIndicator, type ProgressIndicator } from "./spinner.js";

/**
 * The CLI RENDERER for the surface-neutral activity signal: subscribe to an
 * `ActivitySink` and drive the terminal spinner so the operator SEES that work is
 * happening — whatever the work is (a Codex login, a git clone, an agent turn). The
 * emitter (`withActivity`) is origin-agnostic; this is the CLI half. The same signal
 * feeds the TUI and (via a daemon bridge) remote work, so nothing here is coupled to a
 * particular kind of process.
 *
 * Concurrency: activities are tracked by `activityRef`. The spinner shows the MOST
 * RECENTLY started still-running activity (a stack), so a nested sub-activity takes the
 * line and, when it finishes, the parent's label returns. `label` (+ optional `note`)
 * is what the operator reads.
 */
export interface ActivityRendererHandle {
	/** Stop rendering and detach from the sink (idempotent). */
	stop(): void;
}

interface LiveActivity {
	label: string;
	kind: string;
	note?: string;
}

/** Compose the line shown for an activity: "label — note" (note optional). */
function activityLine(a: LiveActivity): string {
	return a.note ? `${a.label} — ${a.note}` : a.label;
}

/**
 * Attach a terminal spinner to `sink` for the duration of the process (or until
 * `stop()`). Returns a handle to detach. Off a TTY the spinner degrades to printed
 * lines (via startProgressIndicator), so headless/piped runs still get a trace without
 * ANSI noise. Safe to attach once at CLI startup.
 */
export function renderActivityOnCli(
	options: { sink?: ActivitySink; stream?: NodeJS.WriteStream } = {},
): ActivityRendererHandle {
	const sink = options.sink ?? ambientActivitySink;
	const stream = options.stream ?? process.stderr;

	// The stack of still-running activities, most-recent last. The spinner reflects the
	// top of the stack; when it finishes we fall back to the one beneath.
	const stack: string[] = [];
	const live = new Map<string, LiveActivity>();
	let indicator: ProgressIndicator | null = null;
	let stopped = false;

	const showTop = () => {
		const topRef = stack[stack.length - 1];
		const top = topRef ? live.get(topRef) : undefined;
		if (!top) {
			// Nothing running — tear the spinner down so the line is clean.
			indicator?.stop();
			indicator = null;
			return;
		}
		if (!indicator) {
			indicator = startProgressIndicator(activityLine(top), { stream });
		} else {
			indicator.update(activityLine(top));
		}
	};

	const onEvent = (event: ProcessActivity) => {
		if (stopped) return;
		switch (event.phase) {
			case "started": {
				live.set(event.activityRef, { label: event.label, kind: event.kind });
				stack.push(event.activityRef);
				showTop();
				break;
			}
			case "progress": {
				const entry = live.get(event.activityRef);
				if (entry) {
					entry.note = event.note;
					// Only refresh the line if THIS activity is the one on screen.
					if (stack[stack.length - 1] === event.activityRef) showTop();
				}
				break;
			}
			case "finished": {
				live.delete(event.activityRef);
				const idx = stack.lastIndexOf(event.activityRef);
				if (idx !== -1) stack.splice(idx, 1);
				showTop();
				break;
			}
		}
	};

	const unsubscribe: Unsubscribe = sink.subscribe(onEvent);

	return {
		stop() {
			if (stopped) return;
			stopped = true;
			unsubscribe();
			indicator?.stop();
			indicator = null;
			stack.length = 0;
			live.clear();
		},
	};
}
