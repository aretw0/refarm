#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONFIG_PATH = path.join(ROOT, "refarm.config.json");

const DEFAULT_PRUNE_DIR_NAMES = [
	"node_modules",
	".cache",
	".turbo",
	"dist",
	"build",
	"target",
];

function usage() {
	return [
		"Usage: node scripts/workspace-protect.mjs <mark|apply|check> [--json]",
		"",
		"Applies project-configured workspace protection for devcontainer-owned checkouts.",
	].join("\n");
}

function readConfig(rootDir = ROOT) {
	const configPath = path.join(rootDir, "refarm.config.json");
	if (!existsSync(configPath)) return {};
	return JSON.parse(readFileSync(configPath, "utf8"));
}

export function loadWorkspaceProtection(rootDir = ROOT, env = process.env) {
	const config = readConfig(rootDir);
	const policy = config.workspaceProtection ?? {};
	const refarmHome = env.REFARM_HOME
		? path.resolve(env.REFARM_HOME)
		: path.join(rootDir, ".refarm");
	const markerPath = path.resolve(
		rootDir,
		policy.marker ?? path.relative(rootDir, path.join(refarmHome, "devcontainer-workspace.env")),
	);
	return {
		enabled: policy.enabled !== false,
		hostWriteLock: env.REFARM_WORKSPACE_HOST_WRITE_LOCK
			? env.REFARM_WORKSPACE_HOST_WRITE_LOCK === "1"
			: policy.hostWriteLock === true,
		markerPath,
		roots: Array.isArray(policy.roots) ? policy.roots : [],
		pruneDirNames: Array.isArray(policy.pruneDirNames)
			? policy.pruneDirNames
			: DEFAULT_PRUNE_DIR_NAMES,
	};
}

function isInsideContainer() {
	return existsSync("/.dockerenv");
}

function printJson(payload) {
	console.log(JSON.stringify(payload, null, 2));
}

function fail(message, options = {}) {
	if (options.json) {
		printJson({
			ok: false,
			command: "workspace-protect",
			operation: options.operation ?? null,
			error: options.error ?? "workspace-protect-error",
			message,
			nextCommand: null,
			nextCommands: [],
		});
	} else {
		console.error(`[workspace-protect] ${message}`);
	}
	process.exit(1);
}

function ok(payload, options = {}) {
	if (options.json) {
		printJson({
			ok: true,
			command: "workspace-protect",
			...payload,
		});
	} else if (payload.message) {
		console.log(`[workspace-protect] ${payload.message}`);
	}
}

function resolveExistingRoots(rootDir, roots) {
	return roots
		.map((root) => path.resolve(rootDir, root))
		.filter((root) => root === rootDir || root.startsWith(`${rootDir}${path.sep}`))
		.filter((root) => existsSync(root));
}

export function buildFindPruneArgs(pruneDirNames) {
	const args = ["("];
	for (const [index, name] of pruneDirNames.entries()) {
		if (index > 0) args.push("-o");
		args.push("-name", name);
	}
	args.push(")", "-prune", "-o");
	return args;
}

function run(command, args, options) {
	const result = spawnSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: options.json ? ["ignore", "pipe", "pipe"] : "inherit",
	});
	if (result.status !== 0) {
		fail(`${command} ${args.join(" ")} failed.`, {
			...options,
			error: "subprocess-failed",
			details: options.json
				? {
						stdout: result.stdout ?? "",
						stderr: result.stderr ?? "",
					}
				: undefined,
		});
	}
}

function mark(options) {
	const policy = loadWorkspaceProtection(ROOT, process.env);
	if (!policy.enabled) {
		ok({ operation: "mark", skipped: true, message: "workspace protection disabled" }, options);
		return;
	}
	mkdirSync(path.dirname(policy.markerPath), { recursive: true });
	writeFileSync(
		policy.markerPath,
		[
			"REFARM_DEVCONTAINER_ACTIVE=true",
			`REFARM_DEVCONTAINER_ROOT=${ROOT}`,
			`REFARM_DEVCONTAINER_UID=${typeof process.getuid === "function" ? process.getuid() : ""}`,
			`REFARM_DEVCONTAINER_GID=${typeof process.getgid === "function" ? process.getgid() : ""}`,
			"",
		].join("\n"),
	);
	ok({
		operation: "mark",
		markerPath: policy.markerPath,
		message: `marked devcontainer workspace at ${path.relative(ROOT, policy.markerPath)}`,
	}, options);
}

function apply(options) {
	const policy = loadWorkspaceProtection(ROOT, process.env);
	if (!policy.enabled || !policy.hostWriteLock) {
		ok({ operation: "apply", skipped: true, message: "workspace host-write lock disabled" }, options);
		return;
	}
	if (!isInsideContainer()) {
		ok({ operation: "apply", skipped: true, message: "skipped outside container runtime" }, options);
		return;
	}
	if (!ROOT.startsWith("/workspaces/")) {
		ok({ operation: "apply", skipped: true, message: `skipped outside /workspaces: ${ROOT}` }, options);
		return;
	}
	const roots = resolveExistingRoots(ROOT, policy.roots);
	if (roots.length === 0) {
		fail("workspaceProtection.roots is empty or all roots are missing.", {
			...options,
			operation: "apply",
			error: "missing-roots",
		});
	}
	const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
	const gid = typeof process.getgid === "function" ? process.getgid() : os.userInfo().gid;
	const uidGid = `${uid}:${gid}`;
	const prune = buildFindPruneArgs(policy.pruneDirNames);

	for (const root of roots) {
		run("sudo", ["find", root, ...prune, "-exec", "chown", uidGid, "{}", "+"], options);
		run("find", [root, ...prune, "-type", "d", "-exec", "chmod", "u+rwx,go-w", "{}", "+"], options);
		run("find", [root, ...prune, "-type", "f", "-exec", "chmod", "u+rw,go-w", "{}", "+"], options);
	}
	ok({
		operation: "apply",
		roots: roots.map((root) => path.relative(ROOT, root) || "."),
		pruneDirNames: policy.pruneDirNames,
		message: `locked ${roots.length} configured workspace roots`,
	}, options);
}

function check(options) {
	const policy = loadWorkspaceProtection(ROOT, process.env);
	const markerExists = existsSync(policy.markerPath);
	ok({
		operation: "check",
		enabled: policy.enabled,
		hostWriteLock: policy.hostWriteLock,
		markerPath: policy.markerPath,
		markerExists,
		roots: policy.roots,
		pruneDirNames: policy.pruneDirNames,
		message: markerExists ? "workspace marker exists" : "workspace marker missing",
	}, options);
}

function main() {
	const args = process.argv.slice(2);
	const json = args.includes("--json");
	const operation = args.find((arg) => arg !== "--json");

	if (!operation || operation === "--help" || operation === "-h") {
		console.log(usage());
		process.exit(operation ? 0 : 1);
	}

	switch (operation) {
		case "mark":
			mark({ json, operation });
			break;
		case "apply":
			apply({ json, operation });
			break;
		case "check":
			check({ json, operation });
			break;
		default:
			fail(`Unknown operation: ${operation}\n${usage()}`, {
				json,
				operation,
				error: "unknown-operation",
			});
	}
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	main();
}
