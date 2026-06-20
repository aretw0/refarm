import { spawn } from "node:child_process";
import { access, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createPackageScriptCommand } from "../../packages/config/src/package-manager.js";

const TASK_SMOKE_TS_BUILD_ORDER = [
	"packages/root",
	"packages/effort-contract-v1",
	"packages/dispatch-surface",
	"packages/artifact-contract-v1",
	"packages/automation-contract-v1",
	"packages/identity-contract-v1",
	"packages/node-contract-v1",
	"packages/storage-contract-v1",
	"packages/task-contract-v1",
	"packages/session-contract-v1",
	"packages/sync-contract-v1",
	"packages/stream-contract-v1",
	"packages/context-provider-v1",
	"packages/file-stream-transport",
	"packages/sse-stream-transport",
	"packages/ws-stream-transport",
	"packages/storage-sqlite",
	"packages/registry",
	"packages/tractor-ts",
	"packages/silo",
	"packages/windmill",
	"packages/runtime",
	"packages/sower",
	"packages/health",
	"packages/trust",
	"packages/sync-loro",
	"packages/ds",
	"packages/homestead",
	"packages/cli",
	"packages/prompt-contract-v1",
	"packages/infra-contract-v1",
	"packages/policy-contract-v1",
	"packages/infra-turbo-cache",
	"packages/infra-cloudflare",
	"apps/farmhand",
	"apps/refarm",
];

const TASK_SMOKE_WORKSPACE_ROOTS = ["packages", "apps"];

function workspaceDirPath(...parts) {
	return parts.join("/");
}

async function workspacePackagePath(workspaceDir) {
	const packagePath = path.join(workspaceDir, "package.json");
	await access(packagePath);
	return packagePath;
}

async function loadWorkspacePackageMap() {
	const map = new Map();

	for (const rootDir of TASK_SMOKE_WORKSPACE_ROOTS) {
		let entries = [];
		try {
			entries = await readdir(rootDir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const workspaceDir = workspaceDirPath(rootDir, entry.name);
			const packagePath = path.join(workspaceDir, "package.json");
			try {
				const pkg = JSON.parse(await readFile(packagePath, "utf8"));
				if (!pkg?.name) continue;
				let hasTsBuildConfig = false;
				try {
					await access(path.join(workspaceDir, "tsconfig.build.json"));
					hasTsBuildConfig = true;
				} catch {
					hasTsBuildConfig = false;
				}
				map.set(pkg.name, {
					name: pkg.name,
					dir: workspaceDir,
					hasBuildScript: Boolean(pkg?.scripts?.build),
					isTypeScriptBuild: Boolean(pkg?.scripts?.build) && hasTsBuildConfig,
				});
			} catch {
				// ignore non-package directories
			}
		}
	}

	return map;
}

function workspaceDependencyNames(pkg) {
	return Object.keys({
		...(pkg.dependencies ?? {}),
		...(pkg.peerDependencies ?? {}),
		...(pkg.optionalDependencies ?? {}),
	});
}

async function collectWorkspaceTypeBuildDependencies(
	workspaceDir,
	workspaceByName,
	collected = new Set(),
	seen = new Set(),
) {
	if (seen.has(workspaceDir)) return collected;
	seen.add(workspaceDir);

	const pkg = JSON.parse(
		await readFile(path.join(workspaceDir, "package.json"), "utf8"),
	);

	for (const dependencyName of workspaceDependencyNames(pkg)) {
		const dependencyWorkspace = workspaceByName.get(dependencyName);
		if (!dependencyWorkspace) continue;
		await collectWorkspaceTypeBuildDependencies(
			dependencyWorkspace.dir,
			workspaceByName,
			collected,
			seen,
		);
		if (dependencyWorkspace.isTypeScriptBuild) {
			collected.add(dependencyWorkspace.dir);
		}
	}

	return collected;
}

export async function workspaceTypeDependencyBuildDirs(workspaceDir) {
	await workspacePackagePath(workspaceDir);
	await assertTaskSmokeBuildOrderIntegrity("[workspace-script]");
	const workspaceByName = await loadWorkspacePackageMap();
	const collected = await collectWorkspaceTypeBuildDependencies(
		workspaceDir,
		workspaceByName,
	);
	const orderIndex = new Map(
		TASK_SMOKE_TS_BUILD_ORDER.map((entry, index) => [entry, index]),
	);
	for (const workspaceDependencyDir of collected) {
		if (!orderIndex.has(workspaceDependencyDir)) {
			throw new Error(
				`[workspace-script] build order missing "${workspaceDependencyDir}" required by "${workspaceDir}"`,
			);
		}
	}
	return [...collected].sort(
		(left, right) => orderIndex.get(left) - orderIndex.get(right),
	);
}

export async function ensureWorkspaceTypeDependencyBuilds(
	workspaceDir,
	env,
	loggerPrefix = "[workspace-script]",
) {
	const workspaceDirs = await workspaceTypeDependencyBuildDirs(workspaceDir);
	if (workspaceDirs.length === 0) {
		console.log(`${loggerPrefix} no TypeScript workspace dependencies to build.`);
		return;
	}
	console.log(
		`${loggerPrefix} building ${workspaceDirs.length} TypeScript workspace dependenc${workspaceDirs.length === 1 ? "y" : "ies"}...`,
	);
	for (const dependencyDir of workspaceDirs) {
		await runPackageScript(dependencyDir, "build", { env });
	}
}

export async function assertTaskSmokeBuildOrderIntegrity(
	loggerPrefix = "[task-smoke]",
) {
	const orderIndex = new Map();
	for (const [index, workspaceDir] of TASK_SMOKE_TS_BUILD_ORDER.entries()) {
		if (orderIndex.has(workspaceDir)) {
			throw new Error(
				`${loggerPrefix} duplicate workspace in build order: ${workspaceDir}`,
			);
		}
		orderIndex.set(workspaceDir, index);
		await workspacePackagePath(workspaceDir);
	}

	const workspaceByName = await loadWorkspacePackageMap();

	for (const workspaceDir of TASK_SMOKE_TS_BUILD_ORDER) {
		const pkg = JSON.parse(
			await readFile(path.join(workspaceDir, "package.json"), "utf8"),
		);
		const deps = {
			...(pkg.dependencies ?? {}),
			...(pkg.peerDependencies ?? {}),
			...(pkg.optionalDependencies ?? {}),
		};

		for (const dependencyName of Object.keys(deps)) {
			const dependencyWorkspace = workspaceByName.get(dependencyName);
			if (!dependencyWorkspace || !dependencyWorkspace.isTypeScriptBuild)
				continue;
			if (dependencyWorkspace.dir === workspaceDir) continue;

			const dependencyIndex = orderIndex.get(dependencyWorkspace.dir);
			const currentIndex = orderIndex.get(workspaceDir);
			if (dependencyIndex === undefined) {
				throw new Error(
					`${loggerPrefix} build order missing "${dependencyWorkspace.dir}" required by "${workspaceDir}" via "${dependencyName}"`,
				);
			}

			if (dependencyIndex > currentIndex) {
				throw new Error(
					`${loggerPrefix} build order is invalid: "${dependencyWorkspace.dir}" must run before "${workspaceDir}" (dependency "${dependencyName}")`,
				);
			}
		}
	}
}

async function resetTsBuildArtifacts(workspaceDir) {
	const distDir = path.join(workspaceDir, "dist");
	const tsBuildInfo = path.join(workspaceDir, "tsconfig.build.tsbuildinfo");
	await rm(distDir, { recursive: true, force: true });
	await rm(tsBuildInfo, { force: true });
}

async function hasBuildArtifact(workspaceDir) {
	try {
		await access(path.join(workspaceDir, "dist"));
		return true;
	} catch {
		return false;
	}
}

export async function ensureTaskSmokeTypeBuilds(
	env,
	loggerPrefix = "[task-smoke]",
	options = {},
) {
	await assertTaskSmokeBuildOrderIntegrity(loggerPrefix);
	const skipWorkspaces = new Set(options.skipWorkspaces ?? []);
	let built = 0;
	for (const workspaceDir of TASK_SMOKE_TS_BUILD_ORDER) {
		if (skipWorkspaces.has(workspaceDir)) continue;
		if (await hasBuildArtifact(workspaceDir)) continue;
		if (built === 0) {
			console.log(
				`${loggerPrefix} building missing TS dependency artifacts...`,
			);
		}
		built += 1;
		await resetTsBuildArtifacts(workspaceDir);
		await runPackageScript(workspaceDir, "build", { env });
	}
	if (built === 0) {
		console.log(`${loggerPrefix} TS dependency artifacts already present.`);
	}
}

export async function prepareTaskSmokeTypeBuilds(
	env,
	loggerPrefix = "[task-smoke]",
) {
	await assertTaskSmokeBuildOrderIntegrity(loggerPrefix);
	console.log(
		`${loggerPrefix} preparing deterministic TS dependency builds...`,
	);
	for (const workspaceDir of TASK_SMOKE_TS_BUILD_ORDER) {
		await resetTsBuildArtifacts(workspaceDir);
	}
	await ensureTaskSmokeTypeBuilds(env, loggerPrefix);
}

export function stripAnsi(input) {
	return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function parseJsonOutput(output) {
	const cleaned = stripAnsi(output).trim();
	if (!cleaned) {
		throw new Error("Command produced empty JSON output");
	}

	try {
		return JSON.parse(cleaned);
	} catch {
		const start = cleaned.indexOf("{");
		const end = cleaned.lastIndexOf("}");
		if (start >= 0 && end > start) {
			return JSON.parse(cleaned.slice(start, end + 1));
		}
		throw new Error(`Unable to parse JSON output:\n${cleaned}`);
	}
}

export function runSubprocess(command, commandArgs, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, commandArgs, {
			cwd: options.cwd,
			env: options.env,
			stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
		});

		let stdout = "";
		let stderr = "";
		if (options.captureOutput) {
			child.stdout.on("data", (chunk) => {
				stdout += chunk.toString();
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});
		}

		child.on("error", (error) => {
			error.command = command;
			error.args = commandArgs;
			error.stdout = stdout;
			error.stderr = stderr;
			reject(error);
		});
		child.on("exit", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}

			const details = options.captureOutput
				? `${stderr || stdout || "unknown error"}`
				: `${command} exited with code ${code}`;
			const error = new Error(details.trim());
			error.exitCode = code;
			error.command = command;
			error.args = commandArgs;
			error.stdout = stdout;
			error.stderr = stderr;
			reject(error);
		});
	});
}

export function runPackageScript(workspaceDir, script, options = {}) {
	const repoRoot = options.repoRoot ?? process.cwd();
	const packageCommand = createPackageScriptCommand({
		cwd: path.resolve(repoRoot, workspaceDir),
		repoRoot,
		script,
		env: options.env ?? process.env,
	});

	return runSubprocess(packageCommand.command, packageCommand.args, {
		...options,
		cwd: repoRoot,
	});
}
