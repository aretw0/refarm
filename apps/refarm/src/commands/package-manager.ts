import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LaunchProcessSpec } from "./launch-process.js";

export type PackageManagerName = "pnpm" | "npm" | "yarn" | "bun";

const PACKAGE_MANAGERS: readonly PackageManagerName[] = [
	"pnpm",
	"npm",
	"yarn",
	"bun",
];

export interface PackageScriptCommandOptions {
	cwd: string;
	script: string;
	repoRoot?: string;
	env?: NodeJS.ProcessEnv;
}

function parsePackageManager(value: string | undefined): PackageManagerName | null {
	const raw = value?.trim();
	if (!raw) return null;
	const name = raw.split("@")[0]?.trim();
	return PACKAGE_MANAGERS.includes(name as PackageManagerName)
		? (name as PackageManagerName)
		: null;
}

function detectPackageManagerFromPackageJson(startDir: string): PackageManagerName | null {
	let current = path.resolve(startDir);
	while (true) {
		const candidate = path.join(current, "package.json");
		if (existsSync(candidate)) {
			try {
				const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
					packageManager?: unknown;
				};
				const detected = parsePackageManager(
					typeof pkg.packageManager === "string" ? pkg.packageManager : undefined,
				);
				if (detected) return detected;
			} catch {
				// Continue searching parents when local package metadata is unreadable.
			}
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function detectPackageManager(options: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
} = {}): PackageManagerName {
	const env = options.env ?? process.env;
	const override = parsePackageManager(env.REFARM_PACKAGE_MANAGER);
	if (override) return override;

	const detected = detectPackageManagerFromPackageJson(options.cwd ?? process.cwd());
	if (detected) return detected;

	return "npm";
}

function relativeCwd(cwd: string, repoRoot: string | undefined): string {
	if (!path.isAbsolute(cwd)) return cwd;
	const relative = repoRoot ? path.relative(repoRoot, cwd) : path.relative(process.cwd(), cwd);
	return relative && !relative.startsWith("..") ? relative : cwd;
}

export function createPackageScriptCommand(
	options: PackageScriptCommandOptions,
): LaunchProcessSpec {
	const packageManager = detectPackageManager({
		cwd: options.repoRoot ?? options.cwd,
		env: options.env,
	});
	const cwd = relativeCwd(options.cwd, options.repoRoot);

	switch (packageManager) {
		case "pnpm":
			return {
				command: "pnpm",
				args: ["-C", cwd, "run", options.script],
				display: `pnpm -C ${cwd} run ${options.script}`,
			};
		case "npm":
			return {
				command: "npm",
				args: ["--prefix", cwd, "run", options.script],
				display: `npm --prefix ${cwd} run ${options.script}`,
			};
		case "yarn":
			return {
				command: "yarn",
				args: ["--cwd", cwd, "run", options.script],
				display: `yarn --cwd ${cwd} run ${options.script}`,
			};
		case "bun":
			return {
				command: "bun",
				args: ["--cwd", cwd, "run", options.script],
				display: `bun --cwd ${cwd} run ${options.script}`,
			};
	}
}
