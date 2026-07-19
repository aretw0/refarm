/**
 * The interactive loop for a laid-out terminal face — the "input + focus + redraw" half the layout
 * engine deliberately leaves out. `runInteractiveLayout` is the PURE core (input + output injected), so
 * it is unit-testable headless with scripted keys; `createStdinInput` + `runInteractiveTerminal` are the
 * node-only wiring (raw-mode stdin, alt-screen, cursor) that the pure core drives. Brand-neutral.
 */
import { moveFocus, type FocusTarget } from "./tui-focus.js";
import type { Key, TerminalInput } from "./tui-input.js";
import readline from "node:readline";

export interface RunInteractiveLayoutOptions {
	/** The focus targets to navigate (from `focusOrder(positioned)`). */
	targets: FocusTarget[];
	/** Produce the frame for a focus state — the app decides how to highlight the focused id. */
	render: (focusedId: string | null) => string | Promise<string>;
	/** Key source (injectable — `scriptedInput` for tests, `createStdinInput` for a real terminal). */
	input: TerminalInput;
	/** Write a rendered frame (injectable; default writes to stdout). */
	output?: (frame: string) => void;
	/** Fires when Enter is pressed on the focused target. Return `false` to exit the loop. */
	onSelect?: (id: string) => void | boolean | Promise<void | boolean>;
	/** Initial focus (default: the first target). */
	initialFocusId?: string;
}

/**
 * Drive an interactive laid-out face: render, read a key, move focus (repaint on change), fire
 * `onSelect` on Enter, exit on Escape / Ctrl-C / exhausted input. PURE given injected input+output —
 * no terminal control here. Returns the last-focused id.
 */
export async function runInteractiveLayout(opts: RunInteractiveLayoutOptions): Promise<string | null> {
	const output = opts.output ?? ((frame: string) => void process.stdout.write(frame));
	let focusedId = opts.initialFocusId ?? opts.targets[0]?.id ?? null;

	output(await opts.render(focusedId));
	for (;;) {
		const key = await opts.input.readKey();
		if (!key) break; // input exhausted → leave
		if (key.name === "escape" || (key.ctrl && key.name === "c")) break;
		if (key.name === "return") {
			if (focusedId !== null && opts.onSelect) {
				const keep = await opts.onSelect(focusedId);
				if (keep === false) break;
			}
			output(await opts.render(focusedId));
			continue;
		}
		const next = moveFocus(opts.targets, focusedId, key);
		if (next !== focusedId) {
			focusedId = next;
			output(await opts.render(focusedId));
		}
	}
	return focusedId;
}

const ESC = String.fromCharCode(27);
const ALT_SCREEN_ENTER = `${ESC}[?1049h`;
const ALT_SCREEN_LEAVE = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_HOME = `${ESC}[2J${ESC}[H`;

/** A raw-mode key source over `process.stdin` — the real terminal input the loop reads. Node-only:
 * enables keypress events + raw mode, queues keys, restores the terminal on `close()`. */
export function createStdinInput(stdin: NodeJS.ReadStream = process.stdin): TerminalInput {
	readline.emitKeypressEvents(stdin);
	if (stdin.isTTY) stdin.setRawMode(true);
	stdin.resume();

	const queue: Key[] = [];
	const waiters: Array<(key: Key | null) => void> = [];
	let closed = false;

	const onKeypress = (
		_str: string,
		key: { name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean; sequence?: string } | undefined,
	): void => {
		const normalized: Key = {
			name: key?.name ?? "",
			ctrl: Boolean(key?.ctrl),
			shift: Boolean(key?.shift),
			meta: Boolean(key?.meta),
			...(key?.sequence !== undefined ? { sequence: key.sequence } : {}),
		};
		const waiter = waiters.shift();
		if (waiter) waiter(normalized);
		else queue.push(normalized);
	};
	stdin.on("keypress", onKeypress);

	return {
		readKey: () =>
			new Promise<Key | null>((resolve) => {
				const next = queue.shift();
				if (next) resolve(next);
				else if (closed) resolve(null);
				else waiters.push(resolve);
			}),
		close: () => {
			if (closed) return;
			closed = true;
			stdin.off("keypress", onKeypress);
			if (stdin.isTTY) stdin.setRawMode(false);
			stdin.pause();
			while (waiters.length) waiters.shift()?.(null);
		},
	};
}

export interface RunInteractiveTerminalOptions extends Omit<RunInteractiveLayoutOptions, "input" | "output"> {
	/** Write raw terminal bytes (injectable for tests; default = stdout). */
	write?: (bytes: string) => void;
}

/**
 * Frame an interactive loop against the real terminal: create a raw-mode stdin source, enter the
 * alt-screen + hide the cursor, run `run(input, output)` (output clears + paints a frame), and ALWAYS
 * restore (leave alt-screen, show cursor, close input) even on throw. The shared node-only wrapper both
 * the focus loop and the input form drive.
 */
export async function withInteractiveTerminal<T>(
	run: (input: TerminalInput, output: (frame: string) => void) => Promise<T>,
	rawWrite: (bytes: string) => void = (bytes: string) => void process.stdout.write(bytes),
	input: TerminalInput = createStdinInput(),
): Promise<T> {
	rawWrite(ALT_SCREEN_ENTER + HIDE_CURSOR);
	try {
		return await run(input, (frame) => rawWrite(CLEAR_HOME + frame));
	} finally {
		input.close();
		rawWrite(SHOW_CURSOR + ALT_SCREEN_LEAVE);
	}
}

/**
 * Run an interactive laid-out face against the real terminal: alt-screen + raw-mode stdin drive
 * `runInteractiveLayout`, always restoring on exit. Node-only. Returns the last-focused id.
 */
export async function runInteractiveTerminal(opts: RunInteractiveTerminalOptions): Promise<string | null> {
	return withInteractiveTerminal(
		(input, output) =>
			runInteractiveLayout({
				targets: opts.targets,
				render: opts.render,
				input,
				output,
				...(opts.onSelect ? { onSelect: opts.onSelect } : {}),
				...(opts.initialFocusId !== undefined ? { initialFocusId: opts.initialFocusId } : {}),
			}),
		opts.write,
	);
}
