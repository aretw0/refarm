#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseCheckPlan } from "../release-check.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_VERSION = 1;
const VAULT_SEED_READY = "vault-seed-ready";

const FORBIDDEN_OPENING_PATTERNS = [
	/\bRefarm platform\b/,
	/\bRefarm consumers\b/,
	/\bRefarm and consumer CLIs\b/,
	/\bRefarm's sovereign cryptographic core\b/,
	/\bused by `refarm` and `farmhand`\b/i,
	/@refarm\.dev\/launch-process/,
];

const FORBIDDEN_DESCRIPTION_PATTERNS = [
	/\bRefarm-powered\b/i,
	/\bRefarm platform\b/i,
	/\bRefarm consumers\b/i,
	/\bRefarm and consumer CLIs\b/i,
	/\bRefarm's\b/i,
	/@refarm\.dev\/launch-process/,
];

const FORBIDDEN_BODY_PATTERNS = [
	/\bRefarm owns\b/,
	/\bThis lets Refarm\b/,
	/\bexisting Refarm app surfaces\b/i,
	/\bcurrent Refarm apps\b/i,
	/\bconsumer CLIs to adopt Refarm\b/i,
	/\bRefarm operators can still\b/i,
];

const FORBIDDEN_COMPATIBILITY_SUBPATHS = [
	{
		pattern: /@refarm\.dev\/cli\/process-handoff/,
		requiredPackage: "@refarm.dev/cli",
	},
	{
		pattern: /@refarm\.dev\/homestead\/ssr/,
		requiredPackage: "@refarm.dev/homestead",
	},
];

function readText(root, relativePath) {
	return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
	return JSON.parse(readText(root, relativePath));
}

function issue({ code, packageName = null, message, evidence = null }) {
	return {
		code,
		...(packageName ? { packageName } : {}),
		message,
		...(evidence ? { evidence } : {}),
	};
}

function firstMatch(patterns, value) {
	return patterns.find((pattern) => pattern.test(value)) ?? null;
}

function packageDir(packageName) {
	return packageName.replace("@refarm.dev/", "");
}

function packageFiles(root, packageName) {
	const dir = packageDir(packageName);
	return {
		dir,
		packageJson: readJson(root, `packages/${dir}/package.json`),
		readme: readText(root, `packages/${dir}/README.md`),
	};
}

function auditAudienceBoundary(policy, issues) {
	const selection = policy.selections?.find((item) => item.id === VAULT_SEED_READY);
	const expected = {
		consumer: "vault-seed",
		naming: "product-neutral-sdk",
		productLocal:
			"Vault-specific CLI labels, copy, notebooks, routes, and UX stay downstream-owned.",
	};
	if (JSON.stringify(selection?.audienceBoundary) !== JSON.stringify(expected)) {
		issues.push(issue({
			code: "AUDIENCE_BOUNDARY_MISMATCH",
			message: "`vault-seed-ready` must keep the product-neutral SDK audience boundary.",
			evidence: selection?.audienceBoundary ?? null,
		}));
	}
}

function auditSdkPrimitiveHolds(profiles, issues) {
	for (const profile of profiles.filter((item) => item.tags?.includes("sdk-primitive"))) {
		if (!profile.tags.includes("boundary-review")) {
			issues.push(issue({
				code: "SDK_PRIMITIVE_WITHOUT_BOUNDARY_REVIEW",
				packageName: profile.id,
				message: "SDK primitives must declare boundary-review before publication.",
			}));
		}
		if (
			profile.tags.includes(VAULT_SEED_READY) &&
			!profile.tags.includes("consumer-pulled")
		) {
			issues.push(issue({
				code: "SDK_PRIMITIVE_READY_WITHOUT_CONSUMER_PROOF",
				packageName: profile.id,
				message: "SDK primitives must not enter vault-seed-ready without consumer-pulled proof.",
			}));
		}
	}
}

function auditConsumerPulledProfiles(profiles, issues) {
	for (const profile of profiles.filter((item) => item.tags?.includes(VAULT_SEED_READY))) {
		if (!profile.tags.includes("consumer-pulled")) {
			issues.push(issue({
				code: "VAULT_SEED_READY_WITHOUT_CONSUMER_PULLED",
				packageName: profile.id,
				message: "`vault-seed-ready` packages must declare consumer-pulled intent.",
			}));
		}
	}
}

function auditSelectedPackageNaming(root, profiles, issues) {
	const selected = profiles.filter((item) => item.tags?.includes(VAULT_SEED_READY));
	const selectedNames = new Set(selected.map((item) => item.id));

	for (const profile of selected) {
		const { packageJson, readme } = packageFiles(root, profile.id);
		const opening = readme.split("\n## ")[0];
		const description = packageJson.description || "";

		const openingMatch = firstMatch(FORBIDDEN_OPENING_PATTERNS, opening);
		if (openingMatch) {
			issues.push(issue({
				code: "README_OPENING_PRODUCT_SPECIFIC",
				packageName: profile.id,
				message: "README opening should describe reusable capability, not Refarm-only positioning.",
				evidence: String(openingMatch),
			}));
		}

		const descriptionMatch = firstMatch(FORBIDDEN_DESCRIPTION_PATTERNS, description);
		if (descriptionMatch) {
			issues.push(issue({
				code: "PACKAGE_DESCRIPTION_PRODUCT_SPECIFIC",
				packageName: profile.id,
				message: "Package description should describe reusable capability, not Refarm-only positioning.",
				evidence: String(descriptionMatch),
			}));
		}

		const bodyMatch = firstMatch(FORBIDDEN_BODY_PATTERNS, readme);
		if (bodyMatch) {
			issues.push(issue({
				code: "README_BODY_REFARM_OWNERSHIP_WORDING",
				packageName: profile.id,
				message: "README should describe package/host ownership instead of Refarm-owned capability wording.",
				evidence: String(bodyMatch),
			}));
		}

		for (const { pattern, requiredPackage } of FORBIDDEN_COMPATIBILITY_SUBPATHS) {
			if (!selectedNames.has(requiredPackage) && pattern.test(opening)) {
				issues.push(issue({
					code: "README_PROMOTES_UNSELECTED_COMPATIBILITY_SUBPATH",
					packageName: profile.id,
					message: `README opening should promote its selected leaf package instead of ${requiredPackage} compatibility subpaths.`,
					evidence: String(pattern),
				}));
			}
		}
	}
}

function auditSelectedLeaves(profiles, policyText, issues) {
	const selected = profiles
		.filter((profile) => profile.tags?.includes(VAULT_SEED_READY))
		.map((profile) => profile.id);
	if (!selected.includes("@refarm.dev/process-handoff")) {
		issues.push(issue({
			code: "PROCESS_HANDOFF_LEAF_MISSING",
			packageName: "@refarm.dev/process-handoff",
			message: "`@refarm.dev/process-handoff` must remain the selected process leaf.",
		}));
	}
	for (const packageName of [
		"@refarm.dev/launch-process",
		"@refarm.dev/cli",
		"@refarm.dev/homestead",
		"@refarm.dev/homestead-ssr",
	]) {
		if (selected.includes(packageName)) {
			issues.push(issue({
				code: "HEAVY_OR_SUPERSEDED_LEAF_SELECTED",
				packageName,
				message: `${packageName} must stay out of vault-seed-ready until a selected consumer proof exists.`,
			}));
		}
	}
	if (/@refarm\.dev\/launch-process/.test(policyText)) {
		issues.push(issue({
			code: "LAUNCH_PROCESS_POLICY_REFERENCE",
			packageName: "@refarm.dev/launch-process",
			message: "Release policy must not reintroduce the superseded launch-process package name.",
		}));
	}
}

function auditSourceHolds(profiles, policyText, issues) {
	const byId = new Map(profiles.map((profile) => [profile.id, profile]));
	const selected = new Set(
		profiles
			.filter((profile) => profile.tags?.includes(VAULT_SEED_READY))
			.map((profile) => profile.id),
	);
	for (const packageName of [
		"@refarm.dev/source-contract-v1",
		"@refarm.dev/source-git",
		"@refarm.dev/source-local",
		"@refarm.dev/source-web",
	]) {
		const profile = byId.get(packageName);
		if (!profile) {
			issues.push(issue({
				code: "SOURCE_PACKAGE_NOT_RELEASE_PROFILED",
				packageName,
				message: "Source/librarian packages must remain release-profiled while proof-gated.",
			}));
			continue;
		}
		for (const tag of ["librarian", "boundary-review", "candidate-hold"]) {
			if (!profile.tags.includes(tag)) {
				issues.push(issue({
					code: "SOURCE_PACKAGE_MISSING_HOLD_TAG",
					packageName,
					message: `${packageName} must declare ${tag}.`,
				}));
			}
		}
		if (selected.has(packageName)) {
			issues.push(issue({
				code: "SOURCE_PACKAGE_PREMATURELY_SELECTED",
				packageName,
				message: `${packageName} must not enter vault-seed-ready without selected downstream proof.`,
			}));
		}
	}
	if (/@refarm\.dev\/source-dispatch/.test(policyText)) {
		issues.push(issue({
			code: "SOURCE_DISPATCH_PREMATURELY_PROFILED",
			packageName: "@refarm.dev/source-dispatch",
			message: "source-dispatch should not be profiled before an executable dispatch proof exists.",
		}));
	}
}

function auditRequirementsSupplyHolds(profiles, issues) {
	const byId = new Map(profiles.map((profile) => [profile.id, profile]));
	const selected = new Set(
		profiles
			.filter((profile) => profile.tags?.includes(VAULT_SEED_READY))
			.map((profile) => profile.id),
	);
	for (const packageName of [
		"@refarm.dev/source-web",
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
	]) {
		const profile = byId.get(packageName);
		if (!profile) {
			issues.push(issue({
				code: "REQUIREMENTS_SUPPLY_PACKAGE_NOT_RELEASE_PROFILED",
				packageName,
				message: "Requirements supply packages must be release-profiled while proof-gated.",
			}));
			continue;
		}
		for (const tag of ["requirements-supply", "boundary-review", "candidate-hold"]) {
			if (!profile.tags.includes(tag)) {
				issues.push(issue({
					code: "REQUIREMENTS_SUPPLY_PACKAGE_MISSING_HOLD_TAG",
					packageName,
					message: `${packageName} must declare ${tag}.`,
				}));
			}
		}
		if (selected.has(packageName)) {
			issues.push(issue({
				code: "REQUIREMENTS_SUPPLY_PACKAGE_PREMATURELY_SELECTED",
				packageName,
				message: `${packageName} must not enter vault-seed-ready without selected downstream proof.`,
			}));
		}
	}
}

export function buildReleaseBoundaryAudit({ root = DEFAULT_ROOT } = {}) {
	const configText = readText(root, "refarm.config.json");
	const config = JSON.parse(configText);
	const policy = config.releasePolicy;
	const profiles = policy.packageProfiles ?? [];
	const issues = [];
	const releaseCheck = buildReleaseCheckPlan({
		cwd: root,
		selectionId: VAULT_SEED_READY,
	});

	auditAudienceBoundary(policy, issues);
	auditSdkPrimitiveHolds(profiles, issues);
	auditConsumerPulledProfiles(profiles, issues);
	auditSelectedPackageNaming(root, profiles, issues);
	auditSelectedLeaves(profiles, configText, issues);
	auditSourceHolds(profiles, configText, issues);
	auditRequirementsSupplyHolds(profiles, issues);

	if (!releaseCheck.ok) {
		issues.push(issue({
			code: "RELEASE_SELECTION_NOT_READY",
			message: "`vault-seed-ready` release selection must resolve before boundary audit can pass.",
			evidence: releaseCheck.plan?.status ?? null,
		}));
	}

	const selectedPackages = releaseCheck.ok
		? releaseCheck.plan.orderedNames
		: profiles
			.filter((profile) => profile.tags?.includes(VAULT_SEED_READY))
			.map((profile) => profile.id);
	return {
		schemaVersion: SCHEMA_VERSION,
		command: "release-boundary-audit",
		ok: issues.length === 0,
		selectionId: VAULT_SEED_READY,
		auditedPackageCount: selectedPackages.length,
		auditedPackages: selectedPackages,
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

	const audit = buildReleaseBoundaryAudit({ root: process.cwd() });
	if (json) {
		console.log(JSON.stringify(audit, null, 2));
	} else if (audit.ok) {
		console.log(
			`release-boundary-audit: ok (${audit.auditedPackageCount} ${audit.selectionId} package(s))`,
		);
	} else {
		console.log(`release-boundary-audit: blocked (${audit.issueCount} issue(s))`);
		for (const item of audit.issues) {
			console.log(`- ${item.code}${item.packageName ? ` ${item.packageName}` : ""}: ${item.message}`);
		}
	}
	if (!audit.ok) process.exit(1);
}
