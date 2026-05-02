import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const TASK_SMOKE_TS_BUILD_ORDER = [
	"packages/effort-contract-v1",
	"packages/identity-contract-v1",
	"packages/storage-contract-v1",
	"packages/sync-contract-v1",
	"packages/storage-sqlite",
	"packages/registry",
	"packages/silo",
	"packages/windmill",
	"packages/sower",
	"packages/health",
	"packages/runtime",
	"packages/trust",
	"packages/ds",
	"packages/homestead",
	"packages/cli",
	"packages/sync-loro",
	"packages/tractor-ts",
	"apps/farmhand",
	"apps/refarm",
];

async function resetTsBuildArtifacts(workspaceDir) {
	const distDir = path.join(workspaceDir, "dist");
	const tsBuildInfo = path.join(workspaceDir, "tsconfig.build.tsbuildinfo");
	await rm(distDir, { recursive: true, force: true });
	await rm(tsBuildInfo, { force: true });
}

export async function prepareTaskSmokeTypeBuilds(
	env,
	loggerPrefix = "[task-smoke]",
) {
	console.log(
		`${loggerPrefix} preparing deterministic TS dependency builds...`,
	);
	for (const workspaceDir of TASK_SMOKE_TS_BUILD_ORDER) {
		await resetTsBuildArtifacts(workspaceDir);
		await runSubprocess("npm", ["--prefix", workspaceDir, "run", "build"], {
			env,
		});
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
