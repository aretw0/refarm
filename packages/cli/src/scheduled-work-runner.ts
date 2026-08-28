import { declaredBase } from "@refarm.dev/config";
import {
	executeDueLocalScheduledWork,
	type LocalEffortSubmitAdapter,
	type LocalScheduledWorkExecutionReport,
	type LocalScheduledWorkFiredLedger,
} from "@refarm.dev/windmill/local-scheduler";
import { createLocalSchedulerLedger } from "@refarm.dev/windmill/local-scheduler-ledger";
import {
	describeScheduledWorkSources,
	type ScheduledWorkSource,
} from "./scheduled-work-sources.js";


import {
	createNodeAutomationAdapter,
	createProjectAutomationAdapter,
} from "./project-automations.js";

export const DEFAULT_SCHEDULED_WORK_OWNER = "refarm-main";

export interface RunDueScheduledWorkOptions {
	/** Project root; the project store (`.project/`) and ledger (`.refarm/`) resolve under it. */
	cwd?: string;
	/** Ledger owner recorded on every job. Defaults to {@link DEFAULT_SCHEDULED_WORK_OWNER}. */
	owner?: string;
	/** Clock override for due-ness and fire windows. Defaults to the real clock. */
	now?: string | Date;
	/**
	 * Where fired Efforts go. The daemon injects its real transport; tests inject
	 * a fake. Required — this helper never invents a transport.
	 */
	effortAdapter: LocalEffortSubmitAdapter;
	/**
	 * Fire-once ledger. Defaults to the `.refarm/scheduler/ledger.json` runtime
	 * store under `cwd`, so repeated ticks are idempotent out of the box. Inject
	 * a different ledger (e.g. in-memory) to isolate a test.
	 */
	ledger?: LocalScheduledWorkFiredLedger;
	/**
	 * The node's base — where the fire-once ledger and the node's own automations live.
	 *
	 * SEPARATE FROM `cwd` ON PURPOSE. `cwd` says which project's automations to read; this says
	 * which NODE is doing the work, and the two are different questions that were one field until
	 * ISS-075. A test that wants everything under one temporary directory passes both.
	 */
	base?: string;
}

/**
 * Tick the local scheduler once: read due automations from the `.project/`
 * store, ask the project adapter to build each Effort, submit it through the
 * injected effort adapter, and record the fire in the `.refarm/` ledger so the
 * next tick does not re-fire it.
 *
 * This is the composable seam shared by every caller. A `refarm` operator
 * command and the farmhand daemon loop both call this with their own effort
 * adapter; the composition (project adapter + ledger + engine) lives here once.
 */
/**
 * The execution report PLUS what it read to produce it.
 *
 * The windmill report answers "what fired". It cannot answer "over what", because the merged
 * adapter it receives has already lost the two scopes' identities — and a report of all zeros is
 * the same line whether nothing was due, nothing was declared, or nothing was found (ISS-175).
 * The sources are attached HERE because this is the layer that resolved `base` and `cwd`.
 */
export interface DueScheduledWorkReport extends LocalScheduledWorkExecutionReport {
	readonly sources: ScheduledWorkSource[];
}

export async function runDueScheduledWork(
	options: RunDueScheduledWorkOptions,
): Promise<DueScheduledWorkReport> {
	if (!options?.effortAdapter) {
		throw new Error("runDueScheduledWork requires an effortAdapter");
	}
	// os-resolution: project — runs work declared by the project the operator is standing in
	const cwd = options.cwd ?? process.cwd();
	const owner = options.owner ?? DEFAULT_SCHEDULED_WORK_OWNER;
	// BOTH SCOPES, one pass (spec D8, ISS-075). The executor does not fork — the node's loop runs
	// everything — but what is declared follows its subject: a nightly job about a vault is the
	// vault's, a restart is the node's, and the node has no repository to be found from.
	const base = options.base ?? declaredBase();
	const automationAdapter = mergeAutomationAdapters(
		createNodeAutomationAdapter({ base }),
		createProjectAutomationAdapter({ cwd }),
	);
	// THE LEDGER IS THE NODE'S, not the working directory's. "This node already fired that
	// window" is a fact about the machine: a node automation ticked from two different
	// directories would otherwise consult two ledgers and fire twice, which is precisely the
	// duplication the fire-once ledger exists to prevent.
	const ledger = options.ledger ?? createLocalSchedulerLedger({ cwd: base });

	const report = await executeDueLocalScheduledWork(automationAdapter, options.effortAdapter, {
		owner,
		now: options.now,
		ledger,
	});
	// DESCRIBED AFTER THE RUN, from the same `base` and `cwd` the adapters were built from, so a
	// reader of the report can tell an empty tick from a blind one.
	return { ...report, sources: describeScheduledWorkSources({ base, cwd }) };
}

/**
 * One adapter over several, in precedence order.
 *
 * `query` concatenates; `get` and `trigger` ask each in turn and take the first that answers. An
 * id present in more than one scope therefore resolves to the FIRST — the node's — and that is
 * stated rather than left to be discovered. Automation ids are urns and are meant to be unique
 * across a node; two scopes sharing one is a declaration mistake, not a routing decision this
 * function should be making silently.
 *
 * A merged adapter rather than two runs: two runs means two reports, two ledger passes, and a
 * caller stitching them back together — three places for the halves to disagree about what fired.
 */
export function mergeAutomationAdapters(
	...adapters: ReturnType<typeof createProjectAutomationAdapter>[]
): ReturnType<typeof createProjectAutomationAdapter> {
	// The adapter surface the scheduler actually consumes is `query` + `trigger`; there is no `get`
	// on it, and adding one here would be inventing a method for a caller that does not exist.
	return {
		async query(filter?: { status?: string }) {
			const results = await Promise.all(adapters.map((adapter) => adapter.query(filter)));
			return results.flat();
		},
		async trigger(id: string, input?: unknown) {
			for (const adapter of adapters) {
				const effort = await adapter.trigger(id, input);
				if (effort) return effort;
			}
			return null;
		},
	} as ReturnType<typeof createProjectAutomationAdapter>;
}
