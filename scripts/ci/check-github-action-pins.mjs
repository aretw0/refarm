#!/usr/bin/env node
/**
 * Fails when workflow steps use third-party GitHub Actions without a full
 * 40-character commit SHA. Local actions are allowed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");
const SHA_40 = /^[0-9a-f]{40}$/i;

const violations = [];

for (const entry of readdirSync(WORKFLOWS_DIR, { withFileTypes: true })) {
	if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
	const filePath = join(WORKFLOWS_DIR, entry.name);
	const lines = readFileSync(filePath, "utf8").split("\n");

	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) return;

		const match = trimmed.match(/^uses:\s*([^#\s]+)(?:\s+#.*)?$/);
		if (!match) return;

		const spec = match[1];
		if (spec.startsWith("./")) return;

		const at = spec.lastIndexOf("@");
		if (at === -1) {
			violations.push({ file: entry.name, line: index + 1, spec, reason: "missing ref" });
			return;
		}

		const ref = spec.slice(at + 1);
		if (!SHA_40.test(ref)) {
			violations.push({
				file: entry.name,
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
