/**
 * The input seam for interactive terminal faces — a key-event source the interactive loop reads. Kept
 * INJECTABLE (scripted keys) so a loop is testable headless with no TTY, mirroring how `TuiIo` injects
 * lines. The real raw-mode stdin source lands with the loop that consumes it. Brand-neutral.
 */

/** A normalized key event — a semantic name, modifiers, and the raw sequence for anything the name
 * doesn't cover. Semantic names: "up" | "down" | "left" | "right" | "return" | "escape" | "tab" |
 * "space" | "backspace" | a single character | "" (unknown). */
export interface Key {
	name: string;
	ctrl?: boolean;
	shift?: boolean;
	meta?: boolean;
	/** The raw input sequence, for keys the semantic name does not cover. */
	sequence?: string;
}

/** A source of key events. `readKey` resolves the next key, or null when the source is exhausted/closed. */
export interface TerminalInput {
	readKey(): Promise<Key | null>;
	close(): void;
}

/** A scripted input over a fixed key list — the headless, deterministic source for tests and pipes:
 * yields each key in order, then null. `close()` exhausts it early. */
export function scriptedInput(keys: readonly Key[]): TerminalInput {
	let index = 0;
	return {
		readKey: () => Promise.resolve(index < keys.length ? keys[index++]! : null),
		close: () => {
			index = keys.length;
		},
	};
}
