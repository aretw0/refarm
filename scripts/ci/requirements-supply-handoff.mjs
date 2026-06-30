#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA = "refarm.requirements-supply-handoff.v1";
const SOURCE = "requirements-supply-handoff";
const REQUIREMENTS_SUPPLY_TAG = "requirements-supply";
const HOLD_TAGS = [REQUIREMENTS_SUPPLY_TAG, "boundary-review", "candidate-hold"];
const VAULT_SEED_READY = "vault-seed-ready";

const CONSUMER_PULLS = {
	"@refarm.dev/source-web": {
		proofId: "requirements-source-web.authenticated-capture",
		downstreamUse: "Authenticated source capture fixture for requirement-like records",
		proofTarget:
			"downstream checkout wraps source-web with real login/selectors while Refarm receives only redacted source:v1 snapshots",
		fallback:
			"consumer keeps private login/selectors and materializes a local opaque snapshot until the Refarm adapter is available",
		ownershipBoundary: "Real credentials, discovery, selectors, and pacing values remain downstream",
	},
	"@refarm.dev/enrichment-contract-v1": {
		proofId: "requirements-enrichment.private-provider-wrapper",
		downstreamUse: "Deterministic enrichment report contract for records or note files",
		proofTarget:
			"downstream checkout emits enrichment:v1 dry-run/apply reports from a private provider without importing provider logic into Refarm",
		fallback:
			"consumer degrades to no-op enrichment or a private local report shape until the contract package is consumed",
		ownershipBoundary: "Private registries, lookup adapters, and vocabulary remain downstream",
	},
	"@refarm.dev/records-contract-v1": {
		proofId: "requirements-records.knowledge-manifest",
		downstreamUse: "Neutral records:v1 manifest for source-linked knowledge/content evidence",
		proofTarget:
			"downstream checkout validates requirement-like records through records:v1 while keeping note placement and vocabulary downstream",
		fallback:
			"consumer treats records as opaque notes or a private manifest until records:v1 consumption is wired",
		ownershipBoundary: "PARA placement, editorial model, note rendering, and domain labels remain downstream",
	},
};

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function packageDir(packageName) {
	if (!packageName.startsWith("@refarm.dev/")) {
		throw new Error(`Unsupported package name: ${packageName}`);
	}
	return path.join("packages", packageName.slice("@refarm.dev/".length));
}

function packageTarballName(packageName, version) {
	const unscoped = packageName.startsWith("@") ? packageName.slice(1) : packageName;
	return `${unscoped.replace("/", "-")}-${version}.tgz`;
}

function refarmDependencyNames(packageJson) {
	const names = new Set();
	for (const sectionName of [
		"dependencies",
		"optionalDependencies",
		"peerDependencies",
	]) {
		const section = packageJson[sectionName];
		if (!section || typeof section !== "object" || Array.isArray(section)) {
			continue;
		}
		for (const name of Object.keys(section)) {
			if (name.startsWith("@refarm.dev/")) {
				names.add(name);
			}
		}
	}
	return [...names].sort();
}

function readPackage(cwd, packageName) {
	const dir = packageDir(packageName);
	const packageJsonPath = path.join(cwd, dir, "package.json");
	if (!existsSync(packageJsonPath)) {
		return {
			packageName,
			packageDir: dir,
			packageJson: null,
			issue: `package.json not found for ${packageName}`,
		};
	}
	return {
		packageName,
		packageDir: dir,
		packageJson: readJson(packageJsonPath),
		issue: null,
	};
}

function profilePackages(policy, tag) {
	return (policy.packageProfiles ?? []).filter((profile) => profile.tags?.includes(tag));
}

function packageEntry({ cwd, profile, selected }) {
	const packageInfo = readPackage(cwd, profile.id);
	const packageJson = packageInfo.packageJson;
	const version = packageJson?.version ?? null;
	const issues = [];
	if (packageInfo.issue) {
		issues.push(packageInfo.issue);
	}
	for (const tag of HOLD_TAGS) {
		if (!profile.tags?.includes(tag)) {
			issues.push(`${profile.id} missing ${tag} tag`);
		}
	}
	if (selected.has(profile.id)) {
		issues.push(`${profile.id} is prematurely selected for ${VAULT_SEED_READY}`);
	}
	if (!Array.isArray(profile.mustPassChecks) || profile.mustPassChecks.length === 0) {
		issues.push(`${profile.id} does not declare release-policy checks`);
	}
	if (!CONSUMER_PULLS[profile.id]) {
		issues.push(`${profile.id} does not declare requirements-supply consumer proof metadata`);
	}

	const refarmDependencies = packageJson
		? refarmDependencyNames(packageJson).map((name) => {
			const dependency = readPackage(cwd, name);
			const dependencyVersion = dependency.packageJson?.version ?? null;
			return {
				packageName: name,
				version: dependencyVersion,
				packageDir: dependency.packageDir,
				tarball: dependencyVersion ? packageTarballName(name, dependencyVersion) : null,
				publishable: dependency.packageJson?.private !== true,
			};
		})
		: [];

	return {
		packageName: profile.id,
		version,
		packageDir: packageInfo.packageDir,
		tarball: version ? packageTarballName(profile.id, version) : null,
		state: issues.length === 0 ? "candidate-hold" : "blocked",
		selectedForVaultSeedReady: selected.has(profile.id),
		tags: profile.tags ?? [],
		mustPassChecks: profile.mustPassChecks ?? [],
		consumerPull: CONSUMER_PULLS[profile.id] ?? null,
		refarmDependencies,
		issues,
	};
}

function buildConsumerInstall({ packages, supportingPackages }) {
	const candidateFileSpecs = Object.fromEntries(
		packages
			.filter((entry) => entry.tarball)
			.map((entry) => [entry.packageName, `file:./vendor/${entry.tarball}`]),
	);
	const pnpmOverrides = Object.fromEntries(
		[...packages, ...supportingPackages]
			.filter((entry) => entry.tarball)
			.map((entry) => [entry.packageName, `file:./vendor/${entry.tarball}`]),
	);
	return {
		mode: "planned-local-handoff",
		vendorDir: "vendor",
		copyFrom: null,
		copyFiles: ["manifest.json", ...Object.keys(pnpmOverrides).map((name) => {
			const entry = [...packages, ...supportingPackages].find((item) => item.packageName === name);
			return entry.tarball;
		})],
		fileSpecs: candidateFileSpecs,
		pnpmOverrides,
		proofChecklist: "consumerProofs",
	};
}

export function buildRequirementsSupplyHandoff({
	cwd = ROOT,
	generatedAt = "2026-06-30T00:00:00.000Z",
} = {}) {
	const config = readJson(path.join(cwd, "refarm.config.json"));
	const policy = config.releasePolicy;
	const selected = new Set(
		profilePackages(policy, VAULT_SEED_READY).map((profile) => profile.id),
	);
	const packages = profilePackages(policy, REQUIREMENTS_SUPPLY_TAG)
		.map((profile) => packageEntry({ cwd, profile, selected }));
	const supportingByName = new Map();
	for (const entry of packages) {
		for (const dependency of entry.refarmDependencies) {
			if (!packages.some((candidate) => candidate.packageName === dependency.packageName)) {
				supportingByName.set(dependency.packageName, dependency);
			}
		}
	}
	const supportingPackages = [...supportingByName.values()].sort((left, right) =>
		left.packageName.localeCompare(right.packageName),
	);
	const issues = packages.flatMap((entry) =>
		entry.issues.map((message) => ({ packageName: entry.packageName, message })),
	);
	const ok = issues.length === 0;

	return {
		schema: SCHEMA,
		schemaVersion: 1,
		source: SOURCE,
		generatedAt,
		ok,
		state: ok ? "candidate-hold" : "blocked",
		selection: {
			id: "requirements-supply-candidates",
			source: "releasePolicy.packageProfiles",
			profileTag: REQUIREMENTS_SUPPLY_TAG,
			selectedForVaultSeedReady: false,
		},
		packages,
		supportingPackages,
		consumerInstall: buildConsumerInstall({ packages, supportingPackages }),
		consumerProofs: packages.map((entry) => entry.consumerPull).filter(Boolean),
		distributionEvidence: {
			state: ok ? "candidate-hold" : "blocked",
			verifiedLocalCopies: 0,
			tarballFreshness: "not-checked-until-pack",
			promotionBoundary:
				"requires named downstream proof before vault-seed-ready selection or tarball handoff publication",
		},
		boundaries: [
			"does not pack tarballs",
			"does not write .refarm/handoff artifacts",
			"does not select requirements-supply packages for vault-seed-ready",
			"does not move private login, selectors, enrichment providers, or vocabulary into Refarm",
		],
		nextActions: [
			"consumer checkout records a named proof using consumerInstall.fileSpecs and pnpmOverrides",
			"promote only the consumed leaves after downstream proof and release boundary audit pass",
			"keep supporting Refarm dependencies visible as local overrides while unpublished",
		],
		issueCount: issues.length,
		issues,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const json = process.argv.includes("--json");
	const result = buildRequirementsSupplyHandoff();
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`requirements-supply-handoff: ${result.ok ? "ok" : "blocked"} (${result.state})`);
	}
	process.exit(result.ok ? 0 : 1);
}
