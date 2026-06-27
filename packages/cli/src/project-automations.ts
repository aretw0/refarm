export const PROJECT_AUTOMATIONS_RELATIVE_PATH = ".project/automations.json";

export type ProjectAutomationStatus = "draft" | "ready" | "active" | "archived";

export interface ProjectAutomationManualTrigger {
	type: "manual";
}

export interface ProjectAutomationCronTrigger {
	type: "cron";
	schedule: string;
	timezone?: string;
}

export interface ProjectAutomationOnceTrigger {
	type: "once";
	at: string;
}

export interface ProjectAutomationEventTrigger {
	type: "event";
	eventType: string;
	filter?: Record<string, unknown>;
}

export type ProjectAutomationTrigger =
	| ProjectAutomationManualTrigger
	| ProjectAutomationCronTrigger
	| ProjectAutomationOnceTrigger
	| ProjectAutomationEventTrigger;

export interface ProjectAutomationRecord {
	id: string;
	name: string;
	description?: string;
	status: ProjectAutomationStatus;
	triggers: ProjectAutomationTrigger[];
	[key: string]: unknown;
}

export interface ProjectAutomationsDocument {
	automations: ProjectAutomationRecord[];
	[key: string]: unknown;
}

export interface ProjectAutomationAddInput {
	id: string;
	name: string;
	description?: string;
	status?: ProjectAutomationStatus;
	trigger: ProjectAutomationTrigger;
}

export interface ProjectAutomationStatusUpdateInput {
	id: string;
	status: ProjectAutomationStatus;
}

export type ProjectAutomationIssueSeverity = "error" | "warning";

export interface ProjectAutomationValidationIssue {
	path: string;
	code: string;
	message: string;
	severity: ProjectAutomationIssueSeverity;
}

export interface ProjectAutomationsValidationResult {
	ok: boolean;
	path: string;
	issues: readonly ProjectAutomationValidationIssue[];
	count: number;
}

const PROJECT_AUTOMATION_STATUSES = new Set([
	"draft",
	"ready",
	"active",
	"archived",
]);
const PROJECT_AUTOMATION_TRIGGER_TYPES = new Set([
	"manual",
	"cron",
	"once",
	"event",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function issue(
	path: string,
	code: string,
	message: string,
	severity: ProjectAutomationIssueSeverity = "error",
): ProjectAutomationValidationIssue {
	return { path, code, message, severity };
}

function requireCleanString(value: unknown, field: string): string {
	const cleaned = cleanString(value);
	if (!cleaned) throw new Error(`${field} must be a non-empty string.`);
	return cleaned;
}

export function normalizeProjectAutomationsDocument(
	value: unknown,
): ProjectAutomationsDocument {
	if (Array.isArray(value)) {
		return { automations: value as ProjectAutomationRecord[] };
	}
	if (isRecord(value)) {
		return {
			...value,
			automations: Array.isArray(value.automations)
				? (value.automations as ProjectAutomationRecord[])
				: [],
		} as ProjectAutomationsDocument;
	}
	return { automations: [] };
}

export function buildProjectAutomationRecord(
	input: ProjectAutomationAddInput,
): ProjectAutomationRecord {
	const id = requireCleanString(input.id, "Automation id");
	const name = requireCleanString(input.name, "Automation name");
	const status = input.status ?? "draft";
	if (!PROJECT_AUTOMATION_STATUSES.has(status)) {
		throw new Error("Automation status must be draft, ready, active, or archived.");
	}
	const description = cleanString(input.description);
	return {
		id,
		name,
		...(description ? { description } : {}),
		status,
		triggers: [input.trigger],
	};
}

export function addProjectAutomationRecord(
	existing: unknown,
	input: ProjectAutomationAddInput,
): ProjectAutomationsDocument {
	const document = normalizeProjectAutomationsDocument(existing);
	const automation = buildProjectAutomationRecord(input);
	if (document.automations.some((item) => item.id === automation.id)) {
		throw new Error(`Automation id already exists: ${automation.id}`);
	}
	return {
		...document,
		automations: [...document.automations, automation],
	};
}

export function updateProjectAutomationStatus(
	existing: unknown,
	input: ProjectAutomationStatusUpdateInput,
): ProjectAutomationsDocument {
	const document = normalizeProjectAutomationsDocument(existing);
	const id = requireCleanString(input.id, "Automation id");
	if (!PROJECT_AUTOMATION_STATUSES.has(input.status)) {
		throw new Error("Automation status must be draft, ready, active, or archived.");
	}
	let found = false;
	const updated = {
		...document,
		automations: document.automations.map((automation) => {
			if (automation.id !== id) return automation;
			found = true;
			return {
				...automation,
				status: input.status,
			};
		}),
	};
	if (!found) throw new Error(`Automation id not found: ${id}`);
	return updated;
}

export function requireProjectAutomationId(
	document: ProjectAutomationsDocument,
	id: string,
): ProjectAutomationRecord {
	const cleaned = requireCleanString(id, "Automation id");
	const automation = document.automations.find((item) => item.id === cleaned);
	if (!automation) throw new Error(`Automation id not found: ${cleaned}`);
	return automation;
}

export function validateProjectAutomationsDocument(
	value: unknown,
	options: { path?: string } = {},
): ProjectAutomationsValidationResult {
	const path = options.path ?? PROJECT_AUTOMATIONS_RELATIVE_PATH;
	const issues: ProjectAutomationValidationIssue[] = [];
	if (value === undefined) {
		return { ok: true, path, issues, count: 0 };
	}

	const records = Array.isArray(value)
		? value
		: isRecord(value)
			? value.automations
			: undefined;
	if (!Array.isArray(records)) {
		return {
			ok: false,
			path,
			count: 0,
			issues: [
				issue(
					path,
					"invalid_project_automations_shape",
					"Project automations must be an array or an object with an automations array.",
				),
			],
		};
	}

	records.forEach((record, index) => {
		issues.push(...validateProjectAutomationRecord(record, path, index));
	});
	return {
		ok: issues.every((item) => item.severity !== "error"),
		path,
		issues,
		count: records.length,
	};
}

function validateProjectAutomationRecord(
	record: unknown,
	path: string,
	index: number,
): ProjectAutomationValidationIssue[] {
	const recordPath = `${path}.automations[${index}]`;
	if (!isRecord(record)) {
		return [
			issue(
				recordPath,
				"invalid_project_automation_record",
				"Project automation entries must be objects.",
			),
		];
	}

	const issues: ProjectAutomationValidationIssue[] = [];
	if (!cleanString(record.id)) {
		issues.push(
			issue(
				`${recordPath}.id`,
				"invalid_project_automation_id",
				"Project automation id must be a non-empty string.",
			),
		);
	}
	if (!cleanString(record.name)) {
		issues.push(
			issue(
				`${recordPath}.name`,
				"invalid_project_automation_name",
				"Project automation name must be a non-empty string.",
			),
		);
	}
	if (
		record.status !== undefined &&
		(typeof record.status !== "string" ||
			!PROJECT_AUTOMATION_STATUSES.has(record.status))
	) {
		issues.push(
			issue(
				`${recordPath}.status`,
				"invalid_project_automation_status",
				"Project automation status must be draft, ready, active, or archived.",
			),
		);
	}
	if (!Array.isArray(record.triggers) || record.triggers.length === 0) {
		issues.push(
			issue(
				`${recordPath}.triggers`,
				"invalid_project_automation_triggers",
				"Project automation triggers must be a non-empty array.",
			),
		);
		return issues;
	}
	record.triggers.forEach((trigger, triggerIndex) => {
		issues.push(
			...validateProjectAutomationTrigger(
				trigger,
				`${recordPath}.triggers[${triggerIndex}]`,
			),
		);
	});
	return issues;
}

function validateProjectAutomationTrigger(
	trigger: unknown,
	path: string,
): ProjectAutomationValidationIssue[] {
	if (!isRecord(trigger)) {
		return [
			issue(
				path,
				"invalid_project_automation_trigger",
				"Project automation triggers must be objects.",
			),
		];
	}
	if (
		typeof trigger.type !== "string" ||
		!PROJECT_AUTOMATION_TRIGGER_TYPES.has(trigger.type)
	) {
		return [
			issue(
				`${path}.type`,
				"invalid_project_automation_trigger_type",
				"Project automation trigger type must be manual, cron, once, or event.",
			),
		];
	}
	if (
		trigger.type === "once" &&
		(!cleanString(trigger.at) || Number.isNaN(Date.parse(String(trigger.at))))
	) {
		return [
			issue(
				`${path}.at`,
				"invalid_project_automation_once_trigger",
				"Project automation once trigger requires a valid at timestamp.",
			),
		];
	}
	if (trigger.type === "cron" && !cleanString(trigger.schedule)) {
		return [
			issue(
				`${path}.schedule`,
				"invalid_project_automation_cron_trigger",
				"Project automation cron trigger requires a non-empty schedule.",
			),
		];
	}
	if (trigger.type === "event" && !cleanString(trigger.eventType)) {
		return [
			issue(
				`${path}.eventType`,
				"invalid_project_automation_event_trigger",
				"Project automation event trigger requires a non-empty eventType.",
			),
		];
	}
	return [];
}
