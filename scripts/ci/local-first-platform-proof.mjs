#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { TASK_ARTIFACT_MANIFEST_SCHEMA } from "./check-task-artifact-manifests.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildLocalSurfaceLaunchPlan,
	checkLocalSurfaceQuality,
	createLocalSurfaceManifest,
	renderLocalSurfaceDocument,
} from "../../packages/local-surface/dist/index.js";
import { buildReleaseCheckPlan } from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SELECTION = "vault-seed-ready";
const WALLET_FIXTURE_ROOT = "validations/citizen-data-wallet-poc/fixtures/expected";

export const REQUIRED_T2_PACKAGES = [
	"@refarm.dev/local-surface",
	"@refarm.dev/credentials-contract-v1",
	"@refarm.dev/identity-contract-v1",
	"@refarm.dev/storage-contract-v1",
];

export const REQUIRED_WALLET_ARTIFACTS = [
	"authorization-receipt",
	"selective-presentation",
	"revocation-event",
	"consent-decision",
	"scorecard",
	"task-artifacts",
];

export function parseLocalFirstPlatformProofArgs(argv = []) {
	const options = {
		selectionId: DEFAULT_SELECTION,
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") continue;
		if (arg === "--selection") {
			options.selectionId = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		throw new Error(`Unknown local-first platform proof argument: ${arg}`);
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
	// THE IMPORTED CONSTANT, never a copy of its value (ISS-112). This held the literal
	// `"refarm.task-artifacts.v1"`, so a producer changing the wire name would have left this
	// check silently matching nothing — reporting an ABSENCE rather than the mismatch it could not
	// see. Which VALUE is canonical is a separate, open question; see the constant's own doc.
	if (id === "task-artifacts") {
		return manifest?.schema === TASK_ARTIFACT_MANIFEST_SCHEMA ? manifest : null;
	}
	return (manifest.artifacts || []).find((artifact) => artifact.id === id) || null;
}

function coverage(status, id, evidence, claim) {
	return { id, status, evidence, claim };
}

function buildWalletSurface({ receipt, presentation, revocation, consentDecision }) {
	return createLocalSurfaceManifest({
		id: "local-first-wallet-poc",
		title: "Local Wallet Review",
		description:
			"Review purpose, authorization, selective disclosure, and revocation evidence in a local-first surface.",
		routeBase: "wallet",
		theme: "local-neutral",
		storageNamespaces: ["credentials", "receipts", "audit"],
		panels: [
			{
				id: "authorization",
				title: "Authorization",
				summary: "Signed receipt, scope, status, and expiration stay reviewable.",
				kind: "receipt",
				rows: [
					{
						id: receipt.id,
						status: receipt.status,
						scope: receipt.scope.join(", "),
						expiresAt: receipt.expiresAt,
					},
				],
			},
			{
				id: "presentation",
				title: "Selective Disclosure",
				summary: "Only authorized attributes are presented to the requester.",
				kind: "dataset",
				rows: Object.entries(presentation.attributes).map(([attribute, value]) => ({
					attribute,
					value: String(value),
				})),
			},
			{
				id: "revocation",
				title: "Revocation",
				summary: "Revocation changes the authorization from active to unusable.",
				kind: "activity",
				rows: [
					{
						authorizationId: revocation.authorizationId,
						before: revocation.statusBefore,
						after: revocation.statusAfter,
						revokedAt: revocation.revokedAt,
					},
				],
			},
			{
				id: "consent-review",
				title: "Consent Review",
				summary: "Human review remains explicit before adoption or provider integration.",
				kind: "status",
				rows: [
					{
						decisionId: consentDecision.id,
						reviewRequired: consentDecision.operatorReview.required,
					},
				],
			},
		],
		actions: [
			{
				id: "review-request",
				label: "Review Request",
				kind: "review",
				requiresReview: true,
			},
			{
				id: "open-receipts",
				label: "Open Receipts",
				kind: "navigate",
				target: "/wallet/receipts",
			},
			{
				id: "handoff",
				label: "Handoff Evidence",
				kind: "command",
				target: "task-artifacts.json",
				requiresReview: true,
			},
		],
		evidence: REQUIRED_WALLET_ARTIFACTS.map((id) => `${id}.json`),
		boundaries: [
			"The surface uses synthetic wallet evidence only.",
			"Provider setup, real credentials, screenshots, and personal document UX remain consumer-owned.",
		],
	});
}

export async function buildLocalFirstPlatformProof({
	cwd = ROOT,
	env = process.env,
	selectionId = DEFAULT_SELECTION,
} = {}) {
	const releaseCheck = buildReleaseCheckPlan({ cwd, env, selectionId });
	const selected = new Set(releaseCheck.plan?.orderedNames || []);
	const missingPackages = REQUIRED_T2_PACKAGES.filter((name) => !selected.has(name));

	const artifactManifest = readJson(cwd, `${WALLET_FIXTURE_ROOT}/task-artifacts.json`);
	const receipt = readJson(cwd, `${WALLET_FIXTURE_ROOT}/authorization-receipt.json`);
	const presentation = readJson(cwd, `${WALLET_FIXTURE_ROOT}/selective-presentation.json`);
	const revocation = readJson(cwd, `${WALLET_FIXTURE_ROOT}/revocation-event.json`);
	const consentDecision = readJson(cwd, `${WALLET_FIXTURE_ROOT}/consent-decision.json`);
	const scorecard = readJson(cwd, `${WALLET_FIXTURE_ROOT}/scorecard.json`);
	const missingArtifacts = REQUIRED_WALLET_ARTIFACTS.filter((id) => !artifactById(artifactManifest, id));

	const surfaceManifest = buildWalletSurface({ receipt, presentation, revocation, consentDecision });
	const launchPlan = buildLocalSurfaceLaunchPlan(surfaceManifest, {
		commandLabel: "<white-label-cli>",
		port: 4177,
		manifestPath: "wallet-local-surface.json",
	});
	const html = renderLocalSurfaceDocument(surfaceManifest);
	const qualityReport = await checkLocalSurfaceQuality(surfaceManifest);

	const failures = [
		...(releaseCheck.ok ? [] : [`${selectionId} release plan must be accepted`]),
		...missingPackages.map((name) => `T2 package missing from selection: ${name}`),
		...missingArtifacts.map((id) => `wallet evidence artifact missing: ${id}`),
		...(surfaceManifest.localFirst.networkRequired === false
			? []
			: ["local surface must not require network"]),
		...(launchPlan.steps.map((step) => step.id).join(",") === "doctor,render,serve,handoff"
			? []
			: ["launch plan must keep doctor/render/serve/handoff order"]),
		...(qualityReport.findings.length === 0 ? [] : ["local surface quality report must pass"]),
		...(receipt.status === "active" && revocation.statusAfter === "revoked"
			? []
			: ["authorization and revocation states must be explicit"]),
	];

	return {
		schemaVersion: 1,
		command: "local-first-platform-proof",
		ok: failures.length === 0,
		selectionId,
		track: "T2",
		claim:
			"A local-first platform POC can combine selected credentials/storage/identity contracts, synthetic wallet evidence, and a provider-neutral local surface without binding a provider or claiming formal wallet interoperability.",
		claimStatus: "deterministic-composition-proof",
		selectedPackages: REQUIRED_T2_PACKAGES.map((name) => ({
			package: name,
			selected: selected.has(name),
		})),
		walletEvidence: {
			requiredArtifacts: REQUIRED_WALLET_ARTIFACTS.map((id) => ({
				id,
				present: Boolean(artifactById(artifactManifest, id)),
			})),
			authorization: {
				id: receipt.id,
				status: receipt.status,
				scope: receipt.scope,
				expiresAt: receipt.expiresAt,
			},
			presentation: {
				authorizationId: presentation.authorizationId,
				presentedAttributeCount: Object.keys(presentation.attributes).length,
			},
			revocation: {
				authorizationId: revocation.authorizationId,
				statusBefore: revocation.statusBefore,
				statusAfter: revocation.statusAfter,
			},
			scorecard: {
				id: scorecard.id,
				gate: scorecard.gate,
				finalScore: scorecard.finalScore,
			},
		},
		localSurface: {
			manifest: surfaceManifest,
			launchPlan,
			html: {
				rendered: html.startsWith("<!DOCTYPE html>"),
				containsLocalSurfaceMarker: html.includes("data-local-surface-id=\"local-first-wallet-poc\""),
			},
			qualityReport,
		},
		acceptanceCoverage: [
			coverage(
				"proven",
				"local-first-surface",
				["@refarm.dev/local-surface", "wallet-local-surface.json"],
				"Manifest, launch plan, static HTML, and quality report are generated without starting a server.",
			),
			coverage(
				"proven",
				"authorization-receipt",
				["authorization-receipt.json", "service-request.json"],
				"Purpose, scope, status, and expiration remain reviewable.",
			),
			coverage(
				"proven",
				"selective-disclosure",
				["selective-presentation.json"],
				"Only authorized attributes are presented in the local surface.",
			),
			coverage(
				"proven",
				"revocation-and-audit",
				["revocation-event.json", "audit-trail.md", "consent-decision.json"],
				"Revocation changes authorization state and remains human-reviewable.",
			),
			coverage(
				"bounded",
				"provider-integration",
				["limits.md", "risk-and-standards-matrix.json"],
				"Provider setup, real credentials, formal wallet interoperability, and production UX remain downstream-owned.",
			),
		],
		failures,
	};
}

function printHuman(proof) {
	console.log(`[local-first:proof] ${proof.claim}`);
	console.log(`[local-first:proof] selection=${proof.selectionId} ok=${proof.ok}`);
	console.log(`[local-first:proof] surface=${proof.localSurface.manifest.id}`);
	for (const entry of proof.acceptanceCoverage) {
		console.log(`[local-first:proof] ${entry.id}: ${entry.status}`);
	}
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseLocalFirstPlatformProofArgs(process.argv.slice(2));
		const proof = await buildLocalFirstPlatformProof(options);
		if (options.json) {
			console.log(JSON.stringify(proof, null, 2));
		} else {
			printHuman(proof);
		}
		if (!proof.ok) process.exit(1);
	} catch (error) {
		console.error(`[local-first:proof] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
