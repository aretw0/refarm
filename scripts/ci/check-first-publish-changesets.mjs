#!/usr/bin/env node
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildReleaseCheckPlan,
	parseReleaseCheckArgs,
} from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parseChangesets(root = ROOT) {
	const changesetDir = path.join(root, ".changeset");
	const entries = [];

	for (const entry of readdirSync(changesetDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") {
			continue;
		}
		const text = readFileSync(path.join(changesetDir, entry.name), "utf8");
		const match = text.match(/^---\n([\s\S]*?)\n---/);
		if (!match) continue;

		for (const line of match[1].split("\n")) {
			const parsed = line.match(/^"([^"]+)":\s*(patch|minor|major)\s*$/);
			if (!parsed) continue;
			entries.push({
				file: entry.name,
				packageName: parsed[1],
				bump: parsed[2],
			});
		}
	}

	return entries;
}

export function findFirstPublishChangesetRisks({
	root = ROOT,
	selectionId = "vault-seed-ready",
	packageNames = [],
} = {}) {
	const check = buildReleaseCheckPlan({
		cwd: root,
		selectionId,
		packageNames,
		env: process.env,
	});
	if (!check.ok) {
		throw new Error(`release plan is not accepted for selection "${selectionId}"`);
	}

	const plannedPackages = new Map(check.plan.orderedPackages.map((pkg) => [pkg.name, pkg]));
	const changesets = parseChangesets(root);
	return changesets
		.filter((entry) => plannedPackages.has(entry.packageName))
		.map((entry) => ({
			...entry,
			currentVersion: plannedPackages.get(entry.packageName).currentVersion,
		}))
		.filter((entry) => entry.currentVersion === "0.1.0");
}

export function readWorkspacePackageVersions(root = ROOT) {
	const versions = new Map();
	const packagesDir = path.join(root, "packages");
	if (!existsSync(packagesDir)) return versions;

	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = path.join(packagesDir, entry.name, "package.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (manifest.name && manifest.version) {
				versions.set(manifest.name, manifest.version);
			}
		} catch {
			// An unreadable manifest is another lane's problem, not this guard's.
		}
	}

	return versions;
}

export function findOutOfSelectionBaselineRisks({
	root = ROOT,
	selectionId = "vault-seed-ready",
	packageNames = [],
} = {}) {
	const check = buildReleaseCheckPlan({
		cwd: root,
		selectionId,
		packageNames,
		env: process.env,
	});
	if (!check.ok) {
		throw new Error(`release plan is not accepted for selection "${selectionId}"`);
	}

	const plannedNames = new Set(check.plan.orderedPackages.map((pkg) => pkg.name));
	const workspaceVersions = readWorkspacePackageVersions(root);
	return parseChangesets(root)
		.filter((entry) => !plannedNames.has(entry.packageName))
		.map((entry) => ({
			...entry,
			currentVersion: workspaceVersions.get(entry.packageName) ?? null,
		}))
		.filter((entry) => entry.currentVersion === "0.1.0");
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const rawArgs = process.argv.slice(2);
	const soft = rawArgs.includes("--soft");
	const options = parseReleaseCheckArgs(rawArgs.filter((arg) => arg !== "--soft"));
	const risks = findFirstPublishChangesetRisks({
		root: ROOT,
		selectionId: options.selectionId,
		packageNames: options.packageNames,
	});
	const baselineRisks = findOutOfSelectionBaselineRisks({
		root: ROOT,
		selectionId: options.selectionId,
		packageNames: options.packageNames,
	});

	if (risks.length > 0 || baselineRisks.length > 0) {
		writeGithubOutput({
			blocked: "true",
			risk_count: String(risks.length + baselineRisks.length),
		});
		console.error("[first-publish:changesets] Changesets versioning is blocked for first-publish packages.");
		if (risks.length > 0) {
			console.error("[first-publish:changesets] These packages already declare 0.1.0 and must be published as-is first:");
			for (const risk of risks) {
				console.error(`  - ${risk.packageName}@${risk.currentVersion}: ${risk.bump} in .changeset/${risk.file}`);
			}
		}
		if (baselineRisks.length > 0) {
			console.error(`[first-publish:changesets] These packages are outside selection "${options.selectionId}" but still await their own first publish; versioning would bump them before they ever reach the registry:`);
			for (const risk of baselineRisks) {
				console.error(`  - ${risk.packageName}@${risk.currentVersion}: ${risk.bump} in .changeset/${risk.file}`);
			}
		}
		console.error("[first-publish:changesets] Use the explicit first-publish lane for 0.1.0, then resume changesets for later releases.");
		process.exit(soft ? 0 : 1);
	}

	writeGithubOutput({
		blocked: "false",
		risk_count: "0",
	});
	console.log(`[first-publish:changesets] ok for selection ${options.selectionId}`);
}

function writeGithubOutput(values) {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath) return;
	const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}
