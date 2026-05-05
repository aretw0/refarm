import { spawn } from "node:child_process";
import { access, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const TASK_SMOKE_TS_BUILD_ORDER = [
	"packages/effort-contract-v1",
	"packages/identity-contract-v1",
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
	"packages/sower",
	"packages/health",
	"packages/runtime",
	"packages/trust",
	"packages/sync-loro",
	"packages/ds",
	"packages/homestead",
	"packages/cli",
	"apps/farmhand",
	"apps/refarm",
];

const TASK_SMOKE_WORKSPACE_ROOTS = ["packages", "apps"];

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
			const workspaceDir = path.join(rootDir, entry.name);
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
		await runSubprocess("npm", ["--prefix", workspaceDir, "run", "build"], {
			env,
		});
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

		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}

			const details = options.captureOutput
				? `${stderr || stdout || "unknown error"}`
				: `${command} exited with code ${code}`;
			reject(new Error(details.trim()));
		});
	});
}
