export const PLAYBOOK_SCHEMA_VERSION = 1 as const;

/**
 * A PLAYBOOK — a declarative, multi-step sequence of capability/plugin verb calls where each
 * step's output can be threaded into the next. This is the missing layer above refarm's
 * canonical execution spine: a playbook does NOT run anything itself — its steps compile to
 * dispatch requests that the caller runs through the canonical `dispatch → Effort →
 * dispatch_to_plugin` protocol (an injected `DispatchStep`). So the playbook is pure data +
 * a pure interpreter; the real runtime, the agent tool surface, and the trigger/schedule
 * layer all stay exactly as they are.
 */
export interface Playbook {
	/** Schema version (defaults to PLAYBOOK_SCHEMA_VERSION on parse). */
	schemaVersion?: number;
	/** A human name for the playbook. */
	name: string;
	description?: string;
	/** The ordered steps. Each runs after the previous; a step may reference earlier results. */
	steps: PlaybookStep[];
}

export interface PlaybookStep {
	/** The verb to invoke, as `<pluginId>:<verb>` (the canonical dispatch target). */
	verb: string;
	/** Arguments for the verb. String values may contain `{{ path }}` references that are
	 * interpolated from the initial input and earlier steps' saved results before dispatch. */
	with?: Record<string, unknown>;
	/** Bind this step's result under this name, so later steps can reference `{{ name.… }}`. */
	saveAs?: string;
	/** An optional id for this step (defaults to its index) — used in results/diagnostics. */
	id?: string;
}

/** A dispatch request the interpreter emits per step — the shape `buildDispatchEffort` takes. */
export interface PlaybookDispatch {
	pluginId: string;
	verb: string;
	args: Record<string, unknown>;
}

/**
 * Runs ONE step's dispatch and returns its result. Injected: in production it builds a
 * dispatch Effort (buildDispatchEffort), submits it (SubmitEffort), and reads back the
 * correlated `dispatch-result` node by replyRef; in tests it's a fake that returns canned
 * results. The interpreter is agnostic to how a verb actually runs.
 */
export type DispatchStep = (request: PlaybookDispatch) => Promise<unknown>;

/** The result of one executed step. */
export interface PlaybookStepResult {
	id: string;
	verb: string;
	ok: boolean;
	result?: unknown;
	error?: string;
	savedAs?: string;
}

/** The result of running a whole playbook. */
export interface PlaybookRunResult {
	name: string;
	ok: boolean;
	steps: PlaybookStepResult[];
	/** The saved-result bindings at the end of the run (name → result). */
	bindings: Record<string, unknown>;
}

/** A structured parse/validation issue (hand-rolled validator, repo house style). */
export interface PlaybookIssue {
	path: string;
	code: string;
	message: string;
}
