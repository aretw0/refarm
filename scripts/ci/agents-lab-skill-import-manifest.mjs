#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildAgentsLabAssimilationAudit } from "./agents-lab-assimilation-audit.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_VERSION = 1;

const SKILL_SOURCES = {
	"git-skills": {
		repository: "aretw0/agents-lab",
		package: "git-skills",
		pathHint: "git-skills",
		reviewFocus: [
			"commit conventions",
			"branch naming",
			"PR and handoff workflow",
			"Refarm AGENTS.md compatibility",
		],
	},
	"lab-skills.cultivate-primitive": {
		repository: "aretw0/agents-lab",
		package: "lab-skills",
		pathHint: "lab-skills/cultivate-primitive",
		reviewFocus: [
			"WIT/package creation guidance",
			"package boundary discipline",
			"Refarm source/artifact sovereignty",
		],
	},
	"lab-skills.evaluate-extension": {
		repository: "aretw0/agents-lab",
		package: "lab-skills",
		pathHint: "lab-skills/evaluate-extension",
		reviewFocus: [
			"core/package/plugin placement",
			"Pi extension API references",
			"Barn/plugin-manifest/Scarecrow alignment",
		],
	},
	"lab-skills.provider-model-discovery": {
		repository: "aretw0/agents-lab",
		package: "lab-skills",
		pathHint: "lab-skills/provider-model-discovery",
		reviewFocus: [
			"model route discovery",
			"Silo credential boundary",
			"provider budget visibility",
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

function skillImportEntries(audit) {
	return audit.entries
		.filter((entry) => entry.action === "import-now" && entry.sourceKind === "markdown-skill")
		.map((entry) => {
			const source = SKILL_SOURCES[entry.id];
			return {
				id: entry.id,
				status: "planned-review",
				source,
				target: {
					format: "SKILL.md",
					surface: "markdown-skill",
					runtimeRequired: false,
					refarmPackage: null,
				},
				review: {
					required: true,
					focus: source?.reviewFocus ?? [],
					acceptance:
						"Skill instructions match Refarm conventions and introduce no Pi extension runtime dependency.",
				},
				boundary: entry.boundary,
			};
		});
}

export function buildAgentsLabSkillImportManifest({ root = DEFAULT_ROOT } = {}) {
	const audit = buildAgentsLabAssimilationAudit({ root });
	const entries = skillImportEntries(audit);
	const issues = [];

	if (!audit.ok) {
		issues.push(issue({
			code: "ASSIMILATION_AUDIT_NOT_READY",
			message: "Agents-lab assimilation audit must pass before skill imports are planned.",
			evidence: audit.issues,
		}));
	}

	for (const entry of entries) {
		if (!entry.source) {
			issues.push(issue({
				code: "SKILL_SOURCE_NOT_DECLARED",
				message: `Skill import candidate ${entry.id} must declare a source package/path hint.`,
				evidence: entry.id,
			}));
		}
		if (!entry.review.required) {
			issues.push(issue({
				code: "SKILL_REVIEW_NOT_REQUIRED",
				message: `Skill import candidate ${entry.id} must require convention review.`,
				evidence: entry.id,
			}));
		}
		if (entry.target.runtimeRequired) {
			issues.push(issue({
				code: "SKILL_IMPORT_REQUIRES_RUNTIME",
				message: `Skill import candidate ${entry.id} must not require Refarm skill runtime.`,
				evidence: entry.id,
			}));
		}
	}

	const expectedIds = Object.keys(SKILL_SOURCES);
	const actualIds = entries.map((entry) => entry.id);
	for (const expectedId of expectedIds) {
		if (!actualIds.includes(expectedId)) {
			issues.push(issue({
				code: "IMPORT_NOW_SKILL_MISSING",
				message: `Expected import-now skill ${expectedId} is missing from the manifest.`,
				evidence: expectedId,
			}));
		}
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		command: "agents-lab-skill-import-manifest",
		ok: issues.length === 0,
		sourceAudit: "agents-lab-assimilation-audit",
		mode: "plan-only",
		activationGate: {
			currentState: "native-skill-system-wrapper-dogfood-active",
			canStartNow: [
				"Use @refarm.dev/skill-contract-v1 as the native Refarm skill contract owner outside apps/refarm.",
				"Review git-skills against Refarm commit, branch, PR, and handoff conventions.",
				"Review lab-skills essentials for Pi-specific wording or extension API assumptions.",
				"Record accepted skill content, required edits, or upstream follow-up before wrapper work.",
			],
			unlocksRuntimeAdapterWhen: [
				"A Refarm skill contract can parse SKILL.md metadata into a policy-checkable manifest.",
				"At least one reviewed skill maps to an existing Refarm engine or capability.",
				"An invocation surface can execute a SKILL.md-derived plan without bypassing policy.",
				"The adapter can prove input/output envelopes and capability requirements in tests.",
				"A dogfood smoke runs the selected skill through Refarm and records engine calls.",
			],
			stillBlockedBy: [
				"No external skill is installed or vendored yet; wrappers must remain package-declared surfaces.",
				"Runtime-agent dispatch remains held by policy, cancellation, observability, and cost-control gates.",
				"Direct DGK runtime comparison remains pending after wrapper/evidence proof.",
			],
		},
		install: {
			performsInstall: false,
			requiresHumanReview: true,
			allowedSourceKind: "markdown-skill",
			disallowedSourceKinds: [
				"agents-lab-extension-runtime",
				"pi-extension-api",
			],
		},
		summary: {
			plannedSkillCount: entries.length,
			repositories: Array.from(new Set(entries.map((entry) => entry.source?.repository).filter(Boolean))).sort(),
			packages: Array.from(new Set(entries.map((entry) => entry.source?.package).filter(Boolean))).sort(),
		},
		entries,
		boundaries: [
			"No files are installed by this manifest.",
			"Only SKILL.md-style Markdown skills are in scope.",
			"Convention review and the native Refarm skill contract are mandatory before wrapping any skill.",
			"Pi extension APIs, hooks, and runtime packaging remain out of scope.",
			"External skills remain source evidence until package-declared wrapper smokes pass.",
		],
		nextActions: [
			"Inspect the source skill content from agents-lab.",
			"Record convention deltas before any local installation.",
			"Prefer skill text fixes upstream instead of local forks when possible.",
			"Use wrapper smokes as package-declared evidence before any installation or vendoring discussion.",
		],
		issueCount: issues.length,
		issues,
	};
}

function parseArgs(argv = []) {
	const args = argv.filter((arg) => arg !== "--");
	const json = args.includes("--json");
	const unknown = args.filter((arg) => arg !== "--json");
	return { json, unknown };
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const { json, unknown } = parseArgs(process.argv.slice(2));
	if (unknown.length > 0) {
		console.error(`Unknown argument: ${unknown[0]}`);
		process.exit(1);
	}
	const manifest = buildAgentsLabSkillImportManifest({ root: process.cwd() });
	if (json) {
		console.log(JSON.stringify(manifest, null, 2));
	} else if (manifest.ok) {
		console.log(
			`agents-lab-skill-import-manifest: ok (${manifest.summary.plannedSkillCount} planned skill(s))`,
		);
	} else {
		console.log(`agents-lab-skill-import-manifest: blocked (${manifest.issueCount} issue(s))`);
		for (const item of manifest.issues) {
			console.log(`- ${item.code}: ${item.message}`);
		}
	}
	if (!manifest.ok) process.exit(1);
}
