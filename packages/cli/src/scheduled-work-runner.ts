import {
	executeDueLocalScheduledWork,
	type LocalEffortSubmitAdapter,
	type LocalScheduledWorkExecutionReport,
	type LocalScheduledWorkFiredLedger,
} from "@refarm.dev/windmill/local-scheduler";
import { createLocalSchedulerLedger } from "@refarm.dev/windmill/local-scheduler-ledger";
import { createProjectAutomationAdapter } from "./project-automations.js";

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
export async function runDueScheduledWork(
	options: RunDueScheduledWorkOptions,
): Promise<LocalScheduledWorkExecutionReport> {
	if (!options?.effortAdapter) {
		throw new Error("runDueScheduledWork requires an effortAdapter");
	}
	// os-resolution: project — runs work declared by the project the operator is standing in
	const cwd = options.cwd ?? process.cwd();
	const owner = options.owner ?? DEFAULT_SCHEDULED_WORK_OWNER;
	const automationAdapter = createProjectAutomationAdapter({ cwd });
	const ledger = options.ledger ?? createLocalSchedulerLedger({ cwd });

	return executeDueLocalScheduledWork(automationAdapter, options.effortAdapter, {
		owner,
		now: options.now,
		ledger,
	});
}
