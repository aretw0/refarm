#!/usr/bin/env node

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

function main() {
	const requiredFiles = [
		".project/requirements.json",
		".project/tasks.json",
		".project/verification.json",
		".project/issues.json",
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

	if (errors.length > 0) {
		console.error(
			`${colors.red}✗ project block consistency failed${colors.reset}`,
		);
		for (const message of errors) {
			console.error(`  - ${message}`);
		}
		if (warnings.length > 0) {
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
	if (warnings.length > 0) {
		console.log(`${colors.yellow}Warnings:${colors.reset}`);
		for (const message of warnings) {
			console.log(`  - ${message}`);
		}
	}
}

main();
