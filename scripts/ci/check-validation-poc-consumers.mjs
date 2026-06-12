#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	findTaskArtefactById,
	isTaskArtefactManifest,
	selectTaskArtefacts,
} from "../../packages/artefact-contract-v1/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MANIFESTS = {
	wallet:
		"validations/citizen-data-wallet-poc/fixtures/expected/task-artefacts.json",
	extension:
		"validations/extension-sandbox-poc/fixtures/expected/task-artefacts.json",
	notes:
		"validations/governed-note-box-poc/fixtures/expected/task-artefacts.json",
};

function readManifest(relativePath) {
	const manifest = JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
	assert.equal(
		isTaskArtefactManifest(manifest),
		true,
		`${relativePath} must be a task artefact manifest`,
	);
	return manifest;
}

function ids(artefacts) {
	return artefacts.map((artefact) => artefact.id);
}

const wallet = readManifest(MANIFESTS.wallet);
assert.deepEqual(
	ids(selectTaskArtefacts(wallet, {
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
	findTaskArtefactById(wallet, "audit-trail")?.mediaType,
	"text/markdown",
);
assert.deepEqual(
	ids(selectTaskArtefacts(wallet, {
		labels: ["scorecard"],
		roles: ["report"],
	})),
	["scorecard"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(wallet, {
		labels: ["scenario"],
		roles: ["report"],
	})),
	["scenario"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(wallet, {
		labels: ["annex"],
		roles: ["report"],
	})),
	["annex"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(wallet, {
		labels: ["risk", "standards"],
		roles: ["report"],
	})),
	["risk-and-standards-matrix"],
);

const extension = readManifest(MANIFESTS.extension);
assert.deepEqual(
	ids(selectTaskArtefacts(extension, {
		mediaTypes: ["text/markdown"],
		producer: "extension-sandbox:poc",
		roles: ["report"],
	})),
	["scenario-md", "annex-md", "sandbox-report-md"],
);
assert.equal(
	findTaskArtefactById(extension, "policy-decision-json")?.mediaType,
	"application/json",
);
assert.deepEqual(
	ids(selectTaskArtefacts(extension, {
		labels: ["scorecard"],
		roles: ["report"],
	})),
	["scorecard-json"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(extension, {
		labels: ["scenario"],
		roles: ["report"],
	})),
	["scenario-md"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(extension, {
		labels: ["annex"],
		roles: ["report"],
	})),
	["annex-md"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(extension, {
		labels: ["risk", "standards"],
		roles: ["report"],
	})),
	["risk-and-standards-matrix-json"],
);

const notes = readManifest(MANIFESTS.notes);
assert.deepEqual(
	ids(selectTaskArtefacts(notes, {
		labels: ["lab"],
		mediaTypes: ["application/json"],
		reviewStates: ["accepted"],
		roles: ["dataset"],
		source: "validations/governed-note-box-poc",
	})),
	["metadata-index", "lab-snapshot"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(notes, {
		labels: ["publication"],
		reviewStates: ["unreviewed"],
		roles: ["dataset"],
	})),
	["publication-snapshot"],
);
assert.equal(
	selectTaskArtefacts(notes, {
		labels: ["publication", "preflight"],
		roles: ["audit-trail"],
	})[0]?.id,
	"publication-preflight",
);
assert.deepEqual(
	ids(selectTaskArtefacts(notes, {
		labels: ["scorecard"],
		roles: ["report"],
	})),
	["scorecard"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(notes, {
		labels: ["scenario"],
		roles: ["report"],
	})),
	["scenario"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(notes, {
		labels: ["annex"],
		roles: ["report"],
	})),
	["annex"],
);
assert.deepEqual(
	ids(selectTaskArtefacts(notes, {
		labels: ["risk", "standards"],
		roles: ["report"],
	})),
	["risk-and-standards-matrix"],
);
assert.equal(findTaskArtefactById(notes, "human-review")?.mediaType, "text/markdown");

console.log("Validated validation POC consumer selections across 3 manifest(s).");
