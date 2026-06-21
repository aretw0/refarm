#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function nodeTestTargets(command) {
	const targets = [];
	const pattern = /(?:^|\s)node\s+--test(?:\s+--[^\s]+)*\s+([^\s;&|]+)/g;
	let match;
	while ((match = pattern.exec(command)) !== null) {
		targets.push(match[1].replace(/^['"]|['"]$/g, ""));
	}
	return targets;
}

export function sourceUsesVitest(source) {
	return (
		/^\s*import\s+[^;\n]+?\s+from\s+["']vitest["']/m.test(source) ||
		/^\s*import\s+["']vitest["']/m.test(source) ||
		/@vitest-environment\b/.test(source)
	);
}

export function checkPackageScripts(packageJson, { root = ROOT } = {}) {
	const violations = [];
	for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
		if (typeof command !== "string") continue;
		for (const target of nodeTestTargets(command)) {
			const absPath = path.resolve(root, target);
			if (!existsSync(absPath)) continue;
			const source = readFileSync(absPath, "utf8");
			if (sourceUsesVitest(source)) {
				violations.push({
					script: scriptName,
					target,
					message: `${scriptName} runs ${target} with node --test, but the file uses Vitest.`,
				});
			}
		}
	}
	return violations;
}

function main() {
	const packageJsonPath = path.join(ROOT, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	const violations = checkPackageScripts(packageJson, { root: ROOT });

	if (violations.length === 0) {
		console.log("test-runner contracts: OK");
		return;
	}

	console.error("test-runner contracts: mixed runner usage detected");
	for (const violation of violations) {
		console.error(`- ${violation.message}`);
		console.error("  Use Vitest for files importing from vitest; reserve node --test for node:test suites.");
	}
	process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
