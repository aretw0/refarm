#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPackageScriptCommand } from "../packages/config/src/package-manager.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = path.join(ROOT, "apps/refarm/dist/index.js");
const LOADER_ENTRY = path.join(ROOT, "scripts/farmhand-node-register-loader.mjs");
const NEXT_COMMAND = "refarm check --next-action --json";

function usageText() {
	return [
		"Usage: node scripts/install-refarm-cli.mjs [--build] [--dry-run] [--json]",
		"",
		"Installs a local refarm shell shim for this checkout.",
		"",
		"Options:",
		"  --build    Force rebuilding @refarm.dev/refarm before installing",
		"  --dry-run  Print the install plan without writing shims",
		"  --json     Print a machine-readable install envelope",
		"  --help     Show this help",
	].join("\n");
}

function parseArgs(argv) {
	const options = {
		dryRun: false,
		forceBuild: false,
		help: false,
		json: false,
		unknown: [],
	};
	for (const arg of argv) {
		switch (arg) {
			case "--build":
				options.forceBuild = true;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			case "--json":
				options.json = true;
				break;
			default:
				options.unknown.push(arg);
				break;
		}
	}
	return options;
}

function printJson(payload) {
	console.log(JSON.stringify(payload, null, 2));
}

function fail(message, status = 1, options = {}) {
	if (options.json) {
		printJson({
			schemaVersion: 1,
			ok: false,
			command: "install-refarm-cli",
			error: options.error ?? "install-refarm-cli-error",
			message,
			...(options.details ? { details: options.details } : {}),
			nextCommand: null,
			nextCommands: [],
		});
	} else {
		console.error(`[install-refarm-cli] ${message}`);
	}
	process.exit(status);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: ROOT,
		encoding: options.json ? "utf8" : undefined,
		stdio: options.json ? ["ignore", "pipe", "pipe"] : "inherit",
	});

	if (result.status !== 0) {
		fail(`${command} ${args.join(" ")} failed.`, result.status ?? 1, {
			...options,
			details: options.json
				? {
						stdout: result.stdout ?? "",
						stderr: result.stderr ?? "",
					}
				: undefined,
		});
	}
}

function pathIncludes(directory) {
	return (process.env.PATH ?? "")
		.split(path.delimiter)
		.filter(Boolean)
		.some((entry) => path.resolve(entry) === path.resolve(directory));
}

function resolveBinDir() {
	if (process.env.REFARM_CLI_BIN_DIR) {
		return path.resolve(process.env.REFARM_CLI_BIN_DIR);
	}

	const npmGlobal = path.join(os.homedir(), ".npm-global/bin");
	const localBin = path.join(os.homedir(), ".local/bin");
	const winNpmBin = process.env.APPDATA
		? path.join(process.env.APPDATA, "npm")
		: path.join(os.homedir(), "AppData", "Roaming", "npm");
	if (process.platform === "win32" && pathIncludes(winNpmBin)) {
		return winNpmBin;
	}

	if (process.platform === "win32") {
		return winNpmBin;
	}

	if (pathIncludes(npmGlobal)) {
		return npmGlobal;
	}

	if (pathIncludes(localBin)) {
		return localBin;
	}

	if (existsSync(npmGlobal)) {
		return npmGlobal;
	}

	return localBin;
}

const REQUIRED_NODE_MAJOR = 22;
const options = parseArgs(process.argv.slice(2));

if (options.help) {
	console.log(usageText());
	process.exit(0);
}

if (options.unknown.length > 0) {
	fail(
		`Unknown argument(s): ${options.unknown.join(", ")}\n${usageText()}`,
		1,
		{ json: options.json, error: "unknown-argument" },
	);
}

const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < REQUIRED_NODE_MAJOR) {
	fail(
		`Node.js ${REQUIRED_NODE_MAJOR}+ required (found: ${process.version}). Install via fnm: https://github.com/Schniz/fnm`,
		1,
		{ json: options.json, error: "node-version-too-old" },
	);
}

const dryRun = options.dryRun;
const forceBuild = options.forceBuild;
const buildRequired = forceBuild || !existsSync(DIST_ENTRY);
const build = buildRequired
	? createPackageScriptCommand({
			cwd: path.join(ROOT, "apps/refarm"),
			repoRoot: ROOT,
			script: "build",
		})
	: null;

if (build) {
	if (dryRun) {
		if (!options.json) {
			console.log(
				`[install-refarm-cli][dry-run] would build @refarm.dev/refarm with ${build.display}`,
			);
		}
	} else {
		if (!options.json) {
			console.log(
				`[install-refarm-cli] Building @refarm.dev/refarm with ${build.display}...`,
			);
		}
		run(build.command, build.args, { json: options.json, error: "build-failed" });
	}
}

if (!dryRun && !existsSync(DIST_ENTRY)) {
	fail(`Missing dist entry after build: ${DIST_ENTRY}`, 1, {
		json: options.json,
		error: "missing-dist-entry",
	});
}

if (!dryRun) {
	chmodSync(DIST_ENTRY, 0o755);
}

const binDir = resolveBinDir();
if (!dryRun) {
	mkdirSync(binDir, { recursive: true });
}

const loaderSpecifier = pathToFileURL(LOADER_ENTRY).href;
const shimPath = path.join(binDir, "refarm");
const cmdPath = path.join(binDir, "refarm.cmd");
const shimBody = `#!/usr/bin/env bash
set -euo pipefail
export REFARM_COMMAND=${JSON.stringify(shimPath)}
exec node --import ${JSON.stringify(loaderSpecifier)} ${JSON.stringify(DIST_ENTRY)} "$@"
`;

if (dryRun) {
	if (!options.json) {
		console.log(`[install-refarm-cli][dry-run] would install refarm shim -> ${shimPath}`);
	}
} else {
	writeFileSync(shimPath, shimBody);
	chmodSync(shimPath, 0o755);
	if (!options.json) {
		console.log(`[install-refarm-cli] Installed refarm shim -> ${shimPath}`);
	}
}

if (process.platform === "win32") {
	const cmdBody = `@echo off\r\nset "REFARM_COMMAND=%~f0"\r\nnode --import "${loaderSpecifier}" "${DIST_ENTRY}" %*\r\n`;
	if (dryRun) {
		if (!options.json) {
			console.log(
				`[install-refarm-cli][dry-run] would install refarm cmd shim -> ${cmdPath}`,
			);
		}
	} else {
		writeFileSync(cmdPath, cmdBody);
		if (!options.json) {
			console.log(`[install-refarm-cli] Installed refarm cmd shim -> ${cmdPath}`);
		}
	}
}

const binDirInPath = pathIncludes(binDir);
const warnings = [];
if (!binDirInPath) {
	warnings.push(`${binDir} is not in PATH.`);
}

if (options.json) {
	printJson({
		schemaVersion: 1,
		ok: true,
		command: "install-refarm-cli",
		dryRun,
		forceBuild,
		root: ROOT,
		platform: process.platform,
		node: process.version,
		distEntry: DIST_ENTRY,
		loaderEntry: LOADER_ENTRY,
		binDir,
		binDirInPath,
		build: build
			? {
					required: true,
					process: build,
				}
			: {
					required: false,
					process: null,
				},
		shims: {
			posix: shimPath,
			windows: process.platform === "win32" ? cmdPath : null,
		},
		warnings,
		nextCommand: NEXT_COMMAND,
		nextCommands: [NEXT_COMMAND],
	});
} else {
	if (!binDirInPath) {
		console.warn(`[install-refarm-cli] WARN: ${binDir} is not in PATH.`);
	}

	console.log(`[install-refarm-cli] Next: ${NEXT_COMMAND}`);
}
