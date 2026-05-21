#!/usr/bin/env node
/**
 * audit-fix.mjs — automated pnpm audit remediation
 *
 * What pnpm audit doesn't handle:
 *   1. Root overrides that pin a transitive dep to a vulnerable version
 *   2. Workspace direct deps that are in the vulnerable range
 *   3. Purely transitive deps that need a new root override
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRY_RUN = process.argv.includes("--dry-run");
const PACKAGE_MANAGER = detectPackageManager({ cwd: ROOT });

// ── helpers ──────────────────────────────────────────────────────────────────

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf-8"));
}

function writeJson(file, data) {
	if (DRY_RUN) { console.log(`  [dry-run] would write ${path.relative(ROOT, file)}`); return; }
	writeFileSync(file, JSON.stringify(data, null, "\t") + "\n");
	console.log(`  ✏  wrote ${path.relative(ROOT, file)}`);
}

function run(cmd, args, opts = {}) {
	return spawnSync(cmd, args, { encoding: "utf-8", cwd: ROOT, ...opts });
}

/** Minimum version that's strictly greater than the vulnerable range end. */
function safeVersionFor(pkg, vulnerableRange) {
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
		`[security:audit-fix] Unsupported package manager "${PACKAGE_MANAGER}". This fixer edits pnpm.overrides and currently supports pnpm only.`,
	);
	process.exit(1);
}

const auditResult = run("pnpm", ["audit", "--json"]);
const report = JSON.parse(auditResult.stdout || "{}");
const vulns = report.vulnerabilities ?? {};

if (Object.keys(vulns).length === 0) {
	console.log("✅ No vulnerabilities — nothing to fix.");
	process.exit(0);
}

console.log(`🔍 Found ${Object.keys(vulns).length} vulnerable package(s). Analysing...\n`);

const rootPkg = readJson(path.join(ROOT, "package.json"));
rootPkg.pnpm ??= {};
rootPkg.pnpm.overrides ??= {};

const workspaceFiles = await workspacePackageFiles();
const workspacePkgs = workspaceFiles.map((f) => ({ file: f, data: readJson(f) }));

let changed = false;

for (const [name, vuln] of Object.entries(vulns)) {
	const range = vuln.range ?? "";
	if (!range || vuln.fixAvailable === false) {
		console.log(`⚠️  ${name}: no automatic fix available — review manually.`);
		continue;
	}

	const safe = safeVersionFor(name, range);
	if (!safe) {
		console.log(`⚠️  ${name}: could not determine safe version for range "${range}".`);
		continue;
	}

	console.log(`📦 ${name}  vulnerable: ${range}  →  safe: ${safe}`);

	// 1. Bump root override if it exists and is in the vulnerable range
	if (rootPkg.pnpm.overrides[name]) {
		const current = rootPkg.pnpm.overrides[name];
		console.log(`   override ${current} → ${safe}`);
		rootPkg.pnpm.overrides[name] = safe;
		changed = true;
	}

	// 2. Bump direct deps in every workspace that carries this package
	for (const { file, data } of workspacePkgs) {
		for (const depField of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
			if (data[depField]?.[name]) {
				const current = data[depField][name];
				const next = `^${safe}`;
				if (current === next) continue;
				console.log(`   ${path.relative(ROOT, path.dirname(file))}  ${depField}.${name}: ${current} → ${next}`);
				data[depField][name] = next;
				writeJson(file, data);
				changed = true;
			}
		}
	}

	// 3. If not a direct dep anywhere and no override yet, add one
	const isDirectAnywhere = workspacePkgs.some((w) =>
		["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
			(f) => w.data[f]?.[name],
		),
	);
	if (!isDirectAnywhere && !rootPkg.pnpm.overrides[name]) {
		console.log(`   adding root override: ${name} → ${safe}`);
		rootPkg.pnpm.overrides[name] = safe;
		changed = true;
	}
}

if (changed) {
	writeJson(path.join(ROOT, "package.json"), rootPkg);
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
