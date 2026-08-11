import type {
	ArtifactStatus,
	AutomationBody,
	AutomationTrigger,
	CronTrigger,
	EffortTemplate,
	EventTrigger,
	ManualTrigger,
	OneShotTrigger,
	PluginBody,
	StaticBody,
	TemplateBody,
} from "@refarm.dev/automation-contract-v1";
import type { Effort, Task } from "@refarm.dev/effort-contract-v1";
import {
	inspectLocalScheduledWork,
	type LocalScheduledTrigger,
} from "@refarm.dev/windmill/local-scheduler";
import fs from "node:fs";
import path from "node:path";
import type {
	OperatorResumeScheduledWorkInspection,
	OperatorResumeScheduledWorkSummary,
} from "./operator-resume.js";

export const PROJECT_AUTOMATIONS_RELATIVE_PATH = ".project/automations.json";

// The project-automations surface IS `automation:v1` + `effort:v1` — the canonical contracts,
// not a private clone. These aliases keep the CLI's `ProjectAutomation*` names (nothing else
// needs to change) while making the CANONICAL types the single source of truth. If the
// contract evolves, this surface follows it; drift is impossible.
export type ProjectAutomationStatus = ArtifactStatus;
export type ProjectAutomationManualTrigger = ManualTrigger;
export type ProjectAutomationCronTrigger = CronTrigger;
export type ProjectAutomationOnceTrigger = OneShotTrigger;
export type ProjectAutomationEventTrigger = EventTrigger;
export type ProjectAutomationTrigger = AutomationTrigger;
export type ProjectAutomationTask = Task;
export type ProjectAutomationEffortTemplate = EffortTemplate;
export type ProjectAutomationStaticBody = StaticBody;
export type ProjectAutomationTemplateBody = TemplateBody;
export type ProjectAutomationPluginBody = PluginBody;
export type ProjectAutomationBody = AutomationBody;
export type ProjectAutomationEffort = Effort;

export interface ProjectAutomationRecord {
	id: string;
	name: string;
	description?: string;
	status: ProjectAutomationStatus;
	triggers: ProjectAutomationTrigger[];
	body?: ProjectAutomationBody;
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

export interface ProjectScheduledWorkOptions {
	cwd?: string;
	now?: string | Date;
	owner?: string;
}

export type ProjectScheduledWorkSummary = OperatorResumeScheduledWorkSummary;

export type ProjectScheduledWorkInspection = OperatorResumeScheduledWorkInspection;

export interface ProjectAutomationAdapterOptions {
	cwd?: string;
	now?: () => Date;
}

const PROJECT_AUTOMATION_STATUSES = new Set(["draft", "ready", "active", "archived"]);
const PROJECT_AUTOMATION_TRIGGER_TYPES = new Set(["manual", "cron", "once", "event"]);

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

export function normalizeProjectAutomationsDocument(value: unknown): ProjectAutomationsDocument {
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

	const records = Array.isArray(value) ? value : isRecord(value) ? value.automations : undefined;
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
		(typeof record.status !== "string" || !PROJECT_AUTOMATION_STATUSES.has(record.status))
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
			...validateProjectAutomationTrigger(trigger, `${recordPath}.triggers[${triggerIndex}]`),
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
	if (typeof trigger.type !== "string" || !PROJECT_AUTOMATION_TRIGGER_TYPES.has(trigger.type)) {
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

// os-resolution: project — project automations are declared per project, in .project of the tree being walked
export function findProjectAutomationsPath(cwd: string = process.cwd()): string | undefined {
	let current = path.resolve(cwd);
	while (true) {
		const candidate = path.join(current, PROJECT_AUTOMATIONS_RELATIVE_PATH);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export async function loadProjectScheduledWork(
	options: ProjectScheduledWorkOptions = {},
): Promise<ProjectScheduledWorkInspection | undefined> {
	// os-resolution: project — project automations are declared per project, in .project of the tree being walked
	const automationsPath = findProjectAutomationsPath(options.cwd ?? process.cwd());
	if (!automationsPath) return undefined;

	let records: unknown;
	try {
		const parsed = JSON.parse(fs.readFileSync(automationsPath, "utf-8")) as
			| ProjectAutomationsDocument
			| unknown[];
		records = Array.isArray(parsed) ? parsed : parsed.automations;
	} catch {
		return undefined;
	}
	if (!Array.isArray(records)) return undefined;

	const automations = records.flatMap((record) => {
		const automation = normalizeProjectAutomationForScheduler(record);
		return automation ? [automation] : [];
	});
	if (automations.length === 0) return undefined;

	return inspectLocalScheduledWork(
		{
			async query(filter?: { status?: string }) {
				if (!filter?.status) return automations;
				return automations.filter((automation) => automation.status === filter.status);
			},
		},
		{ owner: options.owner ?? "refarm-main", now: options.now },
	) as Promise<ProjectScheduledWorkInspection>;
}

export function createProjectAutomationAdapter(options: ProjectAutomationAdapterOptions = {}) {
	// os-resolution: project — project automations are declared per project, in .project of the tree being walked
	const cwd = options.cwd ?? process.cwd();
	const now = options.now ?? (() => new Date());

	function loadAutomations(): NormalizedProjectAutomation[] {
		const document = readProjectAutomationsDocument(cwd);
		if (!document) return [];
		return document.automations.flatMap((record) => {
			const automation = normalizeProjectAutomationForScheduler(record);
			return automation ? [automation] : [];
		});
	}

	return {
		async query(filter?: { status?: string }) {
			const automations = loadAutomations();
			if (!filter?.status) return automations;
			return automations.filter((automation) => automation.status === filter.status);
		},
		async trigger(id: string, input?: unknown): Promise<ProjectAutomationEffort | null> {
			const automation = readProjectAutomationsDocument(cwd)
				?.automations.flatMap((record) => {
					const normalized = normalizeProjectAutomationForTrigger(record);
					return normalized ? [normalized] : [];
				})
				.find((item) => item.id === id);
			if (!automation || automation.status !== "active") return null;
			const body = automation.body ?? buildDefaultProjectAutomationBody(automation);
			if (body.type === "plugin") {
				throw new Error(
					"Project automation plugin bodies require a host plugin adapter before local scheduled execution.",
				);
			}
			return bakeProjectAutomationEffort({
				automation,
				body,
				input,
				now,
				interpolate: body.type === "template",
			});
		},
	};
}

function readProjectAutomationsDocument(cwd: string): ProjectAutomationsDocument | undefined {
	const automationsPath = findProjectAutomationsPath(cwd);
	if (!automationsPath) return undefined;
	try {
		return normalizeProjectAutomationsDocument(
			JSON.parse(fs.readFileSync(automationsPath, "utf-8")) as unknown,
		);
	} catch {
		return undefined;
	}
}

interface NormalizedProjectAutomation {
	id: string;
	name: string;
	description?: string;
	status: string;
	triggers: LocalScheduledTrigger[];
	body?: ProjectAutomationBody;
}

interface TriggerableProjectAutomation {
	id: string;
	name: string;
	status: string;
	body?: ProjectAutomationBody;
}

function normalizeProjectAutomationForScheduler(
	record: unknown,
): NormalizedProjectAutomation | undefined {
	if (!isRecord(record)) return undefined;
	const id = cleanString(record.id);
	const name = cleanString(record.name);
	if (!id || !name || !Array.isArray(record.triggers)) return undefined;

	const triggers = record.triggers.flatMap((trigger) => {
		const normalized = normalizeScheduledTrigger(trigger);
		return normalized ? [normalized] : [];
	});
	if (triggers.length === 0) return undefined;

	return {
		id,
		name,
		description: cleanString(record.description),
		status: cleanString(record.status) ?? "draft",
		triggers,
		body: normalizeProjectAutomationBody(record.body),
	};
}

function normalizeProjectAutomationForTrigger(
	record: unknown,
): TriggerableProjectAutomation | undefined {
	if (!isRecord(record)) return undefined;
	const id = cleanString(record.id);
	const name = cleanString(record.name);
	if (!id || !name) return undefined;
	return {
		id,
		name,
		status: cleanString(record.status) ?? "draft",
		body: normalizeProjectAutomationBody(record.body),
	};
}

function buildDefaultProjectAutomationBody(
	automation: Pick<TriggerableProjectAutomation, "id" | "name">,
): ProjectAutomationStaticBody {
	return {
		type: "static",
		effort: {
			direction: `project automation: ${automation.name}`,
			tasks: [],
			source: "project-automations",
			tags: ["project-automation", automation.id],
		},
	};
}

function normalizeProjectAutomationBody(body: unknown): ProjectAutomationBody | undefined {
	if (!isRecord(body) || typeof body.type !== "string") return undefined;
	if (body.type === "plugin") {
		const pluginId = cleanString(body.pluginId);
		const fn = cleanString(body.fn);
		if (!pluginId || !fn) return undefined;
		return {
			type: "plugin",
			pluginId,
			fn,
			inputSchema: isRecord(body.inputSchema) ? body.inputSchema : undefined,
		};
	}
	if ((body.type === "static" || body.type === "template") && isRecord(body.effort)) {
		const effort = normalizeProjectAutomationEffortTemplate(body.effort);
		if (!effort) return undefined;
		if (body.type === "static") return { type: "static", effort };
		return {
			type: "template",
			effort,
			inputSchema: isRecord(body.inputSchema) ? body.inputSchema : undefined,
		};
	}
	return undefined;
}

function normalizeProjectAutomationEffortTemplate(
	value: Record<string, unknown>,
): ProjectAutomationEffortTemplate | undefined {
	const direction = cleanString(value.direction);
	if (!direction || !Array.isArray(value.tasks)) return undefined;
	return {
		direction,
		tasks: value.tasks.flatMap((task) => {
			const normalized = normalizeProjectAutomationTask(task);
			return normalized ? [normalized] : [];
		}),
		source: cleanString(value.source),
		context: value.context,
		priority: typeof value.priority === "number" ? value.priority : undefined,
		tags: Array.isArray(value.tags)
			? value.tags.flatMap((tag) => {
					const cleaned = cleanString(tag);
					return cleaned ? [cleaned] : [];
				})
			: undefined,
	};
}

function normalizeProjectAutomationTask(value: unknown): ProjectAutomationTask | undefined {
	if (!isRecord(value)) return undefined;
	const id = cleanString(value.id);
	const pluginId = cleanString(value.pluginId);
	const fn = cleanString(value.fn);
	if (!id || !pluginId || !fn) return undefined;
	return {
		id,
		pluginId,
		fn,
		args: value.args,
	};
}

function bakeProjectAutomationEffort(options: {
	automation: TriggerableProjectAutomation;
	body: ProjectAutomationStaticBody | ProjectAutomationTemplateBody;
	input: unknown;
	now: () => Date;
	interpolate: boolean;
}): ProjectAutomationEffort {
	const inputRecord = isRecord(options.input) ? options.input : {};
	const firedAt = cleanString(inputRecord.firedAt) ?? options.now().toISOString();
	const template = options.body.effort;
	return {
		id: crypto.randomUUID(),
		submittedAt: firedAt,
		direction: options.interpolate
			? interpolateProjectAutomationString(template.direction, inputRecord)
			: template.direction,
		tasks: template.tasks,
		source: template.source ?? "project-automations",
		context: {
			projectAutomation: {
				id: options.automation.id,
				name: options.automation.name,
				path: PROJECT_AUTOMATIONS_RELATIVE_PATH,
			},
			trigger: options.input,
			...(template.context === undefined ? {} : { templateContext: template.context }),
		},
		priority: template.priority,
		tags: template.tags ?? ["project-automation", options.automation.id],
	};
}

function interpolateProjectAutomationString(
	template: string,
	input: Record<string, unknown>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(input[key] ?? ""));
}

function normalizeScheduledTrigger(trigger: unknown): LocalScheduledTrigger | undefined {
	if (!isRecord(trigger)) return undefined;
	if (trigger.type === "once" && typeof trigger.at === "string") {
		return { type: "once", at: trigger.at };
	}
	if (trigger.type === "cron" && typeof trigger.schedule === "string") {
		return {
			type: "cron",
			schedule: trigger.schedule,
			timezone: typeof trigger.timezone === "string" ? trigger.timezone : undefined,
		};
	}
	return undefined;
}
