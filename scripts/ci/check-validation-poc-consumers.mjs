#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	findTaskArtifactById,
	isTaskArtifactManifest,
	selectTaskArtifacts,
} from "../../packages/artifact-contract-v1/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MANIFESTS = {
	wallet:
		"validations/citizen-data-wallet-poc/fixtures/expected/task-artifacts.json",
	extension:
		"validations/extension-sandbox-poc/fixtures/expected/task-artifacts.json",
	notes:
		"validations/governed-note-box-poc/fixtures/expected/task-artifacts.json",
};

function readManifest(relativePath) {
	const manifest = JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
	assert.equal(
		isTaskArtifactManifest(manifest),
		true,
		`${relativePath} must be a task artifact manifest`,
	);
	return manifest;
}

function ids(artifacts) {
	return artifacts.map((artifact) => artifact.id);
}

function assertProducerProcess(manifest, expected) {
	for (const artifact of manifest.artifacts) {
		assert.deepEqual(
			artifact.provenance.process,
			expected,
			`${artifact.id} must preserve tokenized producer process`,
		);
		assert.equal(
			artifact.provenance.command,
			expected.display,
			`${artifact.id} command display must match process display`,
		);
		assert.equal(
			artifact.provenance.command.startsWith("pnpm run "),
			false,
			`${artifact.id} must not use package-manager scripts as provenance`,
		);
	}
}

const wallet = readManifest(MANIFESTS.wallet);
assertProducerProcess(wallet, {
	command: "node",
	args: ["validations/citizen-data-wallet-poc/wallet-poc.mjs"],
	display: "node validations/citizen-data-wallet-poc/wallet-poc.mjs",
});
assert.deepEqual(
	ids(selectTaskArtifacts(wallet, {
		mediaTypes: ["application/json"],
		producer: "wallet:poc",
		reviewStates: ["accepted"],
		roles: ["receipt"],
		source: "validations/citizen-data-wallet-poc",
	})),
	[
		"identity",
		"service-request",
		"authorization-receipt",
		"selective-presentation",
		"revocation-event",
		"consent-decision",
	],
);
assert.equal(
	findTaskArtifactById(wallet, "audit-trail")?.mediaType,
	"text/markdown",
);
assert.deepEqual(
	ids(selectTaskArtifacts(wallet, {
		labels: ["scorecard"],
		roles: ["report"],
	})),
	["scorecard"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(wallet, {
		labels: ["scenario"],
		roles: ["report"],
	})),
	["scenario"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(wallet, {
		labels: ["annex"],
		roles: ["report"],
	})),
	["annex"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(wallet, {
		labels: ["risk", "standards"],
		roles: ["report"],
	})),
	["risk-and-standards-matrix"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(wallet, {
		labels: ["limits", "adoption"],
		roles: ["report"],
	})),
	["limits"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(wallet, {
		labels: ["results-table"],
		roles: ["report"],
	})),
	["results-table"],
);

const extension = readManifest(MANIFESTS.extension);
assertProducerProcess(extension, {
	command: "node",
	args: ["validations/extension-sandbox-poc/extension-sandbox-poc.mjs"],
	display: "node validations/extension-sandbox-poc/extension-sandbox-poc.mjs",
});
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		mediaTypes: ["text/markdown"],
		producer: "extension-sandbox:poc",
		roles: ["report"],
	})),
	["scenario-md", "annex-md", "limits-md", "results-table-md", "sandbox-report-md"],
);
assert.equal(
	findTaskArtifactById(extension, "policy-decision-json")?.mediaType,
	"application/json",
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["scorecard"],
		roles: ["report"],
	})),
	["scorecard-json"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["scenario"],
		roles: ["report"],
	})),
	["scenario-md"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["annex"],
		roles: ["report"],
	})),
	["annex-md"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["risk", "standards"],
		roles: ["report"],
	})),
	["risk-and-standards-matrix-json"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["runtime", "wasm"],
		roles: ["report"],
	})),
	["runtime-evidence-json"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["coding-agent", "agent-governance"],
		roles: ["report"],
	})),
	["coding-agent-evidence-json"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["coding-agent", "smoke", "review-packet"],
		roles: ["receipt"],
	})),
	["coding-agent-smoke-json"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["coding-agent", "denied-capability"],
		mediaTypes: ["application/json"],
		reviewStates: ["accepted"],
		roles: ["receipt"],
		source: "validations/extension-sandbox-poc",
	})),
	["coding-agent-smoke-json"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["limits", "adoption"],
		roles: ["report"],
	})),
	["limits-md"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(extension, {
		labels: ["results-table"],
		roles: ["report"],
	})),
	["results-table-md"],
);

const notes = readManifest(MANIFESTS.notes);
assertProducerProcess(notes, {
	command: "node",
	args: ["validations/governed-note-box-poc/governed-note-box-poc.mjs"],
	display: "node validations/governed-note-box-poc/governed-note-box-poc.mjs",
});
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["lab"],
		mediaTypes: ["application/json"],
		reviewStates: ["accepted"],
		roles: ["dataset"],
		source: "validations/governed-note-box-poc",
	})),
	["metadata-index", "lab-snapshot"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["publication"],
		reviewStates: ["unreviewed"],
		roles: ["dataset"],
	})),
	["publication-snapshot"],
);
assert.equal(
	selectTaskArtifacts(notes, {
		labels: ["publication", "preflight"],
		roles: ["audit-trail"],
	})[0]?.id,
	"publication-preflight",
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["scorecard"],
		roles: ["report"],
	})),
	["scorecard"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["scenario"],
		roles: ["report"],
	})),
	["scenario"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["annex"],
		roles: ["report"],
	})),
	["annex"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["risk", "standards"],
		roles: ["report"],
	})),
	["risk-and-standards-matrix"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["consumer", "vault"],
		roles: ["report"],
	})),
	["consumer-evidence"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["limits", "adoption"],
		roles: ["report"],
	})),
	["limits"],
);
assert.deepEqual(
	ids(selectTaskArtifacts(notes, {
		labels: ["results-table"],
		roles: ["report"],
	})),
	["results-table"],
);
assert.equal(findTaskArtifactById(notes, "human-review")?.mediaType, "text/markdown");

console.log("Validated validation POC consumer selections across 3 manifest(s).");
