/**
 * progress — a zero-dep loading indicator for the device clients.
 *
 * "Is something happening?" — the answer a wait needs. A reusable block, so
 * farm-ask (waiting on the farm) and farm-update (downloading) share one spinner
 * instead of each rolling its own. TTY-aware on purpose: it animates on stderr
 * only when stderr is an interactive terminal; on a pipe or a log it stays
 * SILENT, so no escape codes leak into captured output (same posture as the
 * usage footer — stdout stays the pure, pipeable answer).
 */

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The one-line spinner render (pure): frame + label, with elapsed once it's ≥1s. */
export function formatSpinnerLine(frame, label, elapsedSec) {
	const tail = elapsedSec >= 1 ? ` (${elapsedSec}s)` : "";
	return `${frame} ${label}${tail}`;
}

/**
 * A TTY-aware spinner. Returns a handle: `start` (optionally (re)labelling),
 * `setLabel` to change the text mid-flight, and `stop` to clear the line and
 * optionally print a final message. On a non-TTY stream every method is a
 * no-op write — safe to call unconditionally. `now`/`stream` are injectable.
 */
export function createSpinner(options = {}) {
	const stream = options.stream ?? process.stderr;
	const isTTY = Boolean(stream.isTTY);
	const intervalMs = options.intervalMs ?? 90;
	const now = options.now ?? (() => Date.now());
	let label = options.label ?? "";
	let frame = 0;
	let timer = null;
	let startedAt = null;

	function paint() {
		const elapsedSec = startedAt ? Math.floor((now() - startedAt) / 1000) : 0;
		stream.write(`\r${formatSpinnerLine(SPINNER_FRAMES[frame], label, elapsedSec)}\x1b[K`);
		frame = (frame + 1) % SPINNER_FRAMES.length;
	}

	const handle = {
		start(startLabel) {
			if (startLabel != null) label = startLabel;
			if (!isTTY || timer) return handle;
			startedAt = now();
			paint(); // paint once immediately, then animate
			timer = setInterval(paint, intervalMs);
			if (typeof timer.unref === "function") timer.unref(); // never hold the process open
			return handle;
		},
		setLabel(next) {
			label = next ?? "";
			return handle;
		},
		stop(finalLine) {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			if (isTTY) stream.write("\r\x1b[K"); // clear the spinner line
			if (finalLine) stream.write(`${finalLine}\n`);
			return handle;
		},
	};
	return handle;
}
