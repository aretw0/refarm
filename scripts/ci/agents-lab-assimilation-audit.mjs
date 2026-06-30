#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_VERSION = 1;
const SPEC_PATH = "docs/superpowers/specs/2026-05-14-agents-lab-portability.md";
const SUPPLY_MAP_PATH = "docs/ECOSYSTEM_SUPPLY_MAP.md";
const REFERENCE_DRIVER_PATH = "docs/REFERENCE_AGENT_DRIVER_RESEARCH.md";

const IMPORT_NOW = [
	{
		id: "git-skills",
		sourceKind: "markdown-skill",
		action: "import-now",
		refarmTarget: "skills workflow guidance",
		boundary: "Verify against Refarm conventions before treating as authoritative.",
	},
	{
		id: "lab-skills.cultivate-primitive",
		sourceKind: "markdown-skill",
		action: "import-now",
		refarmTarget: "WIT/package primitive cultivation workflow",
		boundary: "Keep skill copy portable; implementation remains Refarm package/spec owned.",
	},
	{
		id: "lab-skills.evaluate-extension",
		sourceKind: "markdown-skill",
		action: "import-now",
		refarmTarget: "core/package/plugin placement review",
		boundary: "Use for placement decisions; do not import Pi extension APIs.",
	},
	{
		id: "lab-skills.provider-model-discovery",
		sourceKind: "markdown-skill",
		action: "import-now",
		refarmTarget: "model/provider setup guidance",
		boundary: "Surface provider discovery without weakening Silo/model route policy.",
	},
	{
		id: "project-memory-schema",
		sourceKind: "shared-json-protocol",
		action: "already-compatible",
		refarmTarget: ".project decisions/handoff/tasks/requirements/verification",
		boundary: "Shared schema is a durable context bridge, not implicit session memory.",
	},
];

const CULTIVATE = [
	{
		id: "context-watchdog",
		sourceKind: "agents-lab-concept",
		action: "cultivate-refarm-primitive",
		refarmTarget: "tunable context compaction in runtime/digest policy",
		boundary: "Do not hardcode Pi-specific 50/68/72 percent thresholds.",
	},
	{
		id: "guardrails-core",
		sourceKind: "agents-lab-concept",
		action: "cultivate-refarm-primitive",
		refarmTarget: "Scarecrow WIT host policy and denial-path proof",
		boundary: "Pi beforeToolCall/afterToolCall hooks do not become Refarm enforcement.",
	},
	{
		id: "quota-visibility",
		sourceKind: "agents-lab-concept",
		action: "cultivate-refarm-primitive",
		refarmTarget: "budget and usage visibility handoff",
		boundary: "Read Refarm usage records; do not add a Pi extension dependency.",
	},
	{
		id: "colony-pilot",
		sourceKind: "agents-lab-concept",
		action: "cultivate-refarm-primitive",
		refarmTarget: "bounded worker profiles and multi-task effort orchestration",
		boundary: "Runtime fanout stays plan-only until policy, cancellation, observability, and cost proofs pass.",
	},
];

const HOLDS = [
	{
		id: "pi-extension-api",
		sourceKind: "agents-lab-extension-runtime",
		action: "hold",
		refarmTarget: "Barn/plugin-manifest/Scarecrow-native plugin path",
		boundary: "Do not port Pi extension APIs or hooks directly into Refarm.",
	},
	{
		id: "runtime-engine-publication",
		sourceKind: "refarm-runtime",
		action: "hold",
		refarmTarget: "@refarm.dev/pi-agent publication",
		boundary: "Runtime execution remains private until reference-driver promotion proofs pass.",
	},
];

const REQUIRED_SPEC_MARKERS = [
	"Pure Markdown skills",
	"git-skills",
	"cultivate-primitive",
	"evaluate-extension",
	"provider-model-discovery",
	"context-watchdog",
	"guardrails-core",
	"quota-visibility",
	"colony-pilot",
	"Pi-specific dependency",
];

const REQUIRED_SUPPLY_MARKERS = [
	"`agents-lab`",
	"Reference agent driver",
	"runtime execution stays private",
	"capability index is a supply/readiness index",
];

const REQUIRED_REFERENCE_DRIVER_MARKERS = [
	"promotionQueue",
	"budget visibility",
	"policy, cancellation, observability, and cost-control proofs",
	"runtime execution stays private",
];

function readText(root, relativePath) {
	return readFileSync(path.join(root, relativePath), "utf8");
}

function missingMarkers(text, markers) {
	return markers.filter((marker) => !text.includes(marker));
}

function buildIssue({ code, message, evidence = null }) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

export function buildAgentsLabAssimilationAudit({ root = DEFAULT_ROOT } = {}) {
	const specText = readText(root, SPEC_PATH);
	const supplyText = readText(root, SUPPLY_MAP_PATH);
	const referenceDriverText = readText(root, REFERENCE_DRIVER_PATH);
	const issues = [];

	for (const marker of missingMarkers(specText, REQUIRED_SPEC_MARKERS)) {
		issues.push(buildIssue({
			code: "AGENTS_LAB_SPEC_MARKER_MISSING",
			message: `${SPEC_PATH} must keep the agents-lab assimilation marker '${marker}'.`,
			evidence: marker,
		}));
	}

	for (const marker of missingMarkers(supplyText, REQUIRED_SUPPLY_MARKERS)) {
		issues.push(buildIssue({
			code: "SUPPLY_MAP_AGENTS_LAB_MARKER_MISSING",
			message: `${SUPPLY_MAP_PATH} must keep the agents-lab/refarm supply boundary marker '${marker}'.`,
			evidence: marker,
		}));
	}

	for (const marker of missingMarkers(referenceDriverText, REQUIRED_REFERENCE_DRIVER_MARKERS)) {
		issues.push(buildIssue({
			code: "REFERENCE_DRIVER_PROMOTION_MARKER_MISSING",
			message: `${REFERENCE_DRIVER_PATH} must keep the reference-driver promotion marker '${marker}'.`,
			evidence: marker,
		}));
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		command: "agents-lab-assimilation-audit",
		ok: issues.length === 0,
		source: {
			spec: SPEC_PATH,
			supplyMap: SUPPLY_MAP_PATH,
			referenceDriver: REFERENCE_DRIVER_PATH,
		},
		summary: {
			importNow: IMPORT_NOW.length,
			cultivate: CULTIVATE.length,
			hold: HOLDS.length,
		},
		entries: [...IMPORT_NOW, ...CULTIVATE, ...HOLDS],
		boundaries: [
			"Markdown skills may be adopted after convention review.",
			"Pi TypeScript extension APIs and hooks do not become Refarm enforcement.",
			"Reusable concepts graduate into Refarm packages, WIT contracts, policy gates, skills, or codemods.",
			"Runtime fanout and @refarm.dev/pi-agent publication stay blocked until reference-driver proofs pass.",
			"Agents-lab keeps its product packaging and Pi compatibility; Refarm supplies neutral primitives.",
		],
		nextSlices: [
			"Create a skills import manifest for git-skills and lab-skills essentials.",
			"Turn guardrails-core pressure into the next Scarecrow denial-path proof.",
			"Expose budget visibility through reference-driver handoffs before worker dispatch.",
			"Keep colony-style fanout behind worker-profile cancellation and observability proofs.",
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

	const audit = buildAgentsLabAssimilationAudit({ root: process.cwd() });
	if (json) {
		console.log(JSON.stringify(audit, null, 2));
	} else if (audit.ok) {
		console.log(
			`agents-lab-assimilation-audit: ok (${audit.summary.importNow} import-now, ${audit.summary.cultivate} cultivate, ${audit.summary.hold} hold)`,
		);
	} else {
		console.log(`agents-lab-assimilation-audit: blocked (${audit.issueCount} issue(s))`);
		for (const issue of audit.issues) {
			console.log(`- ${issue.code}: ${issue.message}`);
		}
	}
	if (!audit.ok) process.exit(1);
}
