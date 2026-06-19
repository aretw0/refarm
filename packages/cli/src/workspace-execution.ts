import fs from "node:fs";
import path from "node:path";

export type WorkspaceExecutionPackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface WorkspaceExecutionStatus {
	root: string;
	rootSource: "turbo" | "pnpm-workspace" | "package-json" | "cwd";
	executor: {
		selected: "turbo" | "direct-script";
		reason: string;
	};
	adapters: {
		directScript: {
			available: true;
		};
		turbo: {
			available: boolean;
			configured: boolean;
			declared: boolean;
			configPath: string | null;
			installCommand: string | null;
		};
	};
	cache: {
		local: {
			available: boolean;
			path: string | null;
		};
		remote: {
			configured: boolean;
			apiUrlEnv: "TURBO_CACHE_API_URL";
			tokenEnv: "TURBO_CACHE_TOKEN";
		};
	};
}

export function buildWorkspaceExecutionStatus(options: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	packageManager?: WorkspaceExecutionPackageManager;
} = {}): WorkspaceExecutionStatus {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const rootResolution = findWorkspaceExecutionRoot(cwd);
	const root = rootResolution.root;
	const packageManager = options.packageManager ?? detectWorkspacePackageManager(root);
	const turboConfigPath = path.join(root, "turbo.json");
	const turboConfigured = fs.existsSync(turboConfigPath);
	const turboDeclared = workspaceDeclaresDependency(root, "turbo");
	const turboAvailable = turboConfigured && turboDeclared;
	const localCachePath = turboConfigured ? path.join(root, ".turbo", "cache") : null;
	const remoteConfigured = Boolean(env.TURBO_CACHE_API_URL && env.TURBO_CACHE_TOKEN);
	return {
		root,
		rootSource: rootResolution.source,
		executor: turboAvailable
			? {
					selected: "turbo",
					reason: "Workspace declares turbo and has turbo.json; cache-aware validation can use the Turbo adapter.",
				}
			: {
					selected: "direct-script",
					reason: turboConfigured
						? "Workspace has turbo.json but does not declare turbo; use package scripts until the adapter is provisioned."
						: "No supported build graph adapter detected; use package scripts.",
				},
		adapters: {
			directScript: {
				available: true,
			},
			turbo: {
				available: turboAvailable,
				configured: turboConfigured,
				declared: turboDeclared,
				configPath: turboConfigured ? turboConfigPath : null,
				installCommand: turboConfigured && !turboDeclared
					? packageManagerInstallDevCommand(packageManager, "turbo")
					: null,
			},
		},
		cache: {
			local: {
				available: Boolean(localCachePath && fs.existsSync(localCachePath)),
				path: localCachePath,
			},
			remote: {
				configured: remoteConfigured,
				apiUrlEnv: "TURBO_CACHE_API_URL",
				tokenEnv: "TURBO_CACHE_TOKEN",
			},
		},
	};
}

export function workspaceCanUseTurboAdapter(cwd = process.cwd()): boolean {
	return buildWorkspaceExecutionStatus({ cwd }).adapters.turbo.available;
}

function findWorkspaceExecutionRoot(cwd: string): {
	root: string;
	source: WorkspaceExecutionStatus["rootSource"];
} {
	let current = path.resolve(cwd);
	let packageJsonFallback: string | null = null;
	while (true) {
		if (fs.existsSync(path.join(current, "turbo.json"))) {
			return { root: current, source: "turbo" };
		}
		if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
			return { root: current, source: "pnpm-workspace" };
		}
		if (!packageJsonFallback && fs.existsSync(path.join(current, "package.json"))) {
			packageJsonFallback = current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return packageJsonFallback
				? { root: packageJsonFallback, source: "package-json" }
				: { root: path.resolve(cwd), source: "cwd" };
		}
		current = parent;
	}
}

function workspaceDeclaresDependency(root: string, dependencyName: string): boolean {
	const packageJsonPath = path.join(root, "package.json");
	if (!fs.existsSync(packageJsonPath)) return false;
	try {
		const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
			dependencies?: unknown;
			devDependencies?: unknown;
		};
		return Boolean(
			recordHasDependency(parsed.dependencies, dependencyName) ||
				recordHasDependency(parsed.devDependencies, dependencyName),
		);
	} catch {
		return false;
	}
}

function recordHasDependency(value: unknown, dependencyName: string): boolean {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.prototype.hasOwnProperty.call(value, dependencyName)
	);
}

function detectWorkspacePackageManager(root: string): WorkspaceExecutionPackageManager {
	const packageJsonPath = path.join(root, "package.json");
	if (fs.existsSync(packageJsonPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
				packageManager?: unknown;
			};
			const declared = parseWorkspacePackageManager(parsed.packageManager);
			if (declared) return declared;
		} catch {
			// Fall back to lockfile discovery.
		}
	}
	if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
	if (fs.existsSync(path.join(root, "bun.lock")) || fs.existsSync(path.join(root, "bun.lockb"))) {
		return "bun";
	}
	if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
	return "npm";
}

function parseWorkspacePackageManager(value: unknown): WorkspaceExecutionPackageManager | null {
	if (typeof value !== "string") return null;
	const name = value.trim().split("@")[0]?.trim();
	if (name === "pnpm" || name === "npm" || name === "yarn" || name === "bun") return name;
	return null;
}

function packageManagerInstallDevCommand(
	packageManager: WorkspaceExecutionPackageManager,
	dependencyName: string,
): string {
	if (packageManager === "pnpm") return `pnpm add -D -w ${dependencyName}`;
	if (packageManager === "yarn") return `yarn add -D -W ${dependencyName}`;
	if (packageManager === "bun") return `bun add -d ${dependencyName}`;
	return `npm install --save-dev ${dependencyName}`;
}
