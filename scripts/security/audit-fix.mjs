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

function quoteYamlScalar(value) {
	const text = String(value);
	if (/^[A-Za-z0-9_.-]+$/.test(text)) return text;
	return JSON.stringify(text);
}

function readWorkspaceOverrides() {
	const text = readFileSync(WORKSPACE_FILE, "utf-8");
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === "overrides:");
	if (start === -1) return { text, lines, start: -1, end: -1, overrides: {} };

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\S/.test(line) && line.trim() !== "") {
			end = i;
			break;
		}
	}

	const overrides = {};
	for (const line of lines.slice(start + 1, end)) {
		const match = line.match(/^  (?<key>.+?):\s*(?<value>.+?)\s*$/);
		if (!match?.groups) continue;
		const key = match.groups.key.replace(/^["']|["']$/g, "");
		const value = match.groups.value.replace(/^["']|["']$/g, "");
		overrides[key] = value;
	}

	return { text, lines, start, end, overrides };
}

function writeWorkspaceOverrides(state) {
	const entries = Object.entries(state.overrides).sort(([a], [b]) => a.localeCompare(b));
	const block = ["overrides:", ...entries.map(([key, value]) => `  ${quoteYamlScalar(key)}: ${quoteYamlScalar(value)}`)];

	const lines =
		state.start === -1
			? [...state.lines.filter((line, index) => index !== state.lines.length - 1 || line !== ""), ...block, ""]
			: [...state.lines.slice(0, state.start), ...block, ...state.lines.slice(state.end)];

	if (DRY_RUN) {
		console.log(`  [dry-run] would write ${path.relative(ROOT, WORKSPACE_FILE)}`);
		return;
	}

	writeFileSync(WORKSPACE_FILE, lines.join("\n"));
	console.log(`  ✏  wrote ${path.relative(ROOT, WORKSPACE_FILE)}`);
}

function run(cmd, args, opts = {}) {
	return spawnSync(cmd, args, { encoding: "utf-8", cwd: ROOT, ...opts });
}

function normalizeAuditVulnerabilities(report) {
	if (report.vulnerabilities && Object.keys(report.vulnerabilities).length > 0) {
		return report.vulnerabilities;
	}

	const advisories = report.advisories ?? {};
	const byPackage = {};
	for (const advisory of Object.values(advisories)) {
		const name = advisory.module_name;
		if (!name || byPackage[name]) continue;
		byPackage[name] = {
			range: advisory.vulnerable_versions ?? "",
			patchedVersions: advisory.patched_versions ?? "",
			fixAvailable: Boolean(advisory.patched_versions),
		};
	}
	return byPackage;
}

/** Minimum patched version when the audit report exposes one, otherwise best effort above the vulnerable range. */
function safeVersionFor(pkg, vuln) {
	const patchedVersions = vuln.patchedVersions ?? vuln.patched_versions ?? "";
	const patchedMinimum = patchedVersions.match(/^>=\s*(\S+)/)?.[1];
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
const workspacePkgs = workspaceFiles.map((f) => ({ file: f, data: readJson(f) }));

let changed = false;

for (const [name, vuln] of Object.entries(vulns)) {
	const range = vuln.range ?? vuln.vulnerable_versions ?? "";
	if (!range || vuln.fixAvailable === false) {
		console.log(`⚠️  ${name}: no automatic fix available — review manually.`);
		continue;
	}

	const safe = safeVersionFor(name, vuln);
	if (!safe) {
		console.log(`⚠️  ${name}: could not determine safe version for range "${range}".`);
		continue;
	}

	console.log(`📦 ${name}  vulnerable: ${range}  →  safe: ${safe}`);

	// 1. Bump workspace override if it exists and is in the vulnerable range.
	if (workspaceOverrideState.overrides[name]) {
		const current = workspaceOverrideState.overrides[name];
		console.log(`   override ${current} → ${safe}`);
		workspaceOverrideState.overrides[name] = safe;
		changed = true;
	}

	// 2. Bump direct deps in every workspace that carries this package
	let directDependencyChanged = false;
	for (const { file, data } of workspacePkgs) {
		for (const depField of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
			if (data[depField]?.[name]) {
				const current = data[depField][name];
				if (current.startsWith("catalog:")) {
					console.log(`   ${path.relative(ROOT, path.dirname(file))}  ${depField}.${name}: ${current} (kept; catalog policy stays centralized)`);
					continue;
				}
				const next = `^${safe}`;
				if (current === next) continue;
				console.log(`   ${path.relative(ROOT, path.dirname(file))}  ${depField}.${name}: ${current} → ${next}`);
				data[depField][name] = next;
				writeJson(file, data);
				changed = true;
				directDependencyChanged = true;
			}
		}
	}

	// 3. If direct deps are absent, catalog-managed, or already safe, add a workspace override
	// to remediate vulnerable transitive copies without scattering package-level pins.
	if (!directDependencyChanged && !workspaceOverrideState.overrides[name]) {
		console.log(`   adding workspace override: ${name} → ${safe}`);
		workspaceOverrideState.overrides[name] = safe;
		changed = true;
	}
}

if (changed) {
	writeWorkspaceOverrides(workspaceOverrideState);
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
