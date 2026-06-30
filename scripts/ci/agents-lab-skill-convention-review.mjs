#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentsLabSkillSourceReview } from "./agents-lab-skill-source-review.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SOURCE_DIR =
	process.env.AGENTS_LAB_SOURCE_DIR ??
	"/home/vscode/.cache/checkouts/github.com/aretw0/agents-lab";
const SCHEMA_VERSION = 1;
const GIT_WORKFLOW_SKILL_ID = "git-skills";

const SOURCE_ALIGNMENT_MARKERS = [
	{
		id: "commit-message-cli",
		marker: "git commit -m",
		summary: "Commits pass the message on the command line.",
	},
	{
		id: "rebase-no-editor",
		marker: "GIT_EDITOR=true git rebase --continue",
		summary: "Rebase continuation avoids an interactive editor.",
	},
	{
		id: "merge-no-editor",
		marker: "git merge --no-edit",
		summary: "Merge guidance avoids opening an editor.",
	},
	{
		id: "github-prompts-disabled",
		marker: "GH_PROMPT_DISABLED=1",
		summary: "GitHub CLI examples disable prompts.",
	},
	{
		id: "explicit-interaction-only",
		marker: "Only allow interactive editors or prompts when the user explicitly asks for them.",
		summary: "Interactive prompts require explicit operator intent.",
	},
];

const REFARM_OVERLAY_REQUIREMENTS = [
	{
		id: "start-slice-operator-loop",
		requiredMarker: "refarm resume --json",
		overlay:
			"Start every Refarm slice with refarm resume --json and refarm check --next-action --json before git workflow advice.",
	},
	{
		id: "after-edit-gate",
		requiredMarker: "refarm agent finish --lane after-edit --run --json",
		overlay:
			"After source edits, run the Refarm after-edit finish lane and follow nextCommands before commit advice.",
	},
	{
		id: "after-commit-gate",
		requiredMarker: "refarm agent finish --lane after-commit --run --json",
		overlay:
			"After an atomic commit, run the Refarm after-commit finish lane and follow nextCommands.",
	},
	{
		id: "handoff-contract-gate",
		requiredMarker: "refarm agent finish --lane handoffs --run --json",
		overlay:
			"After public JSON or CLI contract changes, run the handoffs lane before closing the slice.",
	},
	{
		id: "source-sovereignty",
		requiredMarker: "NEVER Edit Artifacts",
		overlay:
			"Keep Refarm source sovereignty explicit: do not edit generated dist, build, or ignored artifacts.",
	},
	{
		id: "high-impact-confirmation",
		requiredMarker: "No silent high-impact actions",
		overlay:
			"Require explicit confirmation before destructive or wide-impact git operations.",
	},
];

const DISALLOWED_SOURCE_MARKERS = [
	{
		id: "reset-hard",
		marker: "git reset --hard",
		reason: "Refarm requires explicit confirmation for destructive resets.",
	},
	{
		id: "checkout-discard",
		marker: "git checkout --",
		reason: "Refarm must not discard user changes without explicit request.",
	},
];

function issue({ code, message, evidence = null }) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

function readText(filePath) {
	if (!existsSync(filePath)) return null;
	return readFileSync(filePath, "utf8");
}

function findGitWorkflowEntry(review) {
	return review.entries.find((entry) => entry.id === GIT_WORKFLOW_SKILL_ID) ?? null;
}

function buildAlignment(skillText) {
	return SOURCE_ALIGNMENT_MARKERS.map((check) => ({
		id: check.id,
		ok: skillText.includes(check.marker),
		marker: check.marker,
		summary: check.summary,
	}));
}

function buildOverlayRequirements({ skillText, agentsText }) {
	return REFARM_OVERLAY_REQUIREMENTS.map((requirement) => ({
		id: requirement.id,
		coveredBySkill: skillText.includes(requirement.requiredMarker),
		coveredByAgents: agentsText.includes(requirement.requiredMarker),
		requiredMarker: requirement.requiredMarker,
		overlay: requirement.overlay,
	}));
}

function buildDisallowedFindings(skillText) {
	return DISALLOWED_SOURCE_MARKERS.map((check) => ({
		id: check.id,
		present: skillText.includes(check.marker),
		marker: check.marker,
		reason: check.reason,
	})).filter((check) => check.present);
}

export function buildAgentsLabSkillConventionReview({
	root = DEFAULT_ROOT,
	sourceDir = DEFAULT_SOURCE_DIR,
} = {}) {
	const sourceReview = buildAgentsLabSkillSourceReview({ root, sourceDir });
	const issues = [];
	const gitWorkflow = findGitWorkflowEntry(sourceReview);
	const agentsPath = path.join(root, "AGENTS.md");
	const agentsText = readText(agentsPath);

	if (!sourceReview.ok) {
		issues.push(issue({
			code: "SKILL_SOURCE_REVIEW_NOT_READY",
			message: "Agents-lab skill source review must pass before convention review.",
			evidence: sourceReview.issues,
		}));
	}

	if (!gitWorkflow?.found) {
		issues.push(issue({
			code: "GIT_WORKFLOW_SKILL_MISSING",
			message: "git-workflow SKILL.md must be available for convention review.",
			evidence: gitWorkflow?.sourcePath ?? GIT_WORKFLOW_SKILL_ID,
		}));
	}

	if (!agentsText) {
		issues.push(issue({
			code: "REFARM_AGENTS_MISSING",
			message: "AGENTS.md is required to compare Refarm conventions.",
			evidence: agentsPath,
		}));
	}

	const skillPath = gitWorkflow ? path.join(sourceDir, gitWorkflow.sourcePath) : null;
	const skillText = skillPath ? readText(skillPath) : null;

	if (!skillText) {
		issues.push(issue({
			code: "GIT_WORKFLOW_TEXT_MISSING",
			message: "git-workflow source text could not be read.",
			evidence: skillPath,
		}));
	}

	const alignment = skillText ? buildAlignment(skillText) : [];
	const missingAlignment = alignment.filter((check) => !check.ok);
	const overlayRequirements =
		skillText && agentsText ? buildOverlayRequirements({ skillText, agentsText }) : [];
	const missingOverlay = overlayRequirements.filter((check) => !check.coveredBySkill);
	const disallowed = skillText ? buildDisallowedFindings(skillText) : [];
	const decision =
		issues.length > 0
			? "blocked"
			: disallowed.length > 0 || missingAlignment.length > 0
				? "reject-or-edit-source-before-install"
				: missingOverlay.length > 0
					? "requires-refarm-wrapper-before-install"
					: "ready-for-installation-review";

	return {
		schemaVersion: SCHEMA_VERSION,
		command: "agents-lab-skill-convention-review",
		ok: issues.length === 0,
		sourceReview: "agents-lab-skill-source-review",
		mode: "convention-review-only",
		target: {
			id: GIT_WORKFLOW_SKILL_ID,
			sourcePath: gitWorkflow?.sourcePath ?? null,
			sha256: gitWorkflow?.sha256 ?? null,
			frontmatter: gitWorkflow?.frontmatter ?? null,
		},
		decision,
		installNow: false,
		adapterSmokeReady: decision === "ready-for-installation-review",
		summary: {
			sourceAlignmentPassed: alignment.filter((check) => check.ok).length,
			sourceAlignmentTotal: alignment.length,
			disallowedSourceMarkerCount: disallowed.length,
			refarmOverlayMissingCount: missingOverlay.length,
		},
		sourceAlignment: alignment,
		disallowedSourceMarkers: disallowed,
		refarmOverlayRequirements: overlayRequirements,
		boundaries: [
			"This review does not install, copy, or vendor the agents-lab skill.",
			"Non-interactive git guidance is useful, but Refarm operator-loop rules must wrap it.",
			"Adapter smoke remains blocked until the Refarm wrapper is written and reviewed.",
		],
		nextActions:
			decision === "requires-refarm-wrapper-before-install"
				? [
					"Draft a Refarm git-workflow wrapper that prepends operator-loop, source-sovereignty, and confirmation rules.",
					"Keep upstream git-workflow as source evidence instead of copying it directly into a runtime path.",
					"Only then select a minimal SKILL.md invocation smoke.",
				]
				: [
					"Resolve convention review issues before installation or adapter smoke planning.",
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
	const review = buildAgentsLabSkillConventionReview({
		root: process.cwd(),
		...(sourceDir ? { sourceDir } : {}),
	});
	if (json) {
		console.log(JSON.stringify(review, null, 2));
	} else if (review.ok) {
		console.log(`agents-lab-skill-convention-review: ${review.decision}`);
	} else {
		console.log(`agents-lab-skill-convention-review: blocked (${review.issueCount} issue(s))`);
		for (const item of review.issues) {
			console.log(`- ${item.code}: ${item.message}`);
		}
	}
	if (!review.ok) process.exit(1);
}
