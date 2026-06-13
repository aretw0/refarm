#!/usr/bin/env node
/**
 * audit-fix.mjs — automated pnpm audit remediation
 *
 * What pnpm audit doesn't handle:
 *   1. Workspace overrides that pin a transitive dep to a vulnerable version
 *   2. Workspace direct deps that are in the vulnerable range
 *   3. Purely transitive deps that need a new workspace override
 *
 * This script does all three, then reinstalls and verifies.
 *
 * Usage:
 *   node scripts/security/audit-fix.mjs          # apply fixes
 *   node scripts/security/audit-fix.mjs --dry-run # preview changes only
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectPackageManager } from "../../packages/config/src/package-manager.js";
import {
	normalizeAuditVulnerabilities,
	parseWorkspaceOverridesText,
	patchedMinimumVersion,
	planAuditFixes,
	renderWorkspaceOverridesText,
} from "./audit-fix-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRY_RUN = process.argv.includes("--dry-run");
const PACKAGE_MANAGER = detectPackageManager({ cwd: ROOT });
const WORKSPACE_FILE = path.join(ROOT, "pnpm-workspace.yaml");

// ── helpers ──────────────────────────────────────────────────────────────────

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf-8"));
}

function writeJson(file, data) {
	if (DRY_RUN) { console.log(`  [dry-run] would write ${path.relative(ROOT, file)}`); return; }
	writeFileSync(file, JSON.stringify(data, null, "\t") + "\n");
	console.log(`  ✏  wrote ${path.relative(ROOT, file)}`);
}

function readWorkspaceOverrides() {
	const text = readFileSync(WORKSPACE_FILE, "utf-8");
	return parseWorkspaceOverridesText(text);
}

function writeWorkspaceOverrides(state) {
	if (DRY_RUN) {
		console.log(`  [dry-run] would write ${path.relative(ROOT, WORKSPACE_FILE)}`);
		return;
	}

	writeFileSync(WORKSPACE_FILE, renderWorkspaceOverridesText(state));
	console.log(`  ✏  wrote ${path.relative(ROOT, WORKSPACE_FILE)}`);
}

function run(cmd, args, opts = {}) {
	return spawnSync(cmd, args, { encoding: "utf-8", cwd: ROOT, ...opts });
}

/** Minimum patched version when the audit report exposes one, otherwise best effort above the vulnerable range. */
function safeVersionFor(pkg, vuln) {
	const patchedMinimum = patchedMinimumVersion(vuln);
	if (patchedMinimum) return patchedMinimum;

	const vulnerableRange = vuln.range ?? vuln.vulnerable_versions ?? "";
	// pnpm view returns all versions matching a range (same registry API as npm view)
	const above = run("pnpm", ["view", `${pkg}@>${vulnerableRange.split(" - ").pop()}`, "version", "--json"]);
	if (above.status !== 0) return null;
	try {
		const parsed = JSON.parse(above.stdout.trim());
		const versions = Array.isArray(parsed) ? parsed : [parsed];
		return versions[0] ?? null; // first (lowest) version above the range
	} catch { return null; }
}

/** All workspace package.json paths (packages/* + apps/*). */
async function workspacePackageFiles() {
	const roots = ["packages", "apps"];
	const files = [];
	for (const dir of roots) {
		const abs = path.join(ROOT, dir);
		if (!existsSync(abs)) continue;
		const entries = await readdir(abs, { withFileTypes: true });
		for (const e of entries) {
			const pkgFile = path.join(abs, e.name, "package.json");
			if (e.isDirectory() && existsSync(pkgFile)) files.push(pkgFile);
		}
	}
	return files;
}

// ── main ─────────────────────────────────────────────────────────────────────

if (PACKAGE_MANAGER !== "pnpm") {
	console.error(
		`[security:audit-fix] Unsupported package manager "${PACKAGE_MANAGER}". This fixer edits pnpm-workspace.yaml overrides and currently supports pnpm only.`,
	);
	process.exit(1);
}

const auditResult = run("pnpm", ["audit", "--json"]);
const report = JSON.parse(auditResult.stdout || "{}");
const vulns = normalizeAuditVulnerabilities(report);

if (Object.keys(vulns).length === 0) {
	console.log("✅ No vulnerabilities — nothing to fix.");
	process.exit(0);
}

console.log(`🔍 Found ${Object.keys(vulns).length} vulnerable package(s). Analysing...\n`);

const workspaceOverrideState = readWorkspaceOverrides();

const workspaceFiles = await workspacePackageFiles();
const workspacePkgs = workspaceFiles.map((f) => ({
	file: f,
	name: path.relative(ROOT, path.dirname(f)),
	data: readJson(f),
}));

const plan = planAuditFixes({
	vulnerabilities: vulns,
	workspacePackages: workspacePkgs,
	workspaceOverrides: workspaceOverrideState.overrides,
	safeVersionFor,
});

for (const message of plan.messages) {
	const prefix = message.level === "warn" ? "⚠️ " : "   ";
	console.log(`${prefix}${message.text}`);
}

for (const workspacePackage of plan.packageUpdates) {
	writeJson(workspacePackage.file, workspacePackage.data);
}

if (plan.changed) {
	writeWorkspaceOverrides({ ...workspaceOverrideState, overrides: plan.workspaceOverrides });
}

if (DRY_RUN) {
	console.log("\n[dry-run] No changes applied. Remove --dry-run to apply.");
	process.exit(0);
}

console.log("\n📥 Running pnpm install...");
const install = run("pnpm", ["install"], { stdio: "inherit" });
if (install.status !== 0) { console.error("❌ pnpm install failed."); process.exit(1); }

console.log("\n🔒 Verifying audit...");
const verify = run("pnpm", ["audit"]);
if (verify.status === 0) {
	console.log("✅ All vulnerabilities resolved.");
} else {
	console.log(verify.stdout);
	console.warn("⚠️  Some vulnerabilities remain. May require manual --force fix or accept as low-risk.");
	process.exit(1);
}
