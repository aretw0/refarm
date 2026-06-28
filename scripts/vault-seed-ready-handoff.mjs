#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
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
const VAULT_SEED_CONSUMER_PULLS = {
	"@refarm.dev/artifact-contract-v1": {
		downstreamUse: "Lab datasets, publication outbox, and notebook snapshot evidence",
		proofTarget: "vault-seed emits refarm.task-artifacts.v1 manifests from Lab/outbox/notebook producers",
		ownershipBoundary: "Vault schemas, notebook UX, and frontmatter remain downstream",
	},
	"@refarm.dev/channel-policy-v1": {
		downstreamUse: "Channel destinations, rate limits, receipts, dry-run, and review gates",
		proofTarget: "vault-seed Telegram adapter emits refarm.channel-delivery-envelope.v1",
		ownershipBoundary: "Provider API calls, copy formatting, and inbox/outbox UX remain downstream",
	},
	"@refarm.dev/effort-contract-v1": {
		downstreamUse: "Reusable task/effort evidence for dgk operations and handoffs",
		proofTarget: "dgk process flows attach effort identifiers to emitted evidence",
		ownershipBoundary: "dgk command vocabulary and operator UX remain downstream",
	},
	"@refarm.dev/launch-process": {
		downstreamUse: "Structured process runner primitive for dgk-runner and dgk-cli internals",
		proofTarget: "dgk-runner keeps run(cmd, args, opts) while using launch-process internally",
		ownershipBoundary: "dgk package names, binary, commands, and product labels remain downstream",
	},
	"@refarm.dev/release-engine": {
		downstreamUse: "Package acceptance, release planning, and publish dry-run policy",
		proofTarget: "vault-seed release/package smoke consumes release-engine acceptance output",
		ownershipBoundary: "Distribution identity, prose, and changelog content remain downstream",
	},
	"@refarm.dev/ds": {
		downstreamUse: "Lab/admin tokens and verde-jardim light/dark theme source",
		proofTarget: "vault-seed Lab/admin UI imports ds tokens and removes local semantic token fallback except for raw sessions",
		ownershipBoundary: "PARA vocabulary, editorial copy, and content semantics remain downstream",
	},
	"@refarm.dev/heartwood": {
		downstreamUse: "Shared crypto substrate needed by silo-backed credentials",
		proofTarget: "vault-seed credential flow uses silo without local crypto stand-ins",
		ownershipBoundary: "Credential policy choices and publishing identities remain downstream",
	},
	"@refarm.dev/dispatch-surface": {
		downstreamUse: "Multi-surface command/action descriptor substrate",
		proofTarget: "dgk exposes product commands through dispatch-surface-compatible descriptors",
		ownershipBoundary: "Surface labels, routes, and product-specific actions remain downstream",
	},
	"@refarm.dev/homestead-ssr": {
		downstreamUse: "Build-free SSR shell helpers for vault admin surfaces",
		proofTarget: "dgk serve/admin renders through homestead-ssr without pulling full Homestead",
		ownershipBoundary: "Admin copy, navigation, vault routes, and onboarding remain downstream",
	},
	"@refarm.dev/silo": {
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

function readPackageVersion(cwd, packageDir) {
	const packageJsonPath = path.join(cwd, packageDir, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
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

function maybeRelative(cwd, filePath) {
	const relative = path.relative(cwd, filePath);
	return relative.startsWith("..") ? filePath : relative;
}

function trimOutput(value) {
	return typeof value === "string" ? value.trim() : "";
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

export function buildHandoffManifest({
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
		return {
			schemaVersion: HANDOFF_MANIFEST_SCHEMA_VERSION,
			source: HANDOFF_MANIFEST_SOURCE,
			ok: false,
			status: plan.status ?? "blocked",
			selection: plan.selection ?? null,
			acceptance: releasePlanAcceptance(plan),
			handoffDir: maybeRelative(cwd, path.resolve(cwd, handoffDir)),
			packages: [],
			missing: [],
			extra: [],
			issues: [plan.reason ?? "release selection is not ready"],
		};
	}

	const absoluteHandoffDir = path.resolve(cwd, handoffDir);
	const handoffFiles = existsSync(absoluteHandoffDir)
		? readdirSync(absoluteHandoffDir).filter((file) => file.endsWith(".tgz")).sort()
		: [];
	const handoffFileSet = new Set(handoffFiles);

	const packages = check.commands.map((command) => {
		const version = readPackageVersion(cwd, command.packageDir);
		const tarball = packageTarballName(command.packageName, version);
		const filePath = path.join(absoluteHandoffDir, tarball);
		const exists = handoffFileSet.has(tarball) && existsSync(filePath);
		return {
			packageName: command.packageName,
			packageDir: command.packageDir,
			version,
			tarball,
			path: maybeRelative(cwd, filePath),
			exists,
			sha256: exists ? sha256File(filePath) : null,
			sizeBytes: exists ? statSync(filePath).size : null,
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
		missing,
		extra,
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
		if (options.pack) {
			materializeHandoffTarballs({
				handoffDir: options.handoffDir,
				releaseCheck,
			});
		}
		const manifest = buildHandoffManifest({
			handoffDir: options.handoffDir,
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
