#!/usr/bin/env node
/**
 * Fails when workflow steps use third-party GitHub Actions without a full
 * 40-character commit SHA. Local actions are allowed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");
const ACTIONS_DIR = join(ROOT, ".github", "actions");
const WORKFLOW_TEMPLATES_DIR = join(ROOT, ".github", "workflow-templates");
const SHA_40 = /^[0-9a-f]{40}$/i;

const violations = [];

function listYamlFiles(dir, prefix = "") {
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

for (const file of [
	...listYamlFiles(WORKFLOWS_DIR, ".github/workflows"),
	...listYamlFiles(ACTIONS_DIR, ".github/actions"),
	...listYamlFiles(WORKFLOW_TEMPLATES_DIR, ".github/workflow-templates"),
]) {
	const lines = readFileSync(file.full, "utf8").split("\n");

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

if (violations.length === 0) {
	console.log("✓ GitHub Actions are pinned to full commit SHAs");
	process.exit(0);
}

console.error("✗ Unpinned GitHub Actions detected\n");
for (const violation of violations) {
	console.error(
		`  ${violation.file}:${violation.line} ${violation.spec} — ${violation.reason}`,
	);
}
console.error("\nPin third-party actions to a full 40-character commit SHA.");
process.exit(1);
