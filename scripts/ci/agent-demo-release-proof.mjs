#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseCheckPlan } from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SELECTION = "vault-seed-ready";
const EXTENSION_SANDBOX_MANIFEST =
	"validations/extension-sandbox-poc/fixtures/expected/task-artifacts.json";

export const REQUIRED_PUBLIC_PACKAGES = [
	"@refarm.dev/artifact-contract-v1",
	"@refarm.dev/channel-policy-v1",
	"@refarm.dev/effort-contract-v1",
	"@refarm.dev/process-handoff",
	"@refarm.dev/ds",
	"@refarm.dev/dispatch-surface",
];

export const REQUIRED_EVIDENCE_ARTIFACTS = [
	"policy-decision-json",
	"runtime-evidence-json",
	"coding-agent-evidence-json",
	"coding-agent-smoke-json",
	"coding-agent-temp-workspace-json",
	"extension-install-review-packet-json",
];

export const HELD_AGENT_PLUGIN_SURFACES = [
	{
		id: "@refarm.dev/plugin-manifest",
		reason: "multi-layer Pi/WASM/UI plugin proof still gates public plugin manifest promotion",
	},
	{
		id: "@refarm.dev/terminal-plugin",
		reason: "depends on plugin-manifest and is a renderer for a plugin boundary that remains held",
	},
	{
		id: "@refarm.dev/toolbox",
		reason: "operator tooling is not the white-label runtime surface for downstream agent demos",
	},
	{
		id: "refarm:host-effects@0.1.0",
		reason: "WIT component boundary is internal; package/Cargo publication stays blocked by component packaging proof",
	},
];

export function parseAgentDemoReleaseProofArgs(argv = []) {
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
		throw new Error(`Unknown agent-demo release proof argument: ${arg}`);
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

function findArtifact(manifest, id) {
	return (manifest.artifacts || []).find((artifact) => artifact.id === id) || null;
}

export function buildAgentDemoReleaseProof({
	cwd = ROOT,
	env = process.env,
	selectionId = DEFAULT_SELECTION,
} = {}) {
	const releaseCheck = buildReleaseCheckPlan({ cwd, env, selectionId });
	assert.equal(releaseCheck.ok, true, `${selectionId} release plan must be accepted`);

	const selected = new Set(releaseCheck.plan.orderedNames || []);
	const missingPublicPackages = REQUIRED_PUBLIC_PACKAGES.filter((name) => !selected.has(name));
	const selectedHeldSurfaces = HELD_AGENT_PLUGIN_SURFACES
		.map((surface) => surface.id)
		.filter((name) => selected.has(name));

	const manifest = readJson(cwd, EXTENSION_SANDBOX_MANIFEST);
	const missingEvidenceArtifacts = REQUIRED_EVIDENCE_ARTIFACTS.filter((id) => !findArtifact(manifest, id));

	const ok =
		missingPublicPackages.length === 0 &&
		selectedHeldSurfaces.length === 0 &&
		missingEvidenceArtifacts.length === 0;

	return {
		ok,
		selectionId,
		claim:
			"An agent-demo can consume public dispatch/control/evidence blocks without publishing the held plugin runtime stack.",
		engineProof:
			"@refarm.dev/agent is proven separately by pnpm run agent:release-proof; this proof only gates the reusable agent-demo dispatch surface.",
		publicSurface: REQUIRED_PUBLIC_PACKAGES.map((name) => ({
			package: name,
			selected: selected.has(name),
		})),
		heldSurfaces: HELD_AGENT_PLUGIN_SURFACES.map((surface) => ({
			...surface,
			selected: selected.has(surface.id),
		})),
		evidence: REQUIRED_EVIDENCE_ARTIFACTS.map((id) => {
			const artifact = findArtifact(manifest, id);
			return {
				id,
				present: Boolean(artifact),
				mediaType: artifact?.mediaType || null,
				role: artifact?.role || null,
				reviewState: artifact?.reviewState || artifact?.review?.state || null,
			};
		}),
		failures: {
			missingPublicPackages,
			selectedHeldSurfaces,
			missingEvidenceArtifacts,
		},
	};
}

function printHuman(proof) {
	console.log(`[agent-demo:release-proof] ${proof.claim}`);
	console.log(`[agent-demo:release-proof] selection=${proof.selectionId} ok=${proof.ok}`);
	for (const entry of proof.publicSurface) {
		console.log(`[agent-demo:release-proof] public ${entry.package}: ${entry.selected ? "selected" : "missing"}`);
	}
	for (const entry of proof.heldSurfaces) {
		console.log(`[agent-demo:release-proof] held ${entry.id}: ${entry.selected ? "unexpectedly selected" : "held"}`);
	}
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseAgentDemoReleaseProofArgs(process.argv.slice(2));
		const proof = buildAgentDemoReleaseProof(options);
		if (options.json) {
			console.log(JSON.stringify(proof, null, 2));
		} else {
			printHuman(proof);
		}
		if (!proof.ok) {
			process.exit(1);
		}
	} catch (error) {
		console.error(`[agent-demo:release-proof] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
