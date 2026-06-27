#!/usr/bin/env node
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
import { releasePlanAcceptance } from "../packages/release-engine/src/index.mjs";
import { buildReleaseCheckPlan } from "./release-check.mjs";

const DEFAULT_SELECTION = "vault-seed-ready";
const DEFAULT_HANDOFF_DIR = ".refarm/handoff/vault-seed/2026-06-26";

export function parseHandoffArgs(argv = []) {
	const options = {
		selectionId: DEFAULT_SELECTION,
		handoffDir: DEFAULT_HANDOFF_DIR,
		json: false,
		out: null,
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
		"| Package | Tarball | SHA256 |",
		"| --- | --- | --- |",
	];

	for (const entry of manifest.packages) {
		lines.push(
			`| \`${entry.packageName}\` | \`${entry.tarball}\` | \`${entry.sha256 ?? "missing"}\` |`,
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
