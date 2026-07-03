#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentDemoReleaseProof } from "./agent-demo-release-proof.mjs";
import { buildAgentReleaseProof } from "./agent-release-proof.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_ROOT = "validations/extension-sandbox-poc/fixtures/expected";
const DEFAULT_SELECTION = "vault-seed-ready";

export const REQUIRED_WHITE_LABEL_STEPS = [
	"install",
	"doctor",
	"check",
	"review",
	"rehearse",
	"run",
	"handoff",
];

export const REQUIRED_T1_ARTIFACTS = [
	"policy-decision-json",
	"scorecard-json",
	"runtime-evidence-json",
	"coding-agent-smoke-json",
	"coding-agent-temp-workspace-json",
	"extension-install-review-packet-json",
];

export function parseSecureExtensibilityDemoProofArgs(argv = []) {
	const options = {
		selectionId: DEFAULT_SELECTION,
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--selection") {
			options.selectionId = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		throw new Error(`Unknown secure-extensibility proof argument: ${arg}`);
	}

	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function readJson(cwd, relativePath) {
	return JSON.parse(readFileSync(path.join(cwd, relativePath), "utf8"));
}

function artifactById(manifest, id) {
	return (manifest.artifacts || []).find((artifact) => artifact.id === id) || null;
}

function coverage(status, id, evidence, claim) {
	return {
		id,
		status,
		evidence,
		claim,
	};
}

export function buildSecureExtensibilityDemoProof({
	cwd = ROOT,
	env = process.env,
	selectionId = DEFAULT_SELECTION,
} = {}) {
	const agentProof = buildAgentReleaseProof({ cwd });
	const demoProof = buildAgentDemoReleaseProof({ cwd, env, selectionId });
	const manifest = readJson(cwd, `${FIXTURE_ROOT}/task-artifacts.json`);
	const reviewPacket = readJson(cwd, `${FIXTURE_ROOT}/extension-install-review-packet.json`);
	const scorecard = readJson(cwd, `${FIXTURE_ROOT}/scorecard.json`);
	const runtimeEvidence = readJson(cwd, `${FIXTURE_ROOT}/runtime-evidence.json`);

	const envelopeSteps = reviewPacket.whiteLabelCommandEnvelope.map((entry) => entry.step);
	const missingWhiteLabelSteps = REQUIRED_WHITE_LABEL_STEPS.filter(
		(step) => !envelopeSteps.includes(step),
	);
	const missingArtifacts = REQUIRED_T1_ARTIFACTS.filter((id) => !artifactById(manifest, id));
	const deniedCapabilityReceipts = reviewPacket.receipts.filter(
		(receipt) => receipt.status === "denied",
	);
	const qualityGateReady =
		envelopeSteps.includes("check") &&
		scorecard.gate === "continue" &&
		scorecard.finalScore >= scorecard.thresholds.continue;

	const failures = [
		...(agentProof.ok ? [] : ["agent-release-proof failed"]),
		...(demoProof.ok ? [] : ["agent-demo-release-proof failed"]),
		...missingWhiteLabelSteps.map((step) => `white-label CLI step missing: ${step}`),
		...missingArtifacts.map((id) => `T1 evidence artifact missing: ${id}`),
		...(reviewPacket.installPlan.mode === "review-first"
			? []
			: ["install plan must remain review-first"]),
		...(reviewPacket.installPlan.readyToInstall === false
			? []
			: ["install plan must not auto-install unreviewed capabilities"]),
		...(deniedCapabilityReceipts.length > 0
			? []
			: ["denied capability receipts must be present"]),
		...(qualityGateReady ? [] : ["quality gate evidence is not ready"]),
	];

	return {
		schemaVersion: 1,
		command: "secure-extensibility-demo-proof",
		ok: failures.length === 0,
		selectionId,
		track: "T1",
		claim:
			"A white-label secure-extensibility demo can use release-selected dispatch/evidence blocks, a public agent engine, and a review-first extension packet without publishing held plugin runtime surfaces.",
		claimStatus: "deterministic-composition-proof",
		whiteLabelCommandEnvelope: reviewPacket.whiteLabelCommandEnvelope,
		reviewPacket: {
			schema: reviewPacket.schema,
			claimStatus: reviewPacket.claimStatus,
			installMode: reviewPacket.installPlan.mode,
			readyToInstall: reviewPacket.installPlan.readyToInstall,
			deniedCapabilityReceiptCount: deniedCapabilityReceipts.length,
			evidence: reviewPacket.evidence,
		},
		qualityGate: {
			id: scorecard.id,
			gate: scorecard.gate,
			finalScore: scorecard.finalScore,
			threshold: scorecard.thresholds.continue,
			commandStepPresent: envelopeSteps.includes("check"),
			ready: qualityGateReady,
		},
		acceptanceCoverage: [
			coverage("proven", "public-agent-engine", ["agent:release-proof"], agentProof.claim),
			coverage(
				"proven",
				"release-selected-dispatch-surface",
				["agent-demo:release-proof"],
				demoProof.claim,
			),
			coverage(
				"proven",
				"review-first-extension-install",
				["extension-install-review-packet.json", "policy-decision.json"],
				reviewPacket.claim,
			),
			coverage(
				"proven",
				"denied-capability-receipts",
				["extension-install-review-packet.json", "sandbox-report.json"],
				"Unreviewed network and repository writes remain denied before promotion.",
			),
			coverage(
				"proven",
				"quality-gate-command-shape",
				["scorecard.json", "extension-install-review-packet.json"],
				"The white-label envelope includes a quality:v1 check step and the synthetic scorecard clears its continue threshold.",
			),
			coverage(
				"bounded",
				"real-wasm-runtime",
				runtimeEvidence.linkedEvidence,
				"The synthetic packet links to adjacent WASM validation evidence; it does not claim production plugin execution.",
			),
			coverage(
				"bounded",
				"model-authored-plugin",
				["coding-agent-smoke.json", "coding-agent-temp-workspace.json"],
				"The packet rehearses proposal and temporary workspace behavior; it does not execute a real model-driven authoring run.",
			),
		],
		publicSurface: demoProof.publicSurface,
		heldSurfaces: demoProof.heldSurfaces,
		requiredArtifacts: REQUIRED_T1_ARTIFACTS.map((id) => ({
			id,
			present: Boolean(artifactById(manifest, id)),
		})),
		failures,
	};
}

function printHuman(proof) {
	console.log(`[secure-extensibility:proof] ${proof.claim}`);
	console.log(`[secure-extensibility:proof] selection=${proof.selectionId} ok=${proof.ok}`);
	console.log(
		`[secure-extensibility:proof] envelope=${proof.whiteLabelCommandEnvelope.map((entry) => entry.step).join(",")}`,
	);
	for (const entry of proof.acceptanceCoverage) {
		console.log(`[secure-extensibility:proof] ${entry.id}: ${entry.status}`);
	}
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseSecureExtensibilityDemoProofArgs(process.argv.slice(2));
		const proof = buildSecureExtensibilityDemoProof(options);
		if (options.json) {
			console.log(JSON.stringify(proof, null, 2));
		} else {
			printHuman(proof);
		}
		if (!proof.ok) {
			process.exit(1);
		}
	} catch (error) {
		console.error(`[secure-extensibility:proof] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
