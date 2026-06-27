import type { OperatorResumeProjectSummary } from "./operator-resume.js";

export const PROJECT_HANDOFF_RELATIVE_PATH = ".project/handoff.json";

export type ProjectHandoffIssueSeverity = "error" | "warning";

export interface ProjectHandoffValidationIssue {
	path: string;
	code: string;
	message: string;
	severity: ProjectHandoffIssueSeverity;
}

export interface ProjectHandoffDocument {
	context: string;
	timestamp: string;
	current_phase?: string | number;
	current_tasks?: string[];
	blockers?: string[];
	next_actions?: string[];
	open_questions?: string[];
	key_decisions_pending?: string[];
	files_in_flux?: string[];
	[key: string]: unknown;
}

export interface ProjectHandoffUpdate {
	context?: string;
	timestamp?: string;
	currentPhase?: string | number;
	currentTasks?: readonly string[];
	blockers?: readonly string[];
	nextActions?: readonly string[];
	openQuestions?: readonly string[];
	filesInFlux?: readonly string[];
}

export interface ProjectHandoffValidationOptions {
	path?: string;
	now?: Date;
	maxAgeMs?: number;
}

export interface ProjectHandoffValidationResult {
	ok: boolean;
	path: string;
	issues: readonly ProjectHandoffValidationIssue[];
	summary?: OperatorResumeProjectSummary;
	ageMs?: number;
	stale: boolean;
}

const ARRAY_FIELDS = [
	"current_tasks",
	"blockers",
	"next_actions",
	"open_questions",
	"key_decisions_pending",
	"files_in_flux",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function cleanStringArray(value: unknown, limit?: number): string[] {
	if (!Array.isArray(value)) return [];
	const items = value
		.map(cleanString)
		.filter((item): item is string => item !== undefined);
	return limit === undefined ? items : items.slice(0, limit);
}

function fieldIssue(
	path: string,
	code: string,
	message: string,
	severity: ProjectHandoffIssueSeverity = "error",
): ProjectHandoffValidationIssue {
	return { path, code, message, severity };
}

export function parseProjectHandoffSummary(
	value: unknown,
	options: { path?: string; arrayLimit?: number } = {},
): OperatorResumeProjectSummary | undefined {
	if (!isRecord(value)) return undefined;
	const context = cleanString(value.context);
	const timestamp = cleanString(value.timestamp);
	const currentPhase =
		typeof value.current_phase === "string" ||
		typeof value.current_phase === "number"
			? value.current_phase
			: undefined;
	if (!context && !timestamp && currentPhase === undefined) return undefined;
	return {
		path: options.path ?? PROJECT_HANDOFF_RELATIVE_PATH,
		timestamp,
		currentPhase,
		context,
		currentTasks: cleanStringArray(value.current_tasks, options.arrayLimit),
		blockers: cleanStringArray(value.blockers, options.arrayLimit),
		nextActions: cleanStringArray(value.next_actions, options.arrayLimit),
		openQuestions: cleanStringArray(value.open_questions, options.arrayLimit),
	};
}

export function validateProjectHandoffDocument(
	value: unknown,
	options: ProjectHandoffValidationOptions = {},
): ProjectHandoffValidationResult {
	const path = options.path ?? PROJECT_HANDOFF_RELATIVE_PATH;
	const issues: ProjectHandoffValidationIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			path,
			issues: [
				fieldIssue(path, "not_object", "Project handoff must be a JSON object."),
			],
			stale: false,
		};
	}

	const context = cleanString(value.context);
	if (!context) {
		issues.push(
			fieldIssue(
				`${path}.context`,
				"context_required",
				"Project handoff context must be a non-empty string.",
			),
		);
	}

	const timestamp = cleanString(value.timestamp);
	let ageMs: number | undefined;
	let stale = false;
	if (!timestamp) {
		issues.push(
			fieldIssue(
				`${path}.timestamp`,
				"timestamp_required",
				"Project handoff timestamp must be a non-empty ISO string.",
			),
		);
	} else {
		const timestampMs = Date.parse(timestamp);
		if (Number.isNaN(timestampMs)) {
			issues.push(
				fieldIssue(
					`${path}.timestamp`,
					"timestamp_invalid",
					"Project handoff timestamp must be parseable as a date.",
				),
			);
		} else {
			const nowMs = (options.now ?? new Date()).getTime();
			ageMs = nowMs - timestampMs;
			if (ageMs < -300_000) {
				issues.push(
					fieldIssue(
						`${path}.timestamp`,
						"timestamp_future",
						"Project handoff timestamp is more than five minutes in the future.",
					),
				);
			}
			if (options.maxAgeMs !== undefined && ageMs > options.maxAgeMs) {
				stale = true;
				issues.push(
					fieldIssue(
						`${path}.timestamp`,
						"timestamp_stale",
						"Project handoff timestamp is older than the configured freshness window.",
						"warning",
					),
				);
			}
		}
	}

	if (
		value.current_phase !== undefined &&
		typeof value.current_phase !== "string" &&
		typeof value.current_phase !== "number"
	) {
		issues.push(
			fieldIssue(
				`${path}.current_phase`,
				"current_phase_invalid",
				"Project handoff current_phase must be a string or number when present.",
			),
		);
	}

	for (const field of ARRAY_FIELDS) {
		const item = value[field];
		if (item === undefined) continue;
		if (!Array.isArray(item)) {
			issues.push(
				fieldIssue(
					`${path}.${field}`,
					"array_invalid",
					`Project handoff ${field} must be an array of strings when present.`,
				),
			);
			continue;
		}
		item.forEach((entry, index) => {
			if (typeof entry !== "string" || entry.trim().length === 0) {
				issues.push(
					fieldIssue(
						`${path}.${field}[${index}]`,
						"array_item_invalid",
						`Project handoff ${field} entries must be non-empty strings.`,
					),
				);
			}
		});
	}

	return {
		ok: issues.every((issue) => issue.severity !== "error"),
		path,
		issues,
		summary: parseProjectHandoffSummary(value, { path }),
		ageMs,
		stale,
	};
}

export function buildProjectHandoffDocument(
	existing: unknown,
	update: ProjectHandoffUpdate,
	options: { now?: Date } = {},
): ProjectHandoffDocument {
	const base: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
	if (update.context !== undefined) base.context = update.context.trim();
	base.timestamp = (update.timestamp ?? options.now?.toISOString() ?? new Date().toISOString()).trim();
	if (update.currentPhase !== undefined) base.current_phase = update.currentPhase;
	if (update.currentTasks !== undefined) {
		base.current_tasks = cleanStringArray([...update.currentTasks]);
	}
	if (update.blockers !== undefined) {
		base.blockers = cleanStringArray([...update.blockers]);
	}
	if (update.nextActions !== undefined) {
		base.next_actions = cleanStringArray([...update.nextActions]);
	}
	if (update.openQuestions !== undefined) {
		base.open_questions = cleanStringArray([...update.openQuestions]);
	}
	if (update.filesInFlux !== undefined) {
		base.files_in_flux = cleanStringArray([...update.filesInFlux]);
	}
	return base as ProjectHandoffDocument;
}
