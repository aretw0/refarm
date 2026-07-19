/**
 * A LIVE terminal view — the redraw loop driven by a STREAM of items (not keypresses), re-rendering each
 * time one arrives. This is the "watch the machine work" face: point it at a source of `agent:*` runtime
 * events (or any stream) and the view updates live. The core `runLiveView` is PURE (source + output
 * injected), so it is unit-testable headless; `runLiveTerminal` is the node-only wrapper (alt-screen +
 * cursor, restored on SIGINT). Brand-neutral.
 */

/** Pull the next item from a stream; resolves `null` when the stream ends. */
export type LiveSource<T> = () => Promise<T | null>;

/** A LiveSource that replays a fixed array then ends — the deterministic source for tests + demos. */
export function arrayLiveSource<T>(items: readonly T[]): LiveSource<T> {
	let index = 0;
	return () => Promise.resolve(index < items.length ? items[index++]! : null);
}

export interface RunLiveViewOptions<T> {
	/** Pull the next item; `null` ends the view. */
	source: LiveSource<T>;
	/** Render the accumulated items to a frame (may be async — e.g. renderTable). */
	render: (items: readonly T[]) => string | Promise<string>;
	/** Write a frame (injectable; default stdout). */
	output?: (frame: string) => void;
	/** Keep only the last N items — a rolling window; default unbounded. */
	maxItems?: number;
}

/**
 * Drive a live view: render the (initially empty) items, then on each item from the source append it
 * (dropping the oldest past `maxItems`) and re-render, until the source ends (`null`). PURE given injected
 * source + output. Returns the final accumulated items.
 */
export async function runLiveView<T>(opts: RunLiveViewOptions<T>): Promise<readonly T[]> {
	const output = opts.output ?? ((frame: string) => void process.stdout.write(frame));
	const items: T[] = [];
	output(await opts.render(items));
	for (;;) {
		const item = await opts.source();
		if (item === null) return items;
		items.push(item);
		if (opts.maxItems !== undefined && items.length > opts.maxItems) items.shift();
		output(await opts.render(items));
	}
}

const ESC = String.fromCharCode(27);
const ALT_SCREEN_ENTER = `${ESC}[?1049h`;
const ALT_SCREEN_LEAVE = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_HOME = `${ESC}[2J${ESC}[H`;

/**
 * Run a live view against the real terminal: enter the alt-screen + hide the cursor, drive `runLiveView`,
 * and ALWAYS restore (leave alt-screen, show cursor) — including on Ctrl-C (SIGINT), which would otherwise
 * bypass the `finally`. Node-only. Ctrl-C is how the user quits a never-ending stream.
 */
export async function runLiveTerminal<T>(
	opts: Omit<RunLiveViewOptions<T>, "output"> & { write?: (bytes: string) => void },
): Promise<readonly T[]> {
	const write = opts.write ?? ((bytes: string): void => void process.stdout.write(bytes));
	const restore = (): void => write(SHOW_CURSOR + ALT_SCREEN_LEAVE);
	const onSigint = (): void => {
		restore();
		process.exit(0);
	};
	write(ALT_SCREEN_ENTER + HIDE_CURSOR);
	process.on("SIGINT", onSigint);
	try {
		return await runLiveView({ ...opts, output: (frame) => write(CLEAR_HOME + frame) });
	} finally {
		process.off("SIGINT", onSigint);
		restore();
	}
}
