#!/usr/bin/env node
/**
 * Fails when workflow steps use third-party GitHub Actions without a full
 * 40-character commit SHA. Local actions are allowed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");
const ACTIONS_DIR = join(ROOT, ".github", "actions");
const WORKFLOW_TEMPLATES_DIR = join(ROOT, ".github", "workflow-templates");
const SHA_40 = /^[0-9a-f]{40}$/i;

// A repo-wide rename or restructuring of `.github/workflows` (the directory
// carrying nearly all real coverage) must not read the same as "scanned every
// workflow and none are unpinned". `listYamlFiles` catches ANY readdir failure
// on that directory — missing, permission-denied, or otherwise — and a floor
// on how many files it actually found is what turns "found nothing" back into
// a failure instead of a clean pass over zero real coverage.
export const MINIMUM_PLAUSIBLE_WORKFLOW_FILE_COUNT = 5;

export function listYamlFiles(dir, prefix = "") {
	const files = [];
	let entries = [];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return files;
	}

	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listYamlFiles(full, rel));
			continue;
		}
		if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
			files.push({ rel, full });
		}
	}
	return files;
}

/**
 * The PURE decision core — takes already-scanned file lists so it is directly
 * unit-testable without touching the real `.github` tree. Returns either a
 * `coverageError` (the scan itself is not trustworthy — "could not check", not
 * "checked, clean") or the usual pin violations.
 */
export function evaluateActionPins({ workflowFiles, actionFiles, templateFiles }, readFile = (path) => readFileSync(path, "utf8")) {
	if (workflowFiles.length < MINIMUM_PLAUSIBLE_WORKFLOW_FILE_COUNT) {
		return {
			ok: false,
			violations: [],
			coverageError:
				`found only ${workflowFiles.length} YAML file(s) under .github/workflows ` +
				`(expected at least ${MINIMUM_PLAUSIBLE_WORKFLOW_FILE_COUNT}) — the scan likely found the ` +
				"wrong directory rather than a genuinely empty one; refusing to report a clean pass over zero real coverage.",
		};
	}

	const violations = [];
	for (const file of [...workflowFiles, ...actionFiles, ...templateFiles]) {
		const lines = readFile(file.full).split("\n");

		lines.forEach((line, index) => {
			const trimmed = line.trim();
			if (trimmed.startsWith("#")) return;

			const match = trimmed.match(/^uses:\s*([^#\s]+)(?:\s+#.*)?$/);
			if (!match) return;

			const spec = match[1];
			if (spec.startsWith("./")) return;

			// Workflow templates are scaffolds users copy into their own plugin repos; a
			// self-repo reusable-workflow reference (aretw0/refarm/.github/workflows/…) is meant
			// to track the published workflow, so a floating ref there is intentional. Third-party
			// actions in templates are still enforced below.
			if (
				file.rel.startsWith(".github/workflow-templates/") &&
				spec.startsWith("aretw0/refarm/.github/workflows/")
			) {
				return;
			}

			const at = spec.lastIndexOf("@");
			if (at === -1) {
				violations.push({
					file: file.rel,
					line: index + 1,
					spec,
					reason: "missing ref",
				});
				return;
			}

			const ref = spec.slice(at + 1);
			if (!SHA_40.test(ref)) {
				violations.push({
					file: file.rel,
					line: index + 1,
					spec,
					reason: "ref is not a full 40-character SHA",
				});
			}
		});
	}

	return { ok: violations.length === 0, violations, coverageError: null };
}

function main() {
	const result = evaluateActionPins({
		workflowFiles: listYamlFiles(WORKFLOWS_DIR, ".github/workflows"),
		actionFiles: listYamlFiles(ACTIONS_DIR, ".github/actions"),
		templateFiles: listYamlFiles(WORKFLOW_TEMPLATES_DIR, ".github/workflow-templates"),
	});

	if (result.coverageError) {
		console.error(`✗ ${result.coverageError}`);
		process.exit(1);
	}

	if (result.ok) {
		console.log("✓ GitHub Actions are pinned to full commit SHAs");
		process.exit(0);
	}

	console.error("✗ Unpinned GitHub Actions detected\n");
	for (const violation of result.violations) {
		console.error(
			`  ${violation.file}:${violation.line} ${violation.spec} — ${violation.reason}`,
		);
	}
	console.error("\nPin third-party actions to a full 40-character commit SHA.");
	process.exit(1);
}

// Run only as a CLI — importing this module (e.g. from the test) must not scan
// the repo or call process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
