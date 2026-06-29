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
import { buildReleaseCheckPlan } from "./release-check.mjs";

const DEFAULT_SELECTION = "vault-seed-ready";
const DEFAULT_HANDOFF_DIR = `.refarm/handoff/vault-seed/${new Date().toISOString().slice(0, 10)}`;
const HANDOFF_MANIFEST_SCHEMA_VERSION = 1;
const HANDOFF_MANIFEST_SOURCE = "vault-seed-ready-handoff";
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
		proofChecklist: "consumerProofs",
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
} = {}) {
	const check =
		releaseCheck ??
		buildReleaseCheckPlan({
			cwd,
			selectionId: DEFAULT_SELECTION,
		});

	if (!check.ok) {
		const plan = check.plan ?? { ok: false };
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
			missing: [],
			extra: [],
			prunedExtra,
			issues: [plan.reason ?? "release selection is not ready"],
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
		);
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
