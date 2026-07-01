#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectPackageManager,
	packageManagerSpawnCommand,
} from "../packages/config/src/package-manager.js";
import { releasePlanAcceptance } from "../packages/release-engine/src/index.mjs";
import { buildReleaseBoundaryAudit } from "./ci/release-boundary-audit.mjs";
import { buildReleaseCheckPlan } from "./release-check.mjs";

const DEFAULT_SELECTION = "vault-seed-ready";
const DEFAULT_HANDOFF_DIR = `.refarm/handoff/vault-seed/${new Date().toISOString().slice(0, 10)}`;
const HANDOFF_MANIFEST_SCHEMA_VERSION = 1;
const HANDOFF_MANIFEST_SOURCE = "vault-seed-ready-handoff";
const HANDOFF_DISTRIBUTION_EVIDENCE_SCHEMA = "refarm.vault-seed-ready-distribution-evidence.v1";
const PACKAGE_SOURCE_INPUTS = [
	"package.json",
	"README.md",
	"LICENSE",
	"LICENSE.md",
	"src",
	"wit",
	"Cargo.toml",
	"Cargo.lock",
];
const BUILD_SOURCE_INPUTS = ["src", "wit", "Cargo.toml", "Cargo.lock"];
const BUILD_OUTPUT_INPUTS = ["dist", "pkg"];
const VAULT_SEED_CONSUMER_PULLS = {
	"@refarm.dev/artifact-contract-v1": {
		proofId: "artifact-contract.lab-outbox-evidence",
		downstreamUse: "Lab datasets, publication outbox, and notebook snapshot evidence",
		proofTarget: "vault-seed emits refarm.task-artifacts.v1 manifests from Lab/outbox/notebook producers",
		ownershipBoundary: "Vault schemas, notebook UX, and frontmatter remain downstream",
	},
	"@refarm.dev/channel-policy-v1": {
		proofId: "channel-policy.telegram-delivery-envelope",
		downstreamUse: "Channel destinations, rate limits, receipts, dry-run, and review gates",
		proofTarget: "vault-seed Telegram adapter emits refarm.channel-delivery-envelope.v1",
		ownershipBoundary: "Provider API calls, copy formatting, and inbox/outbox UX remain downstream",
	},
	"@refarm.dev/effort-contract-v1": {
		proofId: "effort-contract.dgk-effort-evidence",
		downstreamUse: "Reusable task/effort evidence for dgk operations and handoffs",
		proofTarget: "dgk process flows attach effort identifiers to emitted evidence",
		ownershipBoundary: "dgk command vocabulary and operator UX remain downstream",
	},
	"@refarm.dev/process-handoff": {
		proofId: "process-handoff.dgk-runner-adapter",
		downstreamUse: "Structured process runner primitive for dgk-runner and dgk-cli internals",
		proofTarget: "dgk-runner keeps run(cmd, args, opts) while using process-handoff internally",
		ownershipBoundary: "dgk package names, binary, commands, and product labels remain downstream",
	},
	"@refarm.dev/release-engine": {
		proofId: "release-engine.package-acceptance",
		downstreamUse: "Package acceptance, release planning, and publish dry-run policy",
		proofTarget: "vault-seed release/package smoke consumes release-engine acceptance output",
		ownershipBoundary: "Distribution identity, prose, and changelog content remain downstream",
	},
	"@refarm.dev/ds": {
		proofId: "ds.lab-admin-static-document",
		downstreamUse: "Lab/admin tokens, verde-jardim theme source, and build-free DS HTML document helpers",
		proofTarget: "vault-seed Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead",
		ownershipBoundary: "PARA vocabulary, editorial copy, and content semantics remain downstream",
	},
	"@refarm.dev/heartwood": {
		proofId: "heartwood.silo-crypto-substrate",
		downstreamUse: "Shared crypto substrate needed by silo-backed credentials",
		proofTarget: "vault-seed credential flow uses silo without local crypto stand-ins",
		ownershipBoundary: "Credential policy choices and publishing identities remain downstream",
	},
	"@refarm.dev/identity-contract-v1": {
		proofId: "credentials-identity-contract.transitive-signature-support",
		downstreamUse: "identity:v1 contract support for credentials:v1 issuer and holder proofs",
		proofTarget: "vault-seed vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present",
		ownershipBoundary: "Issuer trust, DID methods, account recovery, and identity UX remain downstream",
	},
	"@refarm.dev/storage-contract-v1": {
		proofId: "credentials-storage-contract.transitive-wallet-support",
		downstreamUse: "storage:v1 contract support for credentials:v1 wallet store/list/remove",
		proofTarget: "vault-seed vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet",
		ownershipBoundary: "Durable wallet persistence, retention, encryption policy, and wallet UX remain downstream",
	},
	"@refarm.dev/identity-heartwood": {
		proofId: "credentials-identity-heartwood.reference-signature",
		downstreamUse: "Heartwood-backed identity:v1 issuer and holder signatures for the credentials smoke",
		proofTarget: "sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1",
		ownershipBoundary: "Trust registry, default identity provider choice, secret persistence, and DID resolution remain downstream",
	},
	"@refarm.dev/storage-memory": {
		proofId: "credentials-storage-memory.reference-wallet",
		downstreamUse: "Volatile storage:v1 implementation for credentials smoke and consumer-contract wallet proofs",
		proofTarget: "sovereign-citizen:reference:test stores and lists the issued credential through storage-memory",
		ownershipBoundary: "Production durability, synchronization, encryption-at-rest, and wallet UX remain downstream",
	},
	"@refarm.dev/credentials-contract-v1": {
		proofId: "credentials-contract.issue-verify-present-wallet",
		downstreamUse: "credentials:v1 contract for issue, policy-driven verify, present, store, list, remove, and revoke seams before VC UX",
		proofTarget: "vault-seed vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX",
		ownershipBoundary: "Issuer authorities, credential schemas, trust registry sources, remote status-list distribution, trust UI, and domain vocabulary remain downstream",
	},
	"@refarm.dev/dispatch-surface": {
		proofId: "dispatch-surface.dgk-descriptor",
		downstreamUse: "Multi-surface command/action descriptor substrate",
		proofTarget: "dgk exposes product commands through dispatch-surface-compatible descriptors",
		ownershipBoundary: "Surface labels, routes, and product-specific actions remain downstream",
	},
	"@refarm.dev/silo": {
		proofId: "silo.credential-namespaces",
		downstreamUse: "Scoped credential collection and secret namespace separation",
		proofTarget: "vault-seed stores model/runtime/publishing credentials through silo namespaces",
		ownershipBoundary: "Provider-specific publishing adapters and approval workflow remain downstream",
	},
	"@refarm.dev/source-contract-v1": {
		proofId: "requirements-source-contract.transitive-source-web-support",
		downstreamUse: "source:v1 contract support for the source-web vendor packet",
		proofTarget: "vault-seed vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition",
		ownershipBoundary: "Concrete login, selectors, and source profile vocabulary remain downstream",
	},
	"@refarm.dev/source-web": {
		proofId: "requirements-source-web.authenticated-capture",
		downstreamUse: "Authenticated source capture fixture feeding requirement-like records",
		proofTarget: "vault-seed wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1",
		ownershipBoundary: "Real credentials, discovery, selectors, pacing values, and source-specific ETL profiles remain downstream",
	},
	"@refarm.dev/enrichment-contract-v1": {
		proofId: "requirements-enrichment.private-provider-wrapper",
		downstreamUse: "Deterministic enrichment report contract for records and note projections",
		proofTarget: "vault-seed emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider",
		ownershipBoundary: "Private registries, lookup adapters, tag vocabulary, and domain enrichment rules remain downstream",
	},
	"@refarm.dev/records-contract-v1": {
		proofId: "requirements-records.knowledge-manifest",
		downstreamUse: "Neutral records:v1 manifest for source-linked knowledge/content evidence",
		proofTarget: "vault-seed validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof",
		ownershipBoundary: "PARA placement, editorial model, note rendering, and domain labels remain downstream",
	},
};

const REVENDOR_POLICY = {
	sameNameVersionBehavior:
		"file: tarballs can keep the same package name and version while their bytes change during pre-publication handoff.",
	changedContentDetection: "compare packages[].sha256 against the consumer vendor tarball and lockfile integrity",
	requiredWhenShaChanges: [
		"replace the matching vendor/*.tgz file from the same handoff directory",
		"refresh the package-manager lockfile entry for the changed file: tarball",
		"if the package manager keeps the old bytes, reinstall from a clean node_modules before running consumer proofs",
	],
	proofAfterRefresh: "consumerProofs",
};

export function parseHandoffArgs(argv = []) {
	const options = {
		selectionId: DEFAULT_SELECTION,
		handoffDir: DEFAULT_HANDOFF_DIR,
		json: false,
		out: null,
		pack: false,
		pruneExtra: false,
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
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--pack") {
			options.pack = true;
			continue;
		}
		if (arg === "--prune-extra") {
			options.pruneExtra = true;
			continue;
		}
		throw new Error(`Unknown handoff argument: ${arg}`);
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

export function packageTarballName(packageName, version) {
	const unscoped = packageName.startsWith("@")
		? packageName.slice(1)
		: packageName;
	return `${unscoped.replace("/", "-")}-${version}.tgz`;
}

function readPackageJson(cwd, packageDir) {
	const packageJsonPath = path.join(cwd, packageDir, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	return { packageJsonPath, packageJson };
}

function readPackageVersion(cwd, packageDir) {
	const { packageJsonPath, packageJson } = readPackageJson(cwd, packageDir);
	if (!packageJson.version) {
		throw new Error(`${packageJsonPath} does not declare version`);
	}
	return packageJson.version;
}

function sha256File(filePath) {
	const hash = createHash("sha256");
	hash.update(readFileSync(filePath));
	return hash.digest("hex");
}

function isBuildSourceFile(filePath) {
	const basename = path.basename(filePath);
	if (/\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(basename)) {
		return false;
	}
	return /\.(cjs|css|js|jsx|mjs|rs|ts|tsx|wit)$/.test(basename);
}

function latestPathMtime(filePath, { includeFile = () => true } = {}) {
	if (!existsSync(filePath)) {
		return null;
	}

	const stats = statSync(filePath);
	if (!stats.isDirectory()) {
		if (!includeFile(filePath)) {
			return null;
		}
		return { path: filePath, mtimeMs: stats.mtimeMs };
	}

	let latest = null;
	for (const entry of readdirSync(filePath)) {
		const candidate = latestPathMtime(path.join(filePath, entry), { includeFile });
		if (!candidate) {
			continue;
		}
		if (!latest || candidate.mtimeMs > latest.mtimeMs) {
			latest = candidate;
		}
	}
	return latest;
}

function latestPackageInput(cwd, packageDir, inputs, options = {}) {
	const packagePath = path.join(cwd, packageDir);
	let latest = null;
	for (const input of inputs) {
		const candidate = latestPathMtime(path.join(packagePath, input), options);
		if (!candidate) {
			continue;
		}
		if (!latest || candidate.mtimeMs > latest.mtimeMs) {
			latest = candidate;
		}
	}
	return latest
		? {
				path: maybeRelative(cwd, latest.path),
				mtimeMs: latest.mtimeMs,
			}
		: null;
}

function latestPackageSourceInput(cwd, packageDir) {
	return latestPackageInput(cwd, packageDir, PACKAGE_SOURCE_INPUTS);
}

function latestPackageBuildInput(cwd, packageDir) {
	return latestPackageInput(cwd, packageDir, BUILD_SOURCE_INPUTS, {
		includeFile: isBuildSourceFile,
	});
}

function latestPackageBuildOutput(cwd, packageDir) {
	return latestPackageInput(cwd, packageDir, BUILD_OUTPUT_INPUTS);
}

function packageReferencesBuildOutput(packageJson) {
	const serialized = JSON.stringify({
		bin: packageJson.bin,
		exports: packageJson.exports,
		files: packageJson.files,
		main: packageJson.main,
		module: packageJson.module,
		types: packageJson.types,
	});
	return /(^|["/])(dist|pkg)(["/]|$)/.test(serialized);
}

function maybeRelative(cwd, filePath) {
	const relative = path.relative(cwd, filePath);
	return relative.startsWith("..") ? filePath : relative;
}

function trimOutput(value) {
	return typeof value === "string" ? value.trim() : "";
}

function buildConsumerProofs(packages) {
	return packages
		.filter((entry) => entry.consumerPull)
		.map((entry) => ({
			proofId: entry.consumerPull.proofId,
			packageName: entry.packageName,
			downstreamUse: entry.consumerPull.downstreamUse,
			proofTarget: entry.consumerPull.proofTarget,
			ownershipBoundary: entry.consumerPull.ownershipBoundary,
		}));
}

function buildHandoffBoundaryAudit({ cwd, releaseBoundaryAudit }) {
	if (releaseBoundaryAudit !== undefined) {
		return releaseBoundaryAudit;
	}
	if (!existsSync(path.join(cwd, "refarm.config.json"))) {
		return null;
	}
	const audit = buildReleaseBoundaryAudit({ root: cwd });
	return {
		schemaVersion: audit.schemaVersion,
		command: audit.command,
		ok: audit.ok,
		selectionId: audit.selectionId,
		auditedPackageCount: audit.auditedPackageCount,
		auditedPackages: audit.auditedPackages,
		issueCount: audit.issueCount,
		issues: audit.issues,
	};
}

function releaseBoundaryAuditIssues(releaseBoundaryAudit) {
	if (!releaseBoundaryAudit || releaseBoundaryAudit.ok) {
		return [];
	}
	if ((releaseBoundaryAudit.issues ?? []).length === 0) {
		return ["release boundary audit failed"];
	}
	return releaseBoundaryAudit.issues.map((item) => {
		const code = item.code ? `${item.code}: ` : "";
		return `release boundary audit ${code}${item.message}`;
	});
}

function buildConsumerInstall({ packages, handoffDir }) {
	const fileSpecs = Object.fromEntries(
		packages.map((entry) => [
			entry.packageName,
			`file:./vendor/${entry.tarball}`,
		]),
	);
	return {
		packageManager: "pnpm",
		vendorDir: "vendor",
		copyFrom: handoffDir,
		copyFiles: ["manifest.json", ...packages.map((entry) => entry.tarball)],
		fileSpecs,
		pnpmOverrides: { ...fileSpecs },
		revendorPolicy: REVENDOR_POLICY,
		proofChecklist: "consumerProofs",
	};
}

function handoffRef(handoffDir) {
	const normalized = handoffDir.replace(/\\/g, "/");
	const marker = ".refarm/handoff/vault-seed/";
	const markerIndex = normalized.indexOf(marker);
	const suffix = markerIndex >= 0
		? normalized.slice(markerIndex + marker.length)
		: path.basename(normalized);
	return `refarm-handoff://vault-seed-ready/${suffix || "local"}`;
}

function buildDistributionEvidence({
	packages,
	manifestOk,
	handoffDir,
	acceptance,
	releaseBoundaryAudit = null,
	selectionId = DEFAULT_SELECTION,
	issues = [],
}) {
	const presentPackages = packages.filter((entry) => entry.exists);
	const tarballs = packages.map((entry) => ({
		packageName: entry.packageName,
		version: entry.version,
		tarball: entry.tarball,
		sha256: entry.sha256,
		exists: entry.exists,
	}));
	return {
		schema: HANDOFF_DISTRIBUTION_EVIDENCE_SCHEMA,
		stableRef: "refarm-handoff://vault-seed-ready",
		currentRef: handoffRef(handoffDir),
		state: manifestOk ? "local-handoff-ready" : "blocked",
		subject: {
			kind: "release-selection",
			selectionId,
			packageCount: packages.length,
			packageNames: packages.map((entry) => entry.packageName),
			tarballs: tarballs.map((entry) => entry.tarball),
		},
		availability: {
			mode: "local-handoff",
			minAvailableCopies: 1,
			currentVerifiedCopies: packages.length > 0 && presentPackages.length === packages.length ? 1 : 0,
			offlineBehavior: "consumer can use copied vendor tarballs after SHA-256 verification",
			actors: [
				{
					id: "refarm-local-handoff",
					role: "primary-source",
					required: true,
					ref: handoffRef(handoffDir),
				},
				{
					id: "consumer-vendor-copy",
					role: "expected-replica",
					required: false,
					ref: "consumerInstall.vendorDir",
				},
			],
		},
		update: {
			source: "release-engine",
			strategy: "replace handoff directory and selected package tarballs",
			acceptanceStatus: acceptance?.status ?? "unknown",
			evidenceRefs: [
				"acceptance",
				"packages[].sha256",
				"consumerProofs",
				"consumerInstall.revendorPolicy",
				...(releaseBoundaryAudit ? ["releaseBoundaryAudit"] : []),
			],
		},
		rollback: {
			strategy: "retain previous handoff directory or pinned consumer vendor tarballs",
			targetRef: "previous refarm-handoff://vault-seed-ready/<date>",
			requiresHumanApproval: true,
		},
		integrity: {
			algorithm: "sha256",
			tarballs,
		},
		boundary: {
			publicInstallContract: false,
			p2pSubstrateAdopted: false,
			pearRuntimeAdopted: false,
			appOwnedContract: false,
			productReady: false,
			releaseBoundaryAudit: releaseBoundaryAudit
				? {
						command: releaseBoundaryAudit.command,
						ok: releaseBoundaryAudit.ok,
						selectionId: releaseBoundaryAudit.selectionId,
						issueCount: releaseBoundaryAudit.issueCount,
					}
				: null,
		},
		issues,
	};
}

function expectedTarballSet(cwd, commands) {
	return new Set(
		commands.map((command) =>
			packageTarballName(command.packageName, readPackageVersion(cwd, command.packageDir)),
		),
	);
}

export function materializeHandoffTarballs({
	cwd = process.cwd(),
	env = process.env,
	handoffDir = DEFAULT_HANDOFF_DIR,
	releaseCheck,
} = {}) {
	const check =
		releaseCheck ??
		buildReleaseCheckPlan({
			cwd,
			selectionId: DEFAULT_SELECTION,
		});

	if (!check.ok) {
		const plan = check.plan ?? { ok: false };
		throw new Error(plan.reason ?? "release selection is not ready");
	}

	const absoluteHandoffDir = path.resolve(cwd, handoffDir);
	mkdirSync(absoluteHandoffDir, { recursive: true });

	const packageManager = detectPackageManager({ cwd, env });
	const spawnCommand = packageManagerSpawnCommand(packageManager, [
		"pack",
		"--pack-destination",
		absoluteHandoffDir,
	]);
	const packed = [];

	for (const command of check.commands) {
		const packageCwd = path.join(cwd, command.packageDir);
		const result = spawnSync(spawnCommand.command, spawnCommand.args, {
			cwd: packageCwd,
			encoding: "utf8",
		});

		if (result.error) {
			throw new Error(`${command.packageName} pack failed: ${result.error.message}`);
		}
		if (result.status !== 0) {
			const details = trimOutput(result.stderr) || trimOutput(result.stdout);
			throw new Error(
				`${command.packageName} pack failed with status ${result.status}` +
					(details ? `: ${details}` : ""),
			);
		}

		packed.push({
			packageName: command.packageName,
			packageDir: command.packageDir,
			command: `${packageManager} pack --pack-destination ${maybeRelative(cwd, absoluteHandoffDir)}`,
		});
	}

	return packed;
}

export function pruneExtraHandoffTarballs({
	cwd = process.cwd(),
	handoffDir = DEFAULT_HANDOFF_DIR,
	releaseCheck,
} = {}) {
	const check =
		releaseCheck ??
		buildReleaseCheckPlan({
			cwd,
			selectionId: DEFAULT_SELECTION,
		});

	if (!check.ok) {
		const plan = check.plan ?? { ok: false };
		throw new Error(plan.reason ?? "release selection is not ready");
	}

	const absoluteHandoffDir = path.resolve(cwd, handoffDir);
	if (!existsSync(absoluteHandoffDir)) {
		return [];
	}

	const expected = expectedTarballSet(cwd, check.commands);
	const pruned = [];
	const tarballs = readdirSync(absoluteHandoffDir)
		.filter((entry) => entry.endsWith(".tgz"))
		.sort();
	for (const file of tarballs) {
		if (expected.has(file)) {
			continue;
		}
		unlinkSync(path.join(absoluteHandoffDir, file));
		pruned.push(file);
	}
	return pruned;
}

export function buildHandoffManifest({
	cwd = process.cwd(),
	handoffDir = DEFAULT_HANDOFF_DIR,
	prunedExtra = [],
	releaseCheck,
	releaseBoundaryAudit,
} = {}) {
	const check =
		releaseCheck ??
		buildReleaseCheckPlan({
			cwd,
			selectionId: DEFAULT_SELECTION,
		});
	const boundaryAudit = buildHandoffBoundaryAudit({ cwd, releaseBoundaryAudit });

	if (!check.ok) {
		const plan = check.plan ?? { ok: false };
		const issues = [
			plan.reason ?? "release selection is not ready",
			...releaseBoundaryAuditIssues(boundaryAudit),
		];
		return {
			schemaVersion: HANDOFF_MANIFEST_SCHEMA_VERSION,
			source: HANDOFF_MANIFEST_SOURCE,
			ok: false,
			status: plan.status ?? "blocked",
			selection: plan.selection ?? null,
			acceptance: releasePlanAcceptance(plan),
			handoffDir: maybeRelative(cwd, path.resolve(cwd, handoffDir)),
			packages: [],
			consumerInstall: buildConsumerInstall({
				packages: [],
				handoffDir: maybeRelative(cwd, path.resolve(cwd, handoffDir)),
			}),
			consumerProofs: [],
			releaseBoundaryAudit: boundaryAudit,
			distributionEvidence: buildDistributionEvidence({
				packages: [],
				manifestOk: false,
				handoffDir: maybeRelative(cwd, path.resolve(cwd, handoffDir)),
				acceptance: releasePlanAcceptance(plan),
				releaseBoundaryAudit: boundaryAudit,
				selectionId: plan.selection?.id ?? DEFAULT_SELECTION,
				issues,
			}),
			missing: [],
			extra: [],
			prunedExtra,
			issues,
		};
	}

	const absoluteHandoffDir = path.resolve(cwd, handoffDir);
	const handoffFiles = existsSync(absoluteHandoffDir)
		? readdirSync(absoluteHandoffDir).filter((file) => file.endsWith(".tgz")).sort()
		: [];
	const handoffFileSet = new Set(handoffFiles);

	const packages = check.commands.map((command) => {
		const { packageJson } = readPackageJson(cwd, command.packageDir);
		const version = readPackageVersion(cwd, command.packageDir);
		const tarball = packageTarballName(command.packageName, version);
		const filePath = path.join(absoluteHandoffDir, tarball);
		const exists = handoffFileSet.has(tarball) && existsSync(filePath);
		const tarballStats = exists ? statSync(filePath) : null;
		const latestSourceInput = latestPackageSourceInput(cwd, command.packageDir);
		const buildInput = latestPackageBuildInput(cwd, command.packageDir);
		const buildOutput = packageReferencesBuildOutput(packageJson)
			? latestPackageBuildOutput(cwd, command.packageDir)
			: null;
		const stale =
			exists &&
			latestSourceInput !== null &&
			tarballStats !== null &&
			latestSourceInput.mtimeMs > tarballStats.mtimeMs;
		const buildOutputStale =
			buildInput !== null &&
			packageReferencesBuildOutput(packageJson) &&
			(buildOutput === null || buildInput.mtimeMs > buildOutput.mtimeMs);
		return {
			packageName: command.packageName,
			packageDir: command.packageDir,
			version,
			tarball,
			path: maybeRelative(cwd, filePath),
			exists,
			sha256: exists ? sha256File(filePath) : null,
			sizeBytes: tarballStats ? tarballStats.size : null,
			stale,
			sourceInput: latestSourceInput,
			buildInput,
			buildOutput,
			buildOutputStale,
			consumerPull: VAULT_SEED_CONSUMER_PULLS[command.packageName] ?? null,
		};
	});

	const expected = new Set(packages.map((entry) => entry.tarball));
	const missing = packages
		.filter((entry) => !entry.exists)
		.map((entry) => entry.tarball);
	const extra = handoffFiles.filter((file) => !expected.has(file));
	const issues = [
		...missing.map((file) => `missing expected tarball: ${file}`),
		...extra.map((file) => `unexpected tarball: ${file}`),
		...packages
			.filter((entry) => entry.stale)
			.map(
				(entry) =>
					`stale tarball: ${entry.tarball} is older than ${entry.sourceInput?.path ?? entry.packageDir}`,
			),
		...packages
			.filter((entry) => entry.buildOutputStale)
			.map((entry) =>
				entry.buildOutput
					? `stale build output: ${entry.packageName} output ${entry.buildOutput.path} is older than ${entry.buildInput?.path ?? entry.packageDir}`
					: `missing build output: ${entry.packageName} has publishable build output but no dist/pkg files`,
			),
		...releaseBoundaryAuditIssues(boundaryAudit),
	];

	return {
		schemaVersion: HANDOFF_MANIFEST_SCHEMA_VERSION,
		source: HANDOFF_MANIFEST_SOURCE,
		ok: issues.length === 0,
		status: check.plan.status,
		selection: check.plan.selection,
		acceptance: releasePlanAcceptance(check.plan),
		handoffDir: maybeRelative(cwd, absoluteHandoffDir),
		packages,
		consumerInstall: buildConsumerInstall({
			packages,
			handoffDir: maybeRelative(cwd, absoluteHandoffDir),
		}),
		consumerProofs: buildConsumerProofs(packages),
		releaseBoundaryAudit: boundaryAudit,
		distributionEvidence: buildDistributionEvidence({
			packages,
			manifestOk: issues.length === 0,
			handoffDir: maybeRelative(cwd, absoluteHandoffDir),
			acceptance: releasePlanAcceptance(check.plan),
			releaseBoundaryAudit: boundaryAudit,
			selectionId: check.plan.selection?.id ?? DEFAULT_SELECTION,
			issues,
		}),
		missing,
		extra,
		prunedExtra,
		issues,
	};
}

export function formatHandoffMarkdown(manifest) {
	const lines = [
		`# ${manifest.selection?.id ?? "release"} handoff`,
		"",
		`Directory: \`${manifest.handoffDir}\``,
		`Status: ${manifest.ok ? "ok" : "blocked"}`,
		`Acceptance: ${manifest.acceptance?.status ?? "unknown"} ` +
			`(${manifest.acceptance?.packageCount ?? 0} package(s), ` +
			`${manifest.acceptance?.requiredCheckCount ?? 0} required check(s))`,
		"",
		"| Package | Tarball | SHA256 | Consumer proof |",
		"| --- | --- | --- | --- |",
	];

	for (const entry of manifest.packages) {
		lines.push(
			`| \`${entry.packageName}\` | \`${entry.tarball}\` | \`${entry.sha256 ?? "missing"}\` | ${entry.consumerPull?.proofTarget ?? "none declared"} |`,
		);
	}

	if ((manifest.consumerProofs ?? []).length > 0) {
		lines.push("", "Consumer proofs:", "");
		for (const proof of manifest.consumerProofs) {
			lines.push(
				`- \`${proof.proofId}\` / \`${proof.packageName}\`: ${proof.proofTarget} (${proof.ownershipBoundary})`,
			);
		}
	}

	if (manifest.consumerInstall) {
		lines.push(
			"",
			"Consumer install hints:",
			"",
			`- Vendor dir: \`${manifest.consumerInstall.vendorDir}\``,
			`- Proof checklist: \`${manifest.consumerInstall.proofChecklist}\``,
			"- Use `consumerInstall.fileSpecs` for direct dependencies and `consumerInstall.pnpmOverrides` for unpublished transitive `@refarm.dev/*` packages.",
			"- If a copied tarball keeps the same package name/version but its `packages[].sha256` changes, follow `consumerInstall.revendorPolicy` before running consumer proofs.",
		);
	}

	if (manifest.distributionEvidence) {
		lines.push(
			"",
			"Distribution evidence:",
			"",
			`- State: \`${manifest.distributionEvidence.state}\``,
			`- Stable ref: \`${manifest.distributionEvidence.stableRef}\``,
			`- Current ref: \`${manifest.distributionEvidence.currentRef}\``,
			`- Rollback: ${manifest.distributionEvidence.rollback.strategy}`,
		);
	}

	if (manifest.releaseBoundaryAudit) {
		lines.push(
			"",
			"Release boundary audit:",
			"",
			`- Command: \`${manifest.releaseBoundaryAudit.command}\``,
			`- Status: \`${manifest.releaseBoundaryAudit.ok ? "ok" : "blocked"}\``,
			`- Selection: \`${manifest.releaseBoundaryAudit.selectionId}\``,
			`- Audited packages: ${manifest.releaseBoundaryAudit.auditedPackageCount}`,
		);
		if ((manifest.releaseBoundaryAudit.issues ?? []).length > 0) {
			for (const issue of manifest.releaseBoundaryAudit.issues) {
				lines.push(`- ${issue.code}: ${issue.message}`);
			}
		}
	}

	if ((manifest.prunedExtra ?? []).length > 0) {
		lines.push("", "Pruned generated extras:", "");
		for (const file of manifest.prunedExtra) {
			lines.push(`- \`${file}\``);
		}
	}

	if (manifest.issues.length > 0) {
		lines.push("", "Issues:");
		for (const issue of manifest.issues) {
			lines.push(`- ${issue}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

function writeOutput(outPath, content) {
	mkdirSync(path.dirname(outPath), { recursive: true });
	writeFileSync(outPath, content, "utf8");
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	try {
		const options = parseHandoffArgs(process.argv.slice(2));
		const releaseCheck = buildReleaseCheckPlan({
			selectionId: options.selectionId,
		});
		let prunedExtra = [];
		if (options.pack) {
			materializeHandoffTarballs({
				handoffDir: options.handoffDir,
				releaseCheck,
			});
		}
		if (options.pruneExtra) {
			prunedExtra = pruneExtraHandoffTarballs({
				handoffDir: options.handoffDir,
				releaseCheck,
			});
		}
		const manifest = buildHandoffManifest({
			handoffDir: options.handoffDir,
			prunedExtra,
			releaseCheck,
		});
		const output = options.json
			? `${JSON.stringify(manifest, null, 2)}\n`
			: formatHandoffMarkdown(manifest);

		if (options.out) {
			writeOutput(options.out, output);
		} else {
			process.stdout.write(output);
		}

		if (!manifest.ok) {
			process.exit(1);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[vault-seed-ready:handoff] ${message}`);
		process.exit(1);
	}
}
