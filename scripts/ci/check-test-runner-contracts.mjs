#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function nodeTestTargets(command) {
	const targets = [];
	const pattern = /(?:^|[;&|]\s*)node\s+--test\b([^;&|]*)/g;
	let match;
	while ((match = pattern.exec(command)) !== null) {
		const tokens = match[1].match(/(?:"[^"]+"|'[^']+'|\S+)/g) ?? [];
		for (const token of tokens) {
			const target = token.replace(/^['"]|['"]$/g, "");
			if (!target || target === "--" || target.startsWith("-")) continue;
			targets.push(target);
		}
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

export function sourceUsesNestedSpawnSync(source) {
	return (
		/^\s*import\s+[^;\n]*\b(?:execFileSync|spawnSync)\b[^;\n]*\s+from\s+["']node:child_process["']/m.test(source) ||
		/\b(?:execFileSync|spawnSync)\s*\(/.test(source)
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

export function checkReleaseReadinessTestScript(packageJson, { root = ROOT } = {}) {
	const violations = [];
	const command = packageJson.scripts?.["release:readiness:test"];
	if (typeof command !== "string") return violations;

	for (const target of nodeTestTargets(command)) {
		const absPath = path.resolve(root, target);
		if (!existsSync(absPath)) continue;
		const source = readFileSync(absPath, "utf8");
		if (!sourceUsesNestedSpawnSync(source)) continue;
		violations.push({
			script: "release:readiness:test",
			target,
			message:
				"release:readiness:test must not run tests that use execFileSync/spawnSync; expose importable helpers so the gate works inside managed agent sandboxes.",
		});
	}
	return violations;
}

export function checkAppsRefarmScripts(packageJson) {
	const violations = [];
	const focusedCommand = packageJson.scripts?.["test:focused"];
	if (typeof focusedCommand === "string") {
		violations.push({
			script: "test:focused",
			target: "apps/refarm/package.json",
			message:
				"apps/refarm must not expose test:focused; use test:file or named scripts so agents do not treat app Vitest as a cheap generic gate.",
		});
	}
	return violations;
}

function main() {
	const packageJsonPath = path.join(ROOT, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	const appsRefarmPackageJsonPath = path.join(
		ROOT,
		"apps",
		"refarm",
		"package.json",
	);
	const appsRefarmPackageJson = JSON.parse(
		readFileSync(appsRefarmPackageJsonPath, "utf8"),
	);
	const violations = [
		...checkPackageScripts(packageJson, { root: ROOT }),
		...checkReleaseReadinessTestScript(packageJson, { root: ROOT }),
		...checkAppsRefarmScripts(appsRefarmPackageJson),
	];

	if (violations.length === 0) {
		console.log("test-runner contracts: OK");
		return;
	}

	console.error("test-runner contracts: violations detected");
	for (const violation of violations) {
		console.error(`- ${violation.message}`);
	}
	process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
