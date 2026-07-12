/**
 * Process ACTIVITY — the surface-neutral "something is working" signal.
 *
 * The operator gap this closes: any long-running work (a provider login, a git
 * clone, a build, a network fetch, a plugin dispatch, an agent turn) leaves the
 * operator staring at a frozen surface with no sense that anything is happening.
 * This is NOT agent-specific: the mechanism does not know (or care) whether the
 * work is an agent turn or a Codex login — it only knows "work X started / is
 * progressing / finished." Any code wraps its work in `withActivity` and every
 * surface that subscribes to the sink can render a "working" affordance.
 *
 * It belongs to the capability MODEL (this ZERO-dependency kernel), not to any one
 * surface — exactly like the result envelope and the surface-model. A surface
 * (CLI spinner, TUI indicator, web pill) is a SUBSCRIBER that renders the event
 * however it likes; the emitter is origin-agnostic. A daemon-side bridge can feed
 * the SAME sink from the telemetry bus, so remote work (an agent turn in the
 * runtime) and local work (a CLI login) light up the operator's surface
 * identically, without the renderer knowing the difference.
 */

/** The kind of work — a free, open vocabulary (auth, git, build, network, dispatch,
 * agent, task…). Surfaces MAY use it to pick an icon/label; the core never branches
 * on it, so a new kind needs no code change (it is data, not a type). */
export type ActivityKind = string;

/** The lifecycle phase of a unit of work. `started`/`finished` are the core every
 * process emits; `progress` is OPTIONAL — a process emits it only when it has
 * something to report (a step, a note, a fraction). */
export type ActivityPhase = "started" | "progress" | "finished";

/**
 * One activity event. `activityRef` correlates the started→progress*→finished of a
 * single unit of work (like a prompt_ref), so a surface can track concurrent
 * activities independently. Neutral: no surface or process-type is baked in.
 */
export interface ProcessActivity {
	/** Correlates all events of ONE unit of work. */
	activityRef: string;
	phase: ActivityPhase;
	/** Human-facing label ("Signing in to Codex", "Cloning repo", "Agent responding"). */
	label: string;
	/** The work kind (open vocabulary), for surfaces that vary the affordance by type. */
	kind: ActivityKind;
	/** progress only: a short note on the current step ("exchanging token…"). */
	note?: string;
	/** progress only: 0..1 completion, when the process can estimate it. */
	fraction?: number;
	/** finished only: whether the work succeeded. */
	ok?: boolean;
}

/** A subscriber called for every activity event. */
export type ActivityListener = (event: ProcessActivity) => void;

/** Unsubscribe a previously-registered listener. */
export type Unsubscribe = () => void;

/**
 * The in-process activity bus: processes `emit` events, surfaces `subscribe`. A tiny
 * synchronous fan-out (no external deps) — a listener that throws must not break
 * emission for the others (a broken renderer can't stall the work), so throws are
 * swallowed per-listener.
 */
export class ActivitySink {
	private listeners = new Set<ActivityListener>();

	/** Register a listener; returns an unsubscribe. */
	subscribe(listener: ActivityListener): Unsubscribe {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Publish an event to every current listener (a throwing listener is isolated). */
	emit(event: ProcessActivity): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// A broken subscriber must not stall the work or the other subscribers.
			}
		}
	}

	/** Current subscriber count — for tests / diagnostics. */
	get listenerCount(): number {
		return this.listeners.size;
	}
}

/**
 * The AMBIENT sink — a process-wide default so callers can `withActivity(...)` without
 * threading a sink through every layer, and a surface can subscribe once at startup.
 * Tests (and any code that wants isolation) pass their own `ActivitySink` explicitly.
 */
export const ambientActivitySink = new ActivitySink();

/** Monotonic-ish counter for activityRef uniqueness within a process. Combined with a
 * random suffix so two processes (or a restart) don't collide. */
let activityCounter = 0;

/** Mint a fresh correlation ref for one unit of work. */
export function newActivityRef(): string {
	activityCounter += 1;
	const rand = Math.random().toString(36).slice(2, 8);
	return `activity-${activityCounter}-${rand}`;
}

/** The reporter handed to a `withActivity` body so it can emit OPTIONAL progress
 * ticks. A no-op-safe call: `report("exchanging token")` or `report("uploading", 0.4)`. */
export type ActivityReporter = (note: string, fraction?: number) => void;

export interface WithActivityOptions {
	/** The work kind (open vocabulary). Defaults to "task". */
	kind?: ActivityKind;
	/** The sink to emit on. Defaults to the ambient sink. */
	sink?: ActivitySink;
	/** A pre-minted activityRef (rare — e.g. to correlate with an existing prompt_ref).
	 * Defaults to a fresh `newActivityRef()`. */
	activityRef?: string;
}

/**
 * Wrap a unit of work so the surfaces show it as "working": emits `started` before
 * `fn` runs, `finished{ok}` after (even if `fn` throws — the operator must never see a
 * spinner that never stops), and hands `fn` an optional `report` for progress ticks.
 * Returns whatever `fn` returns. This is the ONE call any process uses — no matter the
 * surface, no matter the work type.
 *
 *   await withActivity("Signing in to Codex", () => codexLogin(), { kind: "auth" });
 *   await withActivity("Agent responding", async (report) => {
 *     report("iterating");
 *     return runTurn();
 *   }, { kind: "agent" });
 */
export async function withActivity<T>(
	label: string,
	fn: (report: ActivityReporter) => T | Promise<T>,
	options: WithActivityOptions = {},
): Promise<T> {
	const sink = options.sink ?? ambientActivitySink;
	const kind = options.kind ?? "task";
	const activityRef = options.activityRef ?? newActivityRef();

	sink.emit({ activityRef, phase: "started", label, kind });
	const report: ActivityReporter = (note, fraction) => {
		sink.emit({ activityRef, phase: "progress", label, kind, note, fraction });
	};

	try {
		const result = await fn(report);
		sink.emit({ activityRef, phase: "finished", label, kind, ok: true });
		return result;
	} catch (error) {
		sink.emit({ activityRef, phase: "finished", label, kind, ok: false });
		throw error;
	}
}
