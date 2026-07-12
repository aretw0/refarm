import readline from "node:readline";

import { cancelEffortViaSidecar, type CancelEffortResult } from "./cancel-effort.js";

/**
 * ESC-TO-CANCEL for the chat REPL — arms a raw keypress listener that fires when the
 * user presses Escape while an agent turn is in flight, so a long/wedged turn can be
 * interrupted WITHOUT killing the whole session (that is what Ctrl-C/SIGINT does). This
 * is the terminal surface's projection of the substrate's cancel primitive
 * (`POST /efforts/:id/cancel`, the real WASM epoch-interrupt): a surface-thin binding,
 * exactly the multi-surface doctrine — the mechanism lives in the runtime, each surface
 * just wires its own gesture (ESC here, a button on the web) to it.
 *
 * The readline interface is PAUSED during a turn (chat.ts pauses before runTurn), so its
 * `line` events don't fire — we listen for raw keypresses on stdin only for the turn's
 * duration and detach on disarm. Kept as its own tested unit so the REPL stays a thin
 * caller and the arm/detach/idempotency logic is verifiable without a TTY.
 */

/** A minimal stdin surface — the bits we use, so tests pass a fake EventEmitter. */
export interface KeypressStdin {
	on(event: "keypress", listener: (str: string, key: KeypressKey) => void): unknown;
	off(event: "keypress", listener: (str: string, key: KeypressKey) => void): unknown;
	isTTY?: boolean;
	setRawMode?(mode: boolean): unknown;
}

/** The shape node's readline keypress emits (only `name` matters to us). */
export interface KeypressKey {
	name?: string;
}

export interface ArmEscapeCancelOptions {
	stdin?: KeypressStdin;
	/** Called on the FIRST Escape press. Subsequent presses within the same arm are
	 * ignored (a cancel is in flight — no point spamming). */
	onEscape: () => void;
	/** Inject keypress-event setup (default: node readline.emitKeypressEvents). */
	emitKeypressEvents?: (stdin: KeypressStdin) => void;
}

/**
 * Arm the Escape listener; returns a `disarm()` that removes it (and restores stdin
 * mode). Idempotent: `disarm()` is safe to call more than once, and only the first
 * Escape triggers `onEscape`. Returns a no-op disarm when stdin can't emit keypresses
 * (non-TTY / piped input) — ESC-cancel is a TTY affordance, absence is not an error.
 */
export function armEscapeCancel(options: ArmEscapeCancelOptions): () => void {
	const stdin = options.stdin ?? (process.stdin as unknown as KeypressStdin);
	// No TTY → no interactive keypresses to listen for. Return a no-op so callers are
	// unconditional.
	if (stdin.isTTY === false) return () => {};

	const emit = options.emitKeypressEvents ?? defaultEmitKeypressEvents;
	// Setting up keypress emission can fail in environments where readline is mocked or
	// stdin isn't a real stream (tests, odd hosts). ESC-cancel is a nicety, never a
	// requirement — degrade to a no-op rather than break the REPL turn.
	try {
		emit(stdin);
	} catch {
		return () => {};
	}

	let fired = false;
	let disarmed = false;
	const listener = (_str: string, key: KeypressKey) => {
		if (key?.name === "escape" && !fired) {
			fired = true;
			options.onEscape();
		}
	};
	stdin.on("keypress", listener);

	return () => {
		if (disarmed) return;
		disarmed = true;
		stdin.off("keypress", listener);
	};
}

function defaultEmitKeypressEvents(stdin: KeypressStdin): void {
	// `emitKeypressEvents` wants a NodeJS.ReadStream; our narrower type is a structural
	// subset, so the cast is safe for the runtime call. Guard the symbol too: a mocked
	// `node:readline` (in tests) may not provide it — treat that like any setup failure.
	if (typeof readline.emitKeypressEvents !== "function") {
		throw new Error("readline.emitKeypressEvents unavailable");
	}
	readline.emitKeypressEvents(stdin as unknown as NodeJS.ReadableStream & { on: never });
}

/**
 * The turn-scoped cancel controller the REPL uses: tracks the in-flight effort id and,
 * on Escape, cancels it over the sidecar. `setEffortId` is called once the turn's effort
 * is submitted; `onEscape` no-ops until then (nothing to cancel yet). Returns the cancel
 * result via `onResult` so the REPL can print an honest line ("Cancelled." vs "already
 * finished"). Everything is injectable for testing.
 */
export interface TurnCancelController {
	/** Record the effort id the current turn is running (enables ESC-cancel). */
	setEffortId(effortId: string): void;
	/** The Escape handler to hand to `armEscapeCancel`. */
	onEscape(): void;
	/** True once a cancel has been requested for this turn (so the REPL can note it). */
	wasRequested(): boolean;
}

export function createTurnCancelController(deps: {
	cancel?: (effortId: string) => Promise<CancelEffortResult>;
	onResult?: (result: CancelEffortResult) => void;
	env?: NodeJS.ProcessEnv;
}): TurnCancelController {
	const cancel = deps.cancel ?? ((id: string) => cancelEffortViaSidecar(id, { env: deps.env }));
	let effortId: string | null = null;
	let requested = false;
	return {
		setEffortId(id: string) {
			effortId = id;
		},
		onEscape() {
			if (!effortId || requested) return; // nothing in flight, or already cancelling
			requested = true;
			void cancel(effortId).then((result) => deps.onResult?.(result));
		},
		wasRequested() {
			return requested;
		},
	};
}
