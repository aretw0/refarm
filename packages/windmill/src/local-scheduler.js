export const LOCAL_SCHEDULED_WORK_SCHEMA_VERSION = 1;

const SUPPORTED_SCHEDULE_TRIGGERS = new Set(["once", "cron"]);

/**
 * @typedef {"due" | "scheduled" | "unsupported"} LocalScheduledJobStatus
 * @typedef {"one-shot" | "recurring"} LocalScheduledJobKind
 * @typedef {{ type: "once", at: string } | { type: "cron", schedule: string, timezone: string }} LocalScheduledJobSchedule
 * @typedef {{ visible: true, summary: string }} LocalScheduledJobResume
 * @typedef {{ type: "once", at: string } | { type: "cron", schedule: string, timezone?: string }} LocalScheduledTrigger
 * @typedef {{ id: string, name: string, description?: string, triggers: LocalScheduledTrigger[] }} LocalScheduledAutomation
 * @typedef {{ query(filter?: { status?: string }): Promise<LocalScheduledAutomation[]> }} LocalAutomationQueryAdapter
 * @typedef {LocalAutomationQueryAdapter & { trigger(id: string, input?: unknown): Promise<unknown | null> }} LocalAutomationExecutionAdapter
 * @typedef {{ submit(effort: unknown): Promise<string> }} LocalEffortSubmitAdapter
 *
 * Fire-once ledger. The engine consults `hasFired` before firing a due job and
 * calls `recordFired` after a successful submit. Keyed by a stable per-window
 * fire key (see {@link fireKeyForJob}), so a one-shot job fires at most once
 * ever and a recurring cron job fires at most once per due window. The ledger
 * is host-owned durable state - the caller (farmhand, CLI) binds it to a store
 * such as `.project/automations.json`. Omitting it preserves the pre-ledger
 * behavior: every due job fires on every tick.
 * @typedef {{ hasFired(key: string): boolean | Promise<boolean>, recordFired(key: string, receipt: { job: LocalScheduledJob, firedAt: string, effortId?: string }): void | Promise<void> }} LocalScheduledWorkFiredLedger
 *
 * @typedef {{ owner: string, now?: string | Date }} LocalScheduledWorkOptions
 * @typedef {{ owner: string, now?: string | Date, ledger?: LocalScheduledWorkFiredLedger }} LocalScheduledWorkExecutionOptions
 * @typedef {{ total: number, due: number, scheduled: number, unsupported: number }} LocalScheduledWorkSummary
 * @typedef {{ schemaVersion: 1, id: string, automationId: string, name: string, description?: string, owner: string, kind: LocalScheduledJobKind, status: LocalScheduledJobStatus, schedule: LocalScheduledJobSchedule, fireKey: string, unsupportedReason?: string, modelRoute: "none", tokenUse: "none", resume: LocalScheduledJobResume }} LocalScheduledJob
 * @typedef {{ schemaVersion: 1, owner: string, generatedAt: string, summary: LocalScheduledWorkSummary, jobs: LocalScheduledJob[] }} LocalScheduledWorkInspection
 * @typedef {"submitted" | "skipped" | "already-fired" | "failed"} LocalScheduledWorkExecutionStatus
 * @typedef {{ schemaVersion: 1, job: LocalScheduledJob, status: LocalScheduledWorkExecutionStatus, effortId?: string, firedAt?: string, error?: string }} LocalScheduledWorkExecutionResult
 * @typedef {{ schemaVersion: 1, owner: string, generatedAt: string, summary: { due: number, submitted: number, skipped: number, alreadyFired: number, failed: number }, results: LocalScheduledWorkExecutionResult[] }} LocalScheduledWorkExecutionReport
 * @typedef {{ schemaVersion: 1, list(options?: Partial<LocalScheduledWorkOptions>): Promise<LocalScheduledJob[]>, inspect(options?: Partial<LocalScheduledWorkOptions>): Promise<LocalScheduledWorkInspection>, due(options?: Partial<LocalScheduledWorkOptions>): Promise<LocalScheduledJob[]> }} LocalScheduledWork
 */

function assertAdapter(adapter) {
	if (!adapter || typeof adapter.query !== "function") {
		throw new Error("Local scheduled work requires an AutomationAdapter with query() support");
	}
}

function assertExecutionAdapter(adapter) {
	assertAdapter(adapter);
	if (typeof adapter.trigger !== "function") {
		throw new Error(
			"Local scheduled work execution requires an AutomationAdapter with trigger() support",
		);
	}
}

function assertEffortSubmitAdapter(adapter) {
	if (!adapter || typeof adapter.submit !== "function") {
		throw new Error(
			"Local scheduled work execution requires an Effort adapter with submit() support",
		);
	}
}

function assertOwner(owner) {
	if (typeof owner !== "string" || owner.trim().length === 0) {
		throw new Error("Local scheduled work requires a non-empty owner");
	}
	return owner.trim();
}

function parseDate(value) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function resolveNow(value) {
	const now = value ? new Date(value) : new Date();
	if (Number.isNaN(now.getTime())) {
		throw new Error("Local scheduled work requires options.now to be a valid date");
	}
	return now;
}

function matchCronField(field, value, maxValue) {
	if (field === "*") return true;
	if (field.startsWith("*/")) {
		const step = Number(field.slice(2));
		return Number.isInteger(step) && step > 0 && value % step === 0;
	}
	if (field.includes(",")) {
		return field.split(",").some((part) => matchCronField(part, value, maxValue));
	}
	if (field.includes("-")) {
		const [start, end] = field.split("-").map(Number);
		return (
			Number.isInteger(start) &&
			Number.isInteger(end) &&
			start <= end &&
			value >= start &&
			value <= end
		);
	}
	const expected = Number(field);
	if (!Number.isInteger(expected)) return false;
	if (maxValue === 7 && expected === 7) return value === 0;
	return expected === value;
}

function inspectCronDue(schedule, now) {
	if (schedule === "@hourly") {
		return { supported: true, due: now.getUTCMinutes() === 0 };
	}
	if (schedule === "@daily") {
		return {
			supported: true,
			due: now.getUTCHours() === 0 && now.getUTCMinutes() === 0,
		};
	}
	if (schedule === "@weekly") {
		return {
			supported: true,
			due: now.getUTCDay() === 0 && now.getUTCHours() === 0 && now.getUTCMinutes() === 0,
		};
	}

	const fields = schedule.trim().split(/\s+/);
	if (fields.length !== 5) return { supported: false, due: false };

	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
	const minuteDue = matchCronField(minute, now.getUTCMinutes(), 59);
	const hourDue = matchCronField(hour, now.getUTCHours(), 23);
	const monthDue = matchCronField(month, now.getUTCMonth() + 1, 12);
	const domDue = matchCronField(dayOfMonth, now.getUTCDate(), 31);
	const dowDue = matchCronField(dayOfWeek, now.getUTCDay(), 7);
	const dayDue =
		dayOfMonth === "*" && dayOfWeek === "*"
			? true
			: dayOfMonth === "*"
				? dowDue
				: dayOfWeek === "*"
					? domDue
					: domDue || dowDue;

	return {
		supported: true,
		due: minuteDue && hourDue && monthDue && dayDue,
	};
}

function describeTrigger(trigger, now) {
	if (trigger.type === "once") {
		const at = parseDate(trigger.at);
		return {
			kind: "one-shot",
			schedule: { type: "once", at: trigger.at },
			status: at && at.getTime() <= now.getTime() ? "due" : "scheduled",
			unsupportedReason: at ? undefined : "invalid once.at timestamp",
		};
	}

	const cron = inspectCronDue(trigger.schedule, now);
	return {
		kind: "recurring",
		schedule: {
			type: "cron",
			schedule: trigger.schedule,
			timezone: trigger.timezone ?? "UTC",
		},
		status: cron.supported ? (cron.due ? "due" : "scheduled") : "unsupported",
		unsupportedReason: cron.supported ? undefined : "unsupported cron expression",
	};
}

/**
 * The UTC minute a tick falls in, as an ISO string truncated to the minute.
 * The scheduler decides due-ness at minute resolution, so this is the natural
 * fire window for recurring jobs.
 *
 * @param {Date} now
 * @returns {string}
 */
function fireWindowMinute(now) {
	return now.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

/**
 * A stable, per-job/per-window fire key.
 *
 * - one-shot: `automation:<id>:trigger:<index>:once:<at>` - fixed forever,
 *   so that job fires at most once.
 * - cron: `automation:<id>:trigger:<index>:cron:<schedule>:<window>` - one
 *   key per minute-window, so a recurring job fires at most once per window it
 *   is due in, and a skipped window is simply never keyed (no catch-up replay).
 *
 * @param {LocalScheduledAutomation} automation
 * @param {LocalScheduledTrigger} trigger
 * @param {number} triggerIndex
 * @param {Date} now
 * @returns {string}
 */
function fireKeyForJob(automation, trigger, triggerIndex, now) {
	const prefix = `automation:${automation.id}:trigger:${triggerIndex}`;
	if (trigger.type === "once") {
		return `${prefix}:once:${trigger.at}`;
	}
	return `${prefix}:cron:${trigger.schedule}:${fireWindowMinute(now)}`;
}

function toLocalScheduledJob(automation, trigger, triggerIndex, owner, now) {
	const detail = describeTrigger(trigger, now);
	return {
		schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
		id: `${automation.id}:${triggerIndex}`,
		automationId: automation.id,
		name: automation.name,
		description: automation.description,
		owner,
		kind: detail.kind,
		status: detail.unsupportedReason ? "unsupported" : detail.status,
		schedule: detail.schedule,
		fireKey: fireKeyForJob(automation, trigger, triggerIndex, now),
		unsupportedReason: detail.unsupportedReason,
		modelRoute: "none",
		tokenUse: "none",
		resume: {
			visible: true,
			summary: `${automation.name} owned by ${owner}`,
		},
	};
}

/**
 * Materialize active one-shot and recurring jobs without executing them.
 *
 * @param {LocalAutomationQueryAdapter} adapter
 * @param {Partial<LocalScheduledWorkOptions>} [options]
 * @returns {Promise<LocalScheduledJob[]>}
 */
export async function listLocalScheduledJobs(adapter, options = {}) {
	assertAdapter(adapter);
	const owner = assertOwner(options.owner);
	const now = resolveNow(options.now);
	const activeAutomations = await adapter.query({ status: "active" });

	return activeAutomations.flatMap((automation) =>
		automation.triggers
			.map((trigger, triggerIndex) => ({ trigger, triggerIndex }))
			.filter(({ trigger }) => SUPPORTED_SCHEDULE_TRIGGERS.has(trigger.type))
			.map(({ trigger, triggerIndex }) =>
				toLocalScheduledJob(automation, trigger, triggerIndex, owner, now),
			),
	);
}

/**
 * Return a resume-friendly inspection payload for local scheduled work.
 *
 * @param {LocalAutomationQueryAdapter} adapter
 * @param {Partial<LocalScheduledWorkOptions>} [options]
 * @returns {Promise<LocalScheduledWorkInspection>}
 */
export async function inspectLocalScheduledWork(adapter, options = {}) {
	const jobs = await listLocalScheduledJobs(adapter, options);
	const summary = {
		total: jobs.length,
		due: jobs.filter((job) => job.status === "due").length,
		scheduled: jobs.filter((job) => job.status === "scheduled").length,
		unsupported: jobs.filter((job) => job.status === "unsupported").length,
	};

	return {
		schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
		owner: assertOwner(options.owner),
		generatedAt: resolveNow(options.now).toISOString(),
		summary,
		jobs,
	};
}

function assertLedger(ledger) {
	if (ledger === undefined) return undefined;
	if (
		!ledger ||
		typeof ledger.hasFired !== "function" ||
		typeof ledger.recordFired !== "function"
	) {
		throw new Error("Local scheduled work ledger requires hasFired() and recordFired() support");
	}
	return ledger;
}

/**
 * Trigger and submit currently due local scheduled work.
 *
 * This is a host-owned tick helper: it decides due-ness, asks the automation
 * adapter to build an Effort, and submits that Effort through the provided
 * effort adapter. It does not own daemon timing.
 *
 * When an optional fire-once ledger is supplied via `options.ledger`, a job
 * whose fire key is already recorded is reported as `already-fired` and is
 * neither triggered nor submitted; a job that submits successfully is recorded
 * before the next tick can see it. This makes repeated ticks idempotent: a
 * one-shot fires at most once ever, and a recurring cron job fires at most once
 * per due window. Without a ledger the helper preserves its original behavior
 * and fires every due job on every tick - safe only for a single tick.
 *
 * @param {LocalAutomationExecutionAdapter} automationAdapter
 * @param {LocalEffortSubmitAdapter} effortAdapter
 * @param {Partial<LocalScheduledWorkExecutionOptions>} [options]
 * @returns {Promise<LocalScheduledWorkExecutionReport>}
 */
export async function executeDueLocalScheduledWork(automationAdapter, effortAdapter, options = {}) {
	assertExecutionAdapter(automationAdapter);
	assertEffortSubmitAdapter(effortAdapter);
	const ledger = assertLedger(options.ledger);
	const owner = assertOwner(options.owner);
	const now = resolveNow(options.now);
	const firedAt = now.toISOString();
	const jobs = await listLocalScheduledJobs(automationAdapter, { owner, now });
	const dueJobs = jobs.filter((job) => job.status === "due");
	const results = [];

	for (const job of dueJobs) {
		try {
			if (ledger && (await ledger.hasFired(job.fireKey))) {
				results.push({
					schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
					job,
					status: "already-fired",
				});
				continue;
			}

			const effort = await automationAdapter.trigger(job.automationId, {
				scheduledJob: job,
				firedAt,
				owner,
			});
			if (!effort) {
				results.push({
					schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
					job,
					status: "skipped",
					error: "automation returned no effort",
				});
				continue;
			}

			const effortId = await effortAdapter.submit(effort);
			// The effort has already been submitted. A ledger write failure here
			// must NOT re-classify the job as failed (that would double-fire next
			// tick); surface it as a submitted job carrying a ledger-write error so
			// the caller can reconcile the stale ledger without re-submitting.
			let ledgerError;
			if (ledger) {
				try {
					await ledger.recordFired(job.fireKey, { job, firedAt, effortId });
				} catch (error) {
					ledgerError = `fired but ledger write failed: ${
						error instanceof Error ? error.message : String(error)
					}`;
				}
			}
			results.push({
				schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
				job,
				status: "submitted",
				effortId,
				firedAt,
				...(ledgerError ? { error: ledgerError } : {}),
			});
		} catch (error) {
			results.push({
				schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
				job,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
		owner,
		generatedAt: firedAt,
		summary: {
			due: dueJobs.length,
			submitted: results.filter((result) => result.status === "submitted").length,
			skipped: results.filter((result) => result.status === "skipped").length,
			alreadyFired: results.filter((result) => result.status === "already-fired").length,
			failed: results.filter((result) => result.status === "failed").length,
		},
		results,
	};
}

/**
 * Create a small SDK facade around an AutomationAdapter-backed local scheduler.
 *
 * @param {LocalAutomationQueryAdapter} adapter
 * @param {Partial<LocalScheduledWorkOptions>} [defaults]
 * @returns {LocalScheduledWork}
 */
export function createLocalScheduledWork(adapter, defaults = {}) {
	return {
		schemaVersion: LOCAL_SCHEDULED_WORK_SCHEMA_VERSION,
		async list(options = {}) {
			return listLocalScheduledJobs(adapter, { ...defaults, ...options });
		},
		async inspect(options = {}) {
			return inspectLocalScheduledWork(adapter, { ...defaults, ...options });
		},
		async due(options = {}) {
			const jobs = await listLocalScheduledJobs(adapter, { ...defaults, ...options });
			return jobs.filter((job) => job.status === "due");
		},
	};
}
