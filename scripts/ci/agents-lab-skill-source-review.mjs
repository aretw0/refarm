#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAgentsLabSkillImportManifest } from "./agents-lab-skill-import-manifest.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SOURCE_DIR =
	process.env.AGENTS_LAB_SOURCE_DIR ??
	"/home/vscode/.cache/checkouts/github.com/aretw0/agents-lab";
const SCHEMA_VERSION = 1;

const REVIEW_TARGETS = {
	"git-skills": {
		sourcePath: "packages/git-skills/skills/git-workflow/SKILL.md",
		decision: "accepted-after-refarm-convention-review",
		requiredEdits: [],
		refarmFit: "operator git workflow guidance",
		notes: [
			"General Markdown skill with no Pi extension runtime requirement.",
			"Must still be checked against Refarm AGENTS.md git and handoff conventions before installation.",
		],
	},
	"lab-skills.cultivate-primitive": {
		sourcePath: "packages/lab-skills/skills/cultivate-primitive/SKILL.md",
		decision: "requires-refarm-edit-before-install",
		requiredEdits: [
			"Replace Pi package/runtime language with Refarm package, WIT, policy, and docs boundaries.",
			"Remove direct .pi/settings.json and /reload assumptions from the portable skill text.",
			"Replace agents-lab repository commands with neutral source-review or upstream-follow-up steps.",
		],
		refarmFit: "primitive cultivation workflow",
		notes: [
			"Good fit for deciding when a repeated workflow becomes a skill, package, policy, monitor, or plugin.",
			"Should guide package placement without creating product-app coupling.",
		],
	},
	"lab-skills.evaluate-extension": {
		sourcePath: "packages/lab-skills/skills/evaluate-extension/SKILL.md",
		decision: "requires-refarm-edit-before-install",
		requiredEdits: [
			"Generalize Pi extension wording into Refarm package/plugin/skill placement review.",
			"Map extension API concerns to Barn, plugin-manifest, Scarecrow, and policy-contract boundaries.",
			"Move scorecard output path into Refarm docs or project decision packets.",
		],
		refarmFit: "placement review for packages, plugins, and skills",
		notes: [
			"Useful immediately as review guidance.",
			"Must not import Pi extension APIs or hooks as Refarm enforcement.",
		],
	},
	"lab-skills.provider-model-discovery": {
		sourcePath: "packages/lab-skills/skills/provider-model-discovery/SKILL.md",
		decision: "requires-refarm-edit-before-install",
		requiredEdits: [
			"Replace Pi settings and route terminology with Refarm runtime, Silo, and budget handoff terms.",
			"Keep report-only defaults, no secret exposure, no paid spend, and no prompt calls without approval.",
			"Move provider tests and docs paths to Refarm-owned packages before installation.",
		],
		refarmFit: "provider and model discovery guardrail",
		notes: [
			"Strong fit for quota visibility and model-route governance.",
			"Preserve the report-only posture as the default Refarm policy.",
		],
	},
};

function issue({ code, message, evidence = null }) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

function parseFrontmatter(text) {
	if (!text.startsWith("---\n")) return {};
	const end = text.indexOf("\n---", 4);
	if (end === -1) return {};
	const block = text.slice(4, end).split("\n");
	const data = {};
	let currentKey = null;
	for (const line of block) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (match) {
			currentKey = match[1];
			const value = match[2].trim();
			data[currentKey] = value === ">" || value === "|" ? "" : value;
			continue;
		}
		if (currentKey && line.trim()) {
			data[currentKey] = `${data[currentKey]} ${line.trim()}`.trim();
		}
	}
	return data;
}

function runGit(sourceDir, args) {
	const result = spawnSync("git", ["-C", sourceDir, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) return null;
	return result.stdout.trim();
}

function buildSourceState(sourceDir) {
	if (!existsSync(sourceDir)) {
		return {
			path: sourceDir,
			exists: false,
			revision: null,
			clean: null,
		};
	}
	const revision = runGit(sourceDir, ["rev-parse", "HEAD"]);
	const status = runGit(sourceDir, ["status", "--short"]);
	return {
		path: sourceDir,
		exists: true,
		revision,
		clean: typeof status === "string" ? status.length === 0 : null,
		...(status ? { status } : {}),
	};
}

function readReviewEntry({ sourceDir, plannedEntry }) {
	const target = REVIEW_TARGETS[plannedEntry.id];
	if (!target) {
		return {
			entry: null,
			issue: issue({
				code: "SKILL_REVIEW_TARGET_MISSING",
				message: `No source review target is declared for ${plannedEntry.id}.`,
				evidence: plannedEntry.id,
			}),
		};
	}

	const absolutePath = path.join(sourceDir, target.sourcePath);
	if (!existsSync(absolutePath)) {
		return {
			entry: {
				id: plannedEntry.id,
				sourcePath: target.sourcePath,
				found: false,
				decision: "blocked-source-missing",
				requiredEdits: target.requiredEdits,
				refarmFit: target.refarmFit,
				notes: target.notes,
			},
			issue: issue({
				code: "SKILL_SOURCE_FILE_MISSING",
				message: `Expected agents-lab skill source is missing for ${plannedEntry.id}.`,
				evidence: target.sourcePath,
			}),
		};
	}

	const text = readFileSync(absolutePath, "utf8");
	const frontmatter = parseFrontmatter(text);
	return {
		entry: {
			id: plannedEntry.id,
			sourcePath: target.sourcePath,
			found: true,
			sha256: sha256(text),
			bytes: Buffer.byteLength(text),
			frontmatter: {
				name: frontmatter.name ?? null,
				description: frontmatter.description ?? null,
			},
			decision: target.decision,
			requiredEdits: target.requiredEdits,
			refarmFit: target.refarmFit,
			runtimeRequired: false,
			installNow: false,
			notes: target.notes,
		},
		issue: null,
	};
}

export function buildAgentsLabSkillSourceReview({
	root = DEFAULT_ROOT,
	sourceDir = DEFAULT_SOURCE_DIR,
} = {}) {
	const manifest = buildAgentsLabSkillImportManifest({ root });
	const sourceState = buildSourceState(sourceDir);
	const issues = [];
	const entries = [];

	if (!manifest.ok) {
		issues.push(issue({
			code: "SKILL_IMPORT_MANIFEST_NOT_READY",
			message: "Agents-lab skill import manifest must pass before source review.",
			evidence: manifest.issues,
		}));
	}

	if (!sourceState.exists) {
		issues.push(issue({
			code: "AGENTS_LAB_SOURCE_DIR_MISSING",
			message: "Agents-lab source checkout is required for source review.",
			evidence: sourceDir,
		}));
	}

	for (const plannedEntry of manifest.entries) {
		const { entry, issue: entryIssue } = readReviewEntry({ sourceDir, plannedEntry });
		if (entry) entries.push(entry);
		if (entryIssue) issues.push(entryIssue);
	}

	const installableAfterReview = entries.filter(
		(entry) => entry.decision === "accepted-after-refarm-convention-review",
	);
	const requiresEdits = entries.filter(
		(entry) => entry.decision === "requires-refarm-edit-before-install",
	);

	return {
		schemaVersion: SCHEMA_VERSION,
		command: "agents-lab-skill-source-review",
		ok: issues.length === 0,
		sourceManifest: "agents-lab-skill-import-manifest",
		mode: "source-review-only",
		source: sourceState,
		summary: {
			plannedSkillCount: manifest.entries.length,
			reviewedSkillCount: entries.filter((entry) => entry.found).length,
			installNowCount: entries.filter((entry) => entry.installNow).length,
			acceptedAfterConventionReviewCount: installableAfterReview.length,
			requiresEditCount: requiresEdits.length,
		},
		entries,
		boundaries: [
			"No agents-lab file is installed or vendored by this review.",
			"Accepted-after-review means the text can be considered for a Refarm skill path after convention review.",
			"Requires-edit means the source is valuable, but Pi/product-specific assumptions must be removed first.",
			"Runtime-agent execution remains deferred; wrapper smokes may only record approved engine-call receipts.",
		],
		nextActions: [
			"Review git-workflow text against Refarm AGENTS.md and operator CLI handoff rules.",
			"Patch or upstream-follow-up lab-skills wording before any Refarm wrapper.",
			"Use the reviewed git-workflow source as external evidence for the Refarm wrapper smoke.",
		],
		issueCount: issues.length,
		issues,
	};
}

function parseArgs(argv = []) {
	const args = argv.filter((arg) => arg !== "--");
	const json = args.includes("--json");
	const sourceDirIndex = args.indexOf("--source-dir");
	const sourceDir = sourceDirIndex >= 0 ? args[sourceDirIndex + 1] : undefined;
	const known = new Set(["--json", "--source-dir", sourceDir]);
	const unknown = args.filter((arg) => !known.has(arg));
	if (sourceDirIndex >= 0 && !sourceDir) unknown.push("--source-dir");
	return { json, sourceDir, unknown };
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const { json, sourceDir, unknown } = parseArgs(process.argv.slice(2));
	if (unknown.length > 0) {
		console.error(`Unknown argument: ${unknown[0]}`);
		process.exit(1);
	}
	const review = buildAgentsLabSkillSourceReview({
		root: process.cwd(),
		...(sourceDir ? { sourceDir } : {}),
	});
	if (json) {
		console.log(JSON.stringify(review, null, 2));
	} else if (review.ok) {
		console.log(
			`agents-lab-skill-source-review: ok (${review.summary.reviewedSkillCount} reviewed skill(s))`,
		);
	} else {
		console.log(`agents-lab-skill-source-review: blocked (${review.issueCount} issue(s))`);
		for (const item of review.issues) {
			console.log(`- ${item.code}: ${item.message}`);
		}
	}
	if (!review.ok) process.exit(1);
}
