import { AGENT_RESPOND_FN, taskWorkClass, type TaskWorkClass } from "@refarm.dev/effort-contract-v1";

import type { ProjectAutomationBody } from "./project-automations.js";

/**
 * WHAT AN AUTOMATION ACTUALLY DOES, declared without hand-editing JSON.
 *
 * Before this, every automation the `automations add` writer could author got the default empty
 * body and fired an effort with `tasks: []` — measured 2026-08-27 on the very effort that
 * proved the supervised clock works. The clock ran, the ledger recorded, and nothing happened.
 * The DOCUMENT language already carried effort templates and plugin bodies; only the writer
 * could not express them (ISS-176).
 *
 * TWO SHAPES, because the host has two and the operator budgets along that line:
 *
 *   ask       -> a `respond` task: the agent's prompt turn, a MODEL call that spends quota
 *   dispatch  -> any other verb on a plugin: ordinary computation
 *
 * The split is not invented here. `taskWorkClass` is the host's own rule, guarded against the
 * Rust that owns it, so an operator declaring work sees the same classification the runtime will
 * apply when it fires.
 */
export interface AutomationWorkInput {
	/** A prompt for the agent — becomes a `respond` task. */
	readonly ask?: string;
	/** `<pluginId>:<verb>` — becomes a task with that verb. Repeatable. */
	readonly dispatch?: readonly string[];
	/** Parsed JSON args, positionally matched to `dispatch`. */
	readonly args?: readonly unknown[];
	/** Which plugin answers an `ask`. The node's default responder; `agent` when unknown. */
	readonly responder?: string;
	/** Human label for the effort. Defaults to the automation's own name. */
	readonly direction: string;
	/** The automation's id, used for the effort tag and stable task ids. */
	readonly automationId: string;
}

export interface AutomationWorkTask {
	readonly id: string;
	readonly pluginId: string;
	readonly fn: string;
	readonly args?: unknown;
	/** Which resource this task spends, decided by the host's rule. */
	readonly workClass: TaskWorkClass;
}

export const DEFAULT_RESPONDER_PLUGIN_ID = "agent";

/** PURE. Split `<pluginId>:<verb>`; a missing colon is the caller's error, not a guess. */
export function parseDispatchTarget(target: string): { pluginId: string; fn: string } {
	const trimmed = target.trim();
	const separator = trimmed.lastIndexOf(":");
	// LAST colon, not the first: a scoped plugin id (`@refarm/agent`) has no colon, but a future
	// one might, and the verb is the tail either way.
	if (separator <= 0 || separator === trimmed.length - 1) {
		throw new Error(
			`--dispatch expects "<pluginId>:<verb>", got "${target}". Example: agent:ingest`,
		);
	}
	return { pluginId: trimmed.slice(0, separator), fn: trimmed.slice(separator + 1) };
}

/**
 * PURE. The tasks an automation will submit, with each one's cost class.
 *
 * Returns `[]` when no work was declared — which is the pre-existing behaviour and stays
 * expressible, because an automation that only marks a moment is a legitimate thing to declare.
 */
export function automationWorkTasks(input: AutomationWorkInput): AutomationWorkTask[] {
	const tasks: AutomationWorkTask[] = [];
	const ask = input.ask?.trim();
	if (ask) {
		tasks.push({
			id: `${input.automationId}:ask`,
			pluginId: input.responder?.trim() || DEFAULT_RESPONDER_PLUGIN_ID,
			fn: AGENT_RESPOND_FN,
			// `prompt` is what the sidecar's `extract_task_args` requires by name; a task that
			// spelled it otherwise would be accepted here and fail at fire time, unattended.
			args: { prompt: ask },
			workClass: taskWorkClass(AGENT_RESPOND_FN),
		});
	}
	(input.dispatch ?? []).forEach((target, index) => {
		const { pluginId, fn } = parseDispatchTarget(target);
		const args = input.args?.[index];
		tasks.push({
			id: `${input.automationId}:${fn}:${index}`,
			pluginId,
			fn,
			...(args === undefined ? {} : { args }),
			workClass: taskWorkClass(fn),
		});
	});
	return tasks;
}

/** PURE. The `static` body for declared work, or `undefined` when none was declared. */
export function automationBodyFromWork(
	input: AutomationWorkInput,
): ProjectAutomationBody | undefined {
	const tasks = automationWorkTasks(input);
	if (tasks.length === 0) return undefined;
	return {
		type: "static",
		effort: {
			direction: input.direction,
			tasks: tasks.map(({ workClass: _workClass, ...task }) => task),
			source: "project-automations",
			tags: ["project-automation", input.automationId],
		},
	};
}

/** PURE. What an already-written body will spend, for `list` and for the write receipt. */
export function bodyWorkClasses(body: unknown): TaskWorkClass[] {
	if (!body || typeof body !== "object") return [];
	const record = body as { type?: unknown; effort?: { tasks?: unknown } };
	if (record.type !== "static" || !Array.isArray(record.effort?.tasks)) return [];
	return record.effort.tasks.map((task) =>
		taskWorkClass(
			typeof task === "object" && task !== null && typeof (task as { fn?: unknown }).fn === "string"
				? (task as { fn: string }).fn
				: undefined,
		),
	);
}
