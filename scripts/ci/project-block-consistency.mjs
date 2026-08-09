#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
};

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function collectPhaseNumbers() {
	const phasesDir = ".project/phases";
	if (!existsSync(phasesDir)) return new Set();

	const values = new Set();
	const files = readdirSync(phasesDir).filter((name) => name.endsWith(".json"));
	for (const file of files) {
		const phase = readJson(join(phasesDir, file));
		if (typeof phase.number === "number") {
			values.add(String(phase.number));
		}
		if (typeof phase.number === "string") {
			values.add(phase.number);
		}
	}
	return values;
}

function ensureUniqueIds(items, label, errors) {
	const seen = new Set();
	for (const item of items) {
		if (!item || typeof item.id !== "string" || item.id.trim() === "") {
			errors.push(`[${label}] entry with missing/invalid id`);
			continue;
		}

		if (seen.has(item.id)) {
			errors.push(`[${label}] duplicate id: ${item.id}`);
			continue;
		}

		seen.add(item.id);
	}
}

const CITATION = /\bISS-\d+\b/g;

// External anchor #1 (deterministic — feeds `errors`): every handoff entry must cite a work
// item that actually exists in the ledger, and every issue must carry the fields its status
// demands. Pure and filesystem-free so it is testable without touching disk. Deliberately does
// NOT require the reverse (every open issue appearing in the handoff) — with 54 open items that
// would force the handoff back into the bloat this migration exists to end.
export function checkHandoffCitations(handoff, issues) {
	const errors = [];
	const ids = new Set(issues.map((issue) => issue.id));
	const entries = [
		...asArray(handoff.next_actions).map((text) => ["next_actions", text]),
		...asArray(handoff.blockers).map((text) => ["blockers", text]),
	];

	for (const [field, text] of entries) {
		const cited = String(text).match(CITATION) ?? [];
		if (cited.length === 0) {
			errors.push(`[handoff] ${field} entry cites no work item: ${String(text).slice(0, 60)}…`);
			continue;
		}
		for (const id of cited) {
			if (!ids.has(id)) errors.push(`[handoff] cites unknown work item: ${id}`);
		}
	}

	for (const issue of issues) {
		if (issue.status === "open" && !issue.axis) {
			errors.push(`[issues] ${issue.id} is open with no axis`);
		}
		if (issue.status === "resolved" && !issue.resolved_by) {
			errors.push(`[issues] ${issue.id} is resolved with no resolved_by`);
		}
	}

	return { errors };
}

// External anchor #2 (heuristic — feeds `warnings`, never `errors`): the ledger can be
// internally perfect and still be stale. Staleness is a judgement call, not a verifiable defect
// an agent can always remediate in one command, so it warns rather than blocks — blocking here
// would deadlock the agent loop and create an incentive to bypass the gate. Three states, never
// two: `null` means git could not be read (shallow clone, no `.git`) and reports "unknown",
// never "fresh".
export function checkLedgerFreshness({ commitsSinceLedgerChange }) {
	if (commitsSinceLedgerChange === null) {
		return { errors: [], warnings: ["[ledger] freshness unknown — git history unreadable"] };
	}
	if (commitsSinceLedgerChange > 0) {
		return {
			errors: [],
			warnings: [
				`[ledger] ${commitsSinceLedgerChange} commit(s) since .project/issues.json last changed`,
			],
		};
	}
	return { errors: [], warnings: [] };
}

// The git anchor itself — lives outside the pure functions above so they stay testable without
// a filesystem or a git checkout. Returns null (UNKNOWN) rather than 0 on any failure; a shallow
// clone is not a fresh ledger.
function commitsSinceLedgerChange() {
	try {
		const last = execFileSync("git", ["log", "-1", "--format=%H", "--", ".project/issues.json"], {
			encoding: "utf8",
		}).trim();
		if (!last) return null;
		const count = execFileSync("git", ["rev-list", "--count", `${last}..HEAD`], { encoding: "utf8" });
		return Number.parseInt(count.trim(), 10);
	} catch {
		return null; // UNKNOWN, never 0 — a shallow clone is not a fresh ledger.
	}
}

function main() {
	const requiredFiles = [
		".project/requirements.json",
		".project/tasks.json",
		".project/verification.json",
		".project/issues.json",
		".project/handoff.json",
	];

	for (const path of requiredFiles) {
		if (!existsSync(path)) {
			console.error(
				`${colors.red}✗ missing required file:${colors.reset} ${path}`,
			);
			process.exit(1);
		}
	}

	const requirements = asArray(
		readJson(".project/requirements.json").requirements,
	);
	const tasks = asArray(readJson(".project/tasks.json").tasks);
	const verifications = asArray(
		readJson(".project/verification.json").verifications,
	);
	const issues = asArray(readJson(".project/issues.json").issues);
	const handoff = readJson(".project/handoff.json");

	const requirementIds = new Set(requirements.map((r) => r.id).filter(Boolean));
	const taskIds = new Set(tasks.map((t) => t.id).filter(Boolean));
	const verificationIds = new Set(
		verifications.map((v) => v.id).filter(Boolean),
	);
	const phaseNumbers = collectPhaseNumbers();

	const errors = [];
	const warnings = [];

	ensureUniqueIds(requirements, "requirements", errors);
	ensureUniqueIds(tasks, "tasks", errors);
	ensureUniqueIds(verifications, "verification", errors);
	ensureUniqueIds(issues, "issues", errors);

	for (const req of requirements) {
		for (const ref of asArray(req.traces_to)) {
			if (!taskIds.has(ref) && !phaseNumbers.has(String(ref))) {
				errors.push(`[requirements] ${req.id} traces_to missing ref: ${ref}`);
			}
		}

		for (const dep of asArray(req.depends_on)) {
			if (!requirementIds.has(dep)) {
				errors.push(
					`[requirements] ${req.id} depends_on missing requirement: ${dep}`,
				);
			}
		}
	}

	for (const task of tasks) {
		for (const dep of asArray(task.depends_on)) {
			if (!taskIds.has(dep)) {
				errors.push(`[tasks] ${task.id} depends_on missing task: ${dep}`);
			}
		}

		if (
			typeof task.verification === "string" &&
			task.verification.trim() !== "" &&
			!verificationIds.has(task.verification)
		) {
			errors.push(
				`[tasks] ${task.id} references missing verification: ${task.verification}`,
			);
		}

		if (task.status === "completed") {
			if (!task.verification) {
				errors.push(`[tasks] ${task.id} is completed but has no verification`);
			} else {
				const verification = verifications.find(
					(entry) => entry.id === task.verification,
				);
				if (!verification) {
					errors.push(
						`[tasks] ${task.id} completed with unknown verification: ${task.verification}`,
					);
				} else {
					if (verification.target_type !== "task") {
						errors.push(
							`[tasks] ${task.id} verification ${task.verification} must target_type=task`,
						);
					}
					if (verification.target !== task.id) {
						errors.push(
							`[tasks] ${task.id} verification ${task.verification} targets ${verification.target}`,
						);
					}
					if (verification.status !== "passed") {
						warnings.push(
							`[tasks] ${task.id} completed with verification ${task.verification} status=${verification.status}`,
						);
					}
				}
			}
		}
	}

	for (const verification of verifications) {
		if (!verification || typeof verification.id !== "string") continue;

		switch (verification.target_type) {
			case "task":
				if (!taskIds.has(verification.target)) {
					errors.push(
						`[verification] ${verification.id} target task missing: ${verification.target}`,
					);
				}
				break;
			case "requirement":
				if (!requirementIds.has(verification.target)) {
					errors.push(
						`[verification] ${verification.id} target requirement missing: ${verification.target}`,
					);
				}
				break;
			case "phase":
				if (!phaseNumbers.has(String(verification.target))) {
					errors.push(
						`[verification] ${verification.id} target phase missing: ${verification.target}`,
					);
				}
				break;
			default:
				errors.push(
					`[verification] ${verification.id} has unknown target_type: ${verification.target_type}`,
				);
		}
	}

	for (const issue of issues) {
		if (!issue || typeof issue.id !== "string") continue;

		if (issue.status === "resolved") {
			if (!issue.resolved_by || String(issue.resolved_by).trim() === "") {
				errors.push(
					`[issues] ${issue.id} is resolved but resolved_by is empty`,
				);
			} else if (
				String(issue.resolved_by).startsWith("VER-") &&
				!verificationIds.has(issue.resolved_by)
			) {
				errors.push(
					`[issues] ${issue.id} resolved_by references missing verification: ${issue.resolved_by}`,
				);
			}
		}
	}

	const citations = checkHandoffCitations(handoff, issues);
	errors.push(...citations.errors);

	const freshness = checkLedgerFreshness({
		commitsSinceLedgerChange: commitsSinceLedgerChange(),
	});
	errors.push(...freshness.errors);
	warnings.push(...freshness.warnings);

	// Errors are never silenced. Warnings are noise once a caller has already opted into a quiet
	// aggregated gate (`gate:full:colony` runs this with `--silent`) — respected the same way for
	// every warning in this file, old and new alike.
	const silent = process.argv.includes("--silent");

	if (errors.length > 0) {
		console.error(
			`${colors.red}✗ project block consistency failed${colors.reset}`,
		);
		for (const message of errors) {
			console.error(`  - ${message}`);
		}
		if (warnings.length > 0 && !silent) {
			console.error(`${colors.yellow}Warnings:${colors.reset}`);
			for (const message of warnings) {
				console.error(`  - ${message}`);
			}
		}
		process.exit(1);
	}

	console.log(
		`${colors.green}✓ project block consistency passed${colors.reset}`,
	);
	if (warnings.length > 0 && !silent) {
		console.log(`${colors.yellow}Warnings:${colors.reset}`);
		for (const message of warnings) {
			console.log(`  - ${message}`);
		}
	}
}

main();
