import {
	PLAYBOOK_SCHEMA_VERSION,
	type Playbook,
	type PlaybookIssue,
	type PlaybookStep,
} from "./types.js";

export interface PlaybookParseResult {
	ok: boolean;
	playbook?: Playbook;
	issues: PlaybookIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate + normalize a raw playbook document (from JSON/YAML) into a Playbook. Hand-rolled
 * with structured issues (path/code/message), matching the repo house style for config
 * validators — no schema library. Returns every issue found, not just the first.
 */
export function parsePlaybook(raw: unknown): PlaybookParseResult {
	const issues: PlaybookIssue[] = [];
	if (!isRecord(raw)) {
		return {
			ok: false,
			issues: [{ path: "", code: "not_object", message: "playbook must be an object" }],
		};
	}

	if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
		issues.push({ path: "name", code: "required", message: "name must be a non-empty string" });
	}
	if (raw.description !== undefined && typeof raw.description !== "string") {
		issues.push({ path: "description", code: "type", message: "description must be a string" });
	}

	const schemaVersion =
		raw.schemaVersion === undefined ? PLAYBOOK_SCHEMA_VERSION : Number(raw.schemaVersion);
	if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
		issues.push({
			path: "schemaVersion",
			code: "type",
			message: "schemaVersion must be a positive integer",
		});
	}

	const steps: PlaybookStep[] = [];
	if (!Array.isArray(raw.steps)) {
		issues.push({ path: "steps", code: "required", message: "steps must be an array" });
	} else if (raw.steps.length === 0) {
		issues.push({ path: "steps", code: "empty", message: "steps must have at least one step" });
	} else {
		raw.steps.forEach((entry, index) => {
			const at = `steps[${index}]`;
			if (!isRecord(entry)) {
				issues.push({ path: at, code: "type", message: `${at} must be an object` });
				return;
			}
			const verb = entry.verb;
			if (typeof verb !== "string" || !/^[^:\s]+:[^:\s]+$/.test(verb)) {
				issues.push({
					path: `${at}.verb`,
					code: "verb",
					message: `${at}.verb must be "<pluginId>:<verb>"`,
				});
			}
			if (entry.with !== undefined && !isRecord(entry.with)) {
				issues.push({ path: `${at}.with`, code: "type", message: `${at}.with must be an object` });
			}
			if (
				entry.saveAs !== undefined &&
				(typeof entry.saveAs !== "string" || entry.saveAs.trim().length === 0)
			) {
				issues.push({
					path: `${at}.saveAs`,
					code: "type",
					message: `${at}.saveAs must be a non-empty string`,
				});
			}
			if (entry.id !== undefined && typeof entry.id !== "string") {
				issues.push({ path: `${at}.id`, code: "type", message: `${at}.id must be a string` });
			}
			steps.push({
				verb: verb as string,
				...(isRecord(entry.with) ? { with: entry.with } : {}),
				...(typeof entry.saveAs === "string" ? { saveAs: entry.saveAs } : {}),
				...(typeof entry.id === "string" ? { id: entry.id } : {}),
			});
		});
	}

	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		issues: [],
		playbook: {
			schemaVersion,
			name: raw.name as string,
			...(typeof raw.description === "string" ? { description: raw.description } : {}),
			steps,
		},
	};
}
