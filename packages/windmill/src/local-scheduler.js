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
 * @typedef {{ owner: string, now?: string | Date }} LocalScheduledWorkOptions
 * @typedef {{ total: number, due: number, scheduled: number, unsupported: number }} LocalScheduledWorkSummary
 * @typedef {{ schemaVersion: 1, id: string, automationId: string, name: string, description?: string, owner: string, kind: LocalScheduledJobKind, status: LocalScheduledJobStatus, schedule: LocalScheduledJobSchedule, unsupportedReason?: string, modelRoute: "none", tokenUse: "none", resume: LocalScheduledJobResume }} LocalScheduledJob
 * @typedef {{ schemaVersion: 1, owner: string, generatedAt: string, summary: LocalScheduledWorkSummary, jobs: LocalScheduledJob[] }} LocalScheduledWorkInspection
 * @typedef {{ schemaVersion: 1, list(options?: Partial<LocalScheduledWorkOptions>): Promise<LocalScheduledJob[]>, inspect(options?: Partial<LocalScheduledWorkOptions>): Promise<LocalScheduledWorkInspection>, due(options?: Partial<LocalScheduledWorkOptions>): Promise<LocalScheduledJob[]> }} LocalScheduledWork
 */

function assertAdapter(adapter) {
	if (!adapter || typeof adapter.query !== "function") {
		throw new Error(
			"Local scheduled work requires an AutomationAdapter with query() support",
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
			due:
				now.getUTCDay() === 0 &&
				now.getUTCHours() === 0 &&
				now.getUTCMinutes() === 0,
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
		unsupportedReason: cron.supported
			? undefined
			: "unsupported cron expression",
	};
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
