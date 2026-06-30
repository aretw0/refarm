#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectPackageManager,
	packageManagerSpawnCommand,
} from "../../packages/config/src/package-manager.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA = "refarm.requirements-supply-handoff.v1";
const SOURCE = "requirements-supply-handoff";
const REQUIREMENTS_SUPPLY_TAG = "requirements-supply";
const HOLD_TAGS = [REQUIREMENTS_SUPPLY_TAG, "boundary-review", "candidate-hold"];
const VAULT_SEED_READY = "vault-seed-ready";
const DEFAULT_HANDOFF_DIR = `.refarm/handoff/requirements-supply/${new Date().toISOString().slice(0, 10)}`;

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

function sha256File(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function maybeRelative(cwd, targetPath) {
	const relative = path.relative(cwd, targetPath);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		return targetPath;
	}
	return relative.replace(/\\/g, "/");
}

function trimOutput(value) {
	return String(value ?? "").trim().split("\n").slice(-8).join("\n");
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

function annotateTarball(entry, { cwd, handoffDir }) {
	if (!entry.tarball || !handoffDir) {
		return {
			...entry,
			path: null,
			exists: false,
			sha256: null,
			sizeBytes: null,
		};
	}
	const filePath = path.join(path.resolve(cwd, handoffDir), entry.tarball);
	const exists = existsSync(filePath);
	const stats = exists ? statSync(filePath) : null;
	return {
		...entry,
		path: maybeRelative(cwd, filePath),
		exists,
		sha256: exists ? sha256File(filePath) : null,
		sizeBytes: stats?.size ?? null,
	};
}

function packageHasRefarmDependencies(entry) {
	return entry.refarmDependencies.length > 0;
}

function selectScope(packages, scope) {
	if (scope === "clean") {
		return packages.filter((entry) => !packageHasRefarmDependencies(entry));
	}
	if (scope === "source-web") {
		return packages.filter((entry) => entry.packageName === "@refarm.dev/source-web");
	}
	return packages;
}

function sortForCleanFirst(packages) {
	return [...packages].sort((left, right) => {
		const leftCost = packageHasRefarmDependencies(left) ? 1 : 0;
		const rightCost = packageHasRefarmDependencies(right) ? 1 : 0;
		if (leftCost !== rightCost) return leftCost - rightCost;
		return left.packageName.localeCompare(right.packageName);
	});
}

function manifestFileForScope(scope) {
	return scope === "all" ? "manifest.json" : `manifest.${scope}.json`;
}

function buildConsumerInstall({ packages, supportingPackages, cwd, handoffDir, manifestFile }) {
	const allPackages = [...packages, ...supportingPackages];
	const candidateFileSpecs = Object.fromEntries(
		packages
			.filter((entry) => entry.tarball)
			.map((entry) => [entry.packageName, `file:./vendor/${entry.tarball}`]),
	);
	const pnpmOverrides = Object.fromEntries(
		allPackages
			.filter((entry) => entry.tarball)
			.map((entry) => [entry.packageName, `file:./vendor/${entry.tarball}`]),
	);
	return {
		mode: packages.every((entry) => entry.exists) ? "local-handoff-ready" : "planned-local-handoff",
		vendorDir: "vendor",
		copyFrom: handoffDir ? maybeRelative(cwd, path.resolve(cwd, handoffDir)) : null,
		copyFiles: [manifestFile, ...Object.keys(pnpmOverrides).map((name) => {
			const entry = allPackages.find((item) => item.packageName === name);
			return entry.tarball;
		})],
		fileSpecs: candidateFileSpecs,
		pnpmOverrides,
		proofChecklist: "consumerProofs",
	};
}

function parseArgs(argv = []) {
	const options = {
		json: false,
		pack: false,
		scope: "all",
		handoffDir: DEFAULT_HANDOFF_DIR,
		out: null,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--pack") {
			options.pack = true;
			continue;
		}
		if (arg === "--clean-only") {
			options.scope = "clean";
			continue;
		}
		if (arg === "--source-web-only") {
			options.scope = "source-web";
			continue;
		}
		if (arg === "--all") {
			options.scope = "all";
			continue;
		}
		if (arg === "--dir") {
			options.handoffDir = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--out") {
			options.out = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		throw new Error(`Unknown requirements supply handoff argument: ${arg}`);
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

export function materializeRequirementsSupplyTarballs({
	cwd = ROOT,
	env = process.env,
	handoffDir = DEFAULT_HANDOFF_DIR,
	packages,
	supportingPackages = [],
} = {}) {
	const absoluteHandoffDir = path.resolve(cwd, handoffDir);
	mkdirSync(absoluteHandoffDir, { recursive: true });

	const packageManager = detectPackageManager({ cwd, env });
	const spawnCommand = packageManagerSpawnCommand(packageManager, [
		"pack",
		"--pack-destination",
		absoluteHandoffDir,
	]);
	const packed = [];
	for (const entry of [...packages, ...supportingPackages]) {
		const result = spawnSync(spawnCommand.command, spawnCommand.args, {
			cwd: path.join(cwd, entry.packageDir),
			encoding: "utf8",
		});
		if (result.error) {
			throw new Error(`${entry.packageName} pack failed: ${result.error.message}`);
		}
		if (result.status !== 0) {
			const details = trimOutput(result.stderr) || trimOutput(result.stdout);
			throw new Error(
				`${entry.packageName} pack failed with status ${result.status}` +
					(details ? `: ${details}` : ""),
			);
		}
		packed.push({
			packageName: entry.packageName,
			packageDir: entry.packageDir,
			tarball: entry.tarball,
			command: `${packageManager} pack --pack-destination ${maybeRelative(cwd, absoluteHandoffDir)}`,
		});
	}
	return packed;
}

export function buildRequirementsSupplyHandoff({
	cwd = ROOT,
	generatedAt = "2026-06-30T00:00:00.000Z",
	scope = "all",
	handoffDir = DEFAULT_HANDOFF_DIR,
	packed = [],
} = {}) {
	const config = readJson(path.join(cwd, "refarm.config.json"));
	const policy = config.releasePolicy;
	const selected = new Set(
		profilePackages(policy, VAULT_SEED_READY).map((profile) => profile.id),
	);
	const allPackages = sortForCleanFirst(profilePackages(policy, REQUIREMENTS_SUPPLY_TAG)
		.map((profile) => packageEntry({ cwd, profile, selected })));
	const packages = selectScope(allPackages, scope);
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
	const materializedPackages = packages.map((entry) => annotateTarball(entry, { cwd, handoffDir }));
	const materializedSupportingPackages = supportingPackages.map((entry) =>
		annotateTarball(entry, { cwd, handoffDir }),
	);
	const missingTarballs = [...materializedPackages, ...materializedSupportingPackages]
		.filter((entry) => !entry.exists)
		.map((entry) => entry.tarball);
	const issues = [
		...packages.flatMap((entry) =>
			entry.issues.map((message) => ({ packageName: entry.packageName, message })),
		),
	];
	const ok = issues.length === 0;
	const allExpectedTarballsExist = missingTarballs.length === 0;
	const state = !ok ? "blocked" : allExpectedTarballsExist ? "local-handoff-ready" : "candidate-hold";
	const manifestFile = manifestFileForScope(scope);

	return {
		schema: SCHEMA,
		schemaVersion: 1,
		source: SOURCE,
		generatedAt,
		ok: ok && (packed.length === 0 || allExpectedTarballsExist),
		state,
		selection: {
			id: "requirements-supply-candidates",
			source: "releasePolicy.packageProfiles",
			profileTag: REQUIREMENTS_SUPPLY_TAG,
			scope,
			selectedForVaultSeedReady: false,
		},
		handoffDir: maybeRelative(cwd, path.resolve(cwd, handoffDir)),
		manifestFile,
		packages: materializedPackages,
		supportingPackages: materializedSupportingPackages,
		packed,
		consumerInstall: buildConsumerInstall({
			packages: materializedPackages,
			supportingPackages: materializedSupportingPackages,
			cwd,
			handoffDir,
			manifestFile,
		}),
		consumerProofs: materializedPackages.map((entry) => entry.consumerPull).filter(Boolean),
		distributionEvidence: {
			state,
			verifiedLocalCopies: [...materializedPackages, ...materializedSupportingPackages]
				.filter((entry) => entry.exists).length,
			expectedLocalCopies: materializedPackages.length + materializedSupportingPackages.length,
			tarballFreshness: allExpectedTarballsExist ? "checked-present" : "not-checked-until-pack",
			promotionBoundary:
				"requires named downstream proof before vault-seed-ready selection or tarball handoff publication",
		},
		boundaries: [
			"packs only when --pack is explicit",
			"writes only requirements-supply handoff artifacts, not vault-seed-ready artifacts",
			"does not select requirements-supply packages for vault-seed-ready",
			"does not move private login, selectors, enrichment providers, or vocabulary into Refarm",
		],
		nextActions: [
			"consumer checkout records a named proof using consumerInstall.fileSpecs and pnpmOverrides",
			"promote only the consumed leaves after downstream proof and release boundary audit pass",
			"keep supporting Refarm dependencies visible as local overrides while unpublished",
		],
		missingTarballs,
		issueCount: issues.length,
		issues,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const options = parseArgs(process.argv.slice(2));
	let packed = [];
	if (options.pack) {
		const plan = buildRequirementsSupplyHandoff({
			scope: options.scope,
			handoffDir: options.handoffDir,
		});
		if (plan.issueCount > 0) {
			console.error(`requirements-supply-handoff: blocked (${plan.issueCount} issue(s))`);
			process.exit(1);
		}
		packed = materializeRequirementsSupplyTarballs({
			handoffDir: options.handoffDir,
			packages: plan.packages,
			supportingPackages: plan.supportingPackages,
		});
	}
	const result = buildRequirementsSupplyHandoff({
		scope: options.scope,
		handoffDir: options.handoffDir,
		packed,
	});
	const manifestOut = options.out ?? (options.pack ? path.join(result.handoffDir, result.manifestFile) : null);
	if (manifestOut) {
		const absoluteOut = path.resolve(ROOT, manifestOut);
		mkdirSync(path.dirname(absoluteOut), { recursive: true });
		writeFileSync(absoluteOut, `${JSON.stringify(result, null, 2)}\n`);
	}
	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`requirements-supply-handoff: ${result.ok ? "ok" : "blocked"} (${result.state})`);
	}
	process.exit(result.ok ? 0 : 1);
}
