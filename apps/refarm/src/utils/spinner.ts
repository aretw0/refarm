const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerOptions {
	stream?: NodeJS.WriteStream;
	intervalMs?: number;
}

export interface ProgressIndicator {
	update(message: string): void;
	stop(): void;
}

/**
 * TWO STREAMS, ONE CURSOR — the defect this guards against.
 *
 * The spinner writes to stderr and commands report through `console.log` on stdout. A terminal gives
 * both one cursor, so a success line lands ON the spinner's line and the two run together:
 *
 *   ⠼ Signing in to GitHub Copilot — Exchanging the token…  ✓ GitHub Copilot — authenticated
 *
 * Reported by the operator 2026-08-15. Fixing it at each call site would be a rule everyone has to
 * remember; this makes correct interleaving the default for every command that uses the spinner at
 * all. While an indicator is live, a stdout write clears the spinner's line first and the spinner
 * redraws after.
 */
function guardStdoutWhileSpinning(
	stream: NodeJS.WriteStream,
	redraw: () => void,
): () => void {
	const stdout = process.stdout;
	if (!stream.isTTY || !stdout.isTTY) return () => {};
	// THE REFERENCE, not a bound copy. Restoring a bound copy leaves `stdout.write` different from
	// what it was, so a second spinner would wrap the first wrapper and each cycle would add a layer.
	const original = stdout.write;
	stdout.write = function patched(this: unknown, ...args: unknown[]) {
		stream.write("\r\x1b[2K");
		const result = (original as (...a: unknown[]) => boolean).apply(stdout, args);
		redraw();
		return result;
	} as typeof stdout.write;
	return () => {
		// Only if nobody else took over in the meantime; clobbering someone else's patch would be
		// the same class of accident this guard exists to prevent.
		stdout.write = original;
	};
}

export function startSpinner(message: string, options: SpinnerOptions = {}): () => void {
	const indicator = startProgressIndicator(message, options);
	return () => indicator.stop();
}

export function startProgressIndicator(
	message: string,
	options: SpinnerOptions = {},
): ProgressIndicator {
	const stream = options.stream ?? process.stdout;
	const intervalMs = options.intervalMs ?? 80;
	let i = 0;
	let currentMessage = message;
	let stopped = false;

	if (!stream.isTTY) {
		stream.write(`  ${currentMessage}\n`);
		return {
			update(nextMessage: string) {
				currentMessage = nextMessage;
				stream.write(`  ${currentMessage}\n`);
			},
			stop() {
				stopped = true;
			},
		};
	}

	const render = () => {
		stream.write(`\r\x1b[2K  ${FRAMES[i++ % FRAMES.length]} ${currentMessage}`);
	};
	render();
	const id = setInterval(render, intervalMs);
	const releaseStdout = guardStdoutWhileSpinning(stream, render);

	return {
		update(nextMessage: string) {
			currentMessage = nextMessage;
			render();
		},
		stop() {
			if (stopped) return;
			stopped = true;
			clearInterval(id);
			releaseStdout();
			stream.write("\r\x1b[2K");
		},
	};
}

export async function withProgress<T>(
	message: string,
	work: (progress: ProgressIndicator) => Promise<T>,
	options: SpinnerOptions = {},
): Promise<T> {
	const progress = startProgressIndicator(message, options);
	try {
		return await work(progress);
	} finally {
		progress.stop();
	}
}
