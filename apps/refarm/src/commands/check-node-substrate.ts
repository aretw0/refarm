import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { DiagnosticRecommendation } from "./diagnostic-recommendations.js";

const NODE_SUBSTRATE_ENVIRONMENT_COMMAND =
	"Run validation inside the environment that owns this node_modules tree, or rebuild/reopen the devcontainer so node_modules is isolated per platform.";
const NODE_SUBSTRATE_INSTALL_COMMAND =
	"Run the package-manager install command for this environment, then retry `refarm check --next-action --json`.";
const NODE_SUBSTRATE_WORKSPACE_MATERIALIZATION_COMMAND =
	"Use an environment-owned checkout for this platform, or rebuild this checkout's node_modules from the environment that owns it.";
const NODE_SUBSTRATE_SOURCE_OWNERSHIP_COMMAND =
	"Use an environment-owned checkout or fix tracked source ownership for the current operator, then retry `refarm check --next-action --json`.";
const FALLBACK_PACKAGE_INSTALL_COMMAND = "pnpm install --frozen-lockfile";

export interface NodeSubstrateCheck {
	command: "node-substrate";
	operation: "check";
	ok: boolean;
	platform: NodeJS.Platform;
	missing: string[];
	foreignPlatformShims: Array<{
		binary: string;
		expected: string;
		found: string;
	}>;
	mountIssues: Array<{
		id: string;
		path: string;
		target: string;
	}>;
	workspaceLinkCount: number;
	missingWorkspaceDependencyLinkCount: number;
	missingWorkspaceDependencyLinks: Array<{
		id: string;
		ok: boolean;
		package: string;
		dependency: string;
		path: string;
	}>;
	missingRuntimeDependencyCount: number;
	runtimeChecks: Array<{
		id: string;
		ok: boolean;
		package: string;
		dependency: string;
		path: string;
	}>;
	missingRuntimeDependencies: Array<{
		id: string;
		ok: boolean;
		package: string;
		dependency: string;
		path: string;
	}>;
	sourceAccessIssueCount: number;
	sourceAccessIssues: Array<{
		path: string;
		reason: "broken-symlink" | "missing" | "not-writable";
		uid?: number;
		gid?: number;
		mode?: string;
	}>;
	recommendations: DiagnosticRecommendation[];
}

interface PackageManagerBinCheck {
	missing: string[];
	foreignPlatformShims: NodeSubstrateCheck["foreignPlatformShims"];
}

export interface NodeSubstrateCheckDeps {
	root: string;
	platform: NodeJS.Platform;
	checkPackageManagerBins(): Promise<PackageManagerBinCheck>;
	findMountIssues(): Promise<NodeSubstrateCheck["mountIssues"]>;
	findWorkspaceLinkChecks(): Promise<
		NodeSubstrateCheck["missingWorkspaceDependencyLinks"]
	>;
	findRuntimeChecks(): Promise<NodeSubstrateCheck["runtimeChecks"]>;
	findSourceAccessIssues(): Promise<NodeSubstrateCheck["sourceAccessIssues"]>;
	resolveInstallCommand(): Promise<string>;
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function expectedBinaryName(binary: string, platform: NodeJS.Platform): string {
	return platform === "win32" ? `${binary}.cmd` : binary;
}

function foreignBinaryName(binary: string, platform: NodeJS.Platform): string {
	return platform === "win32" ? binary : `${binary}.cmd`;
}

export async function runDefaultNodeSubstrate(): Promise<NodeSubstrateCheck> {
	const { packageFrozenInstallCommand } = await import("@refarm.dev/config");
	const root = process.cwd();
	const platform = os.platform();
	return runNodeSubstrateCheckWithDeps({
		root,
		platform,
		checkPackageManagerBins: () =>
			checkNodeSubstratePackageManagerBins(root, platform),
		findMountIssues: () => findNodeSubstrateMountIssues(root),
		findWorkspaceLinkChecks: () => findNodeSubstrateWorkspaceLinkChecks(root),
		findRuntimeChecks: () => findNodeSubstrateRuntimeChecks(root),
		findSourceAccessIssues: () => findNodeSubstrateSourceAccessIssues(root),
		resolveInstallCommand: async () =>
			packageFrozenInstallCommand({ cwd: root }).display,
	});
}

export async function runNodeSubstrateCheckWithDeps(
	deps: NodeSubstrateCheckDeps,
): Promise<NodeSubstrateCheck> {
	const [
		packageManagerBins,
		mountIssues,
		workspaceLinkChecks,
		runtimeChecks,
		sourceAccessIssues,
		installCommand,
	] = await Promise.all([
		deps.checkPackageManagerBins(),
		deps.findMountIssues(),
		deps.findWorkspaceLinkChecks(),
		deps.findRuntimeChecks(),
		deps.findSourceAccessIssues(),
		deps.resolveInstallCommand(),
	]);
	const { missing, foreignPlatformShims } = packageManagerBins;
	const missingWorkspaceDependencyLinks = workspaceLinkChecks.filter(
		(check) => !check.ok,
	);
	const missingRuntimeDependencies = runtimeChecks.filter((check) => !check.ok);
	const recommendations = buildNodeSubstrateRecommendations({
		missing,
		foreignPlatformShims,
		mountIssues,
		missingWorkspaceDependencyLinks,
		missingRuntimeDependencies,
		sourceAccessIssues,
		installCommand,
	});
	return {
		command: "node-substrate",
		operation: "check",
		ok: recommendations.length === 0,
		platform: deps.platform,
		missing,
		foreignPlatformShims,
		mountIssues,
		workspaceLinkCount: workspaceLinkChecks.length,
		missingWorkspaceDependencyLinkCount: missingWorkspaceDependencyLinks.length,
		missingWorkspaceDependencyLinks: compactNodeSubstrateDependencyIssues(
			missingWorkspaceDependencyLinks,
		),
		runtimeChecks,
		missingRuntimeDependencyCount: missingRuntimeDependencies.length,
		missingRuntimeDependencies: compactNodeSubstrateDependencyIssues(
			missingRuntimeDependencies,
		),
		sourceAccessIssueCount: sourceAccessIssues.length,
		sourceAccessIssues: sourceAccessIssues.slice(0, 20),
		recommendations,
	};
}

async function checkNodeSubstratePackageManagerBins(
	root: string,
	platform: NodeJS.Platform,
): Promise<PackageManagerBinCheck> {
	const missing: string[] = [];
	const foreignPlatformShims: NodeSubstrateCheck["foreignPlatformShims"] = [];
	for (const relativePath of [
		"node_modules",
		"path:node_modules/.bin",
		...["vitest", "tsc", "eslint"].map((binary) => `bin:${binary}`),
	]) {
		if (relativePath.startsWith("bin:")) {
			const binary = relativePath.slice("bin:".length);
			const expected = path.join(
				"node_modules",
				".bin",
				expectedBinaryName(binary, platform),
			);
			if (!(await exists(path.join(root, expected)))) {
				missing.push(expected);
				const found = path.join(
					"node_modules",
					".bin",
					foreignBinaryName(binary, platform),
				);
				if (await exists(path.join(root, found))) {
					foreignPlatformShims.push({ binary, expected, found });
				}
			}
			continue;
		}
		const relative = relativePath.startsWith("path:")
			? relativePath.slice("path:".length)
			: relativePath;
		if (!(await exists(path.join(root, relative)))) missing.push(relative);
	}
	return {
		missing,
		foreignPlatformShims,
	};
}

function compactNodeSubstrateDependencyIssues<T>(issues: T[]): T[] {
	return issues.slice(0, 20);
}

export function buildNodeSubstrateRecommendations(input: {
	missing: string[];
	foreignPlatformShims: NodeSubstrateCheck["foreignPlatformShims"];
	mountIssues: NodeSubstrateCheck["mountIssues"];
	missingWorkspaceDependencyLinks: NodeSubstrateCheck["missingWorkspaceDependencyLinks"];
	missingRuntimeDependencies: NodeSubstrateCheck["missingRuntimeDependencies"];
	sourceAccessIssues?: NodeSubstrateCheck["sourceAccessIssues"];
	installCommand?: string;
}): DiagnosticRecommendation[] {
	const installCommand =
		input.installCommand ?? FALLBACK_PACKAGE_INSTALL_COMMAND;
	const sourceAccessIssues = input.sourceAccessIssues ?? [];
	if (input.foreignPlatformShims.length > 0 || input.mountIssues.length > 0) {
		return [
			{
				diagnostic:
					input.mountIssues.length > 0
						? "node-substrate:shared-devcontainer-node-modules"
						: "node-substrate:foreign-platform-shims",
				severity: "failure",
				summary:
					input.mountIssues.length > 0
						? "The devcontainer contract expects node_modules to be a dedicated Docker volume, but this runtime is using the shared workspace mount."
						: "node_modules contains package-manager shims for a different platform.",
				action: NODE_SUBSTRATE_ENVIRONMENT_COMMAND,
				target: [
					...input.foreignPlatformShims.map(
						(shim) => `${shim.found} -> ${shim.expected}`,
					),
					...input.mountIssues.map(
						(issue) => `${issue.path} -> ${issue.target}`,
					),
				].join(", "),
			},
		];
	}
	if (sourceAccessIssues.length > 0) {
		return [
			{
				diagnostic: "node-substrate:source-inaccessible",
				severity: "failure",
				summary:
					"One or more tracked source files are not writable or do not resolve in this environment.",
				action: NODE_SUBSTRATE_SOURCE_OWNERSHIP_COMMAND,
				target: sourceAccessIssues
					.slice(0, 20)
					.map((issue) => `${issue.path} (${issue.reason})`)
					.join(", "),
			},
		];
	}
	if (input.missing.length > 0) {
		return [
			{
				diagnostic: "node-substrate:missing-package-manager-bins",
				severity: "failure",
				summary:
					"node_modules is missing package-manager execution shims required by Refarm checks.",
				action: NODE_SUBSTRATE_INSTALL_COMMAND,
				command: installCommand,
				target: input.missing.join(", "),
			},
		];
	}
	if (input.missingWorkspaceDependencyLinks.length > 0) {
		const massiveWindowsWorkspaceLinkFailure =
			os.platform() === "win32" &&
			input.missingWorkspaceDependencyLinks.length > 20;
		return [
			{
				diagnostic: "node-substrate:missing-workspace-dependency-links",
				severity: "failure",
				summary: massiveWindowsWorkspaceLinkFailure
					? "Many workspace package links are not materialized for this Windows environment; this usually means the checkout's package links belong to another platform."
					: "One or more workspace package links are not materialized for this environment.",
				action: massiveWindowsWorkspaceLinkFailure
					? NODE_SUBSTRATE_WORKSPACE_MATERIALIZATION_COMMAND
					: NODE_SUBSTRATE_INSTALL_COMMAND,
				command: massiveWindowsWorkspaceLinkFailure
					? undefined
					: installCommand,
				target: input.missingWorkspaceDependencyLinks
					.slice(0, 20)
					.map(
						(dependency) => `${dependency.package} -> ${dependency.dependency}`,
					)
					.join(", "),
			},
		];
	}
	if (input.missingRuntimeDependencies.length > 0) {
		return [
			{
				diagnostic: "node-substrate:missing-runtime-dependencies",
				severity: "failure",
				summary:
					"One or more workspace CLI packages cannot resolve declared external runtime dependencies from this environment.",
				action: NODE_SUBSTRATE_INSTALL_COMMAND,
				command: installCommand,
				target: input.missingRuntimeDependencies
					.map(
						(dependency) => `${dependency.package} -> ${dependency.dependency}`,
					)
					.join(", "),
			},
		];
	}
	return [];
}

async function findNodeSubstrateWorkspaceLinkChecks(
	root: string,
): Promise<NodeSubstrateCheck["missingWorkspaceDependencyLinks"]> {
	const checks: NodeSubstrateCheck["missingWorkspaceDependencyLinks"] = [];
	for await (const workspacePackage of readWorkspacePackageManifests(root)) {
		for (const dependencies of [
			workspacePackage.manifest.dependencies ?? {},
			workspacePackage.manifest.devDependencies ?? {},
		]) {
			for (const [dependency, version] of Object.entries(dependencies).sort()) {
				if (!version.startsWith("workspace:")) continue;
				const dependencyPackageJson = path.join(
					workspacePackage.packageDir,
					"node_modules",
					dependency,
					"package.json",
				);
				checks.push({
					id: `workspace_dep_${workspacePackage.packageName}_${dependency}`,
					ok: await exists(dependencyPackageJson),
					package: workspacePackage.packageName,
					dependency,
					path: workspacePackage.relativePackageDir,
				});
			}
		}
	}
	return checks;
}

async function findNodeSubstrateSourceAccessIssues(
	root: string,
): Promise<NodeSubstrateCheck["sourceAccessIssues"]> {
	const trackedFiles = await readGitTrackedFiles(root);
	return findSourceAccessIssuesForPaths(root, trackedFiles);
}

interface SourceAccessStat {
	uid: number;
	gid: number;
	mode: number;
	isSymbolicLink(): boolean;
	isFile(): boolean;
}

interface SourceAccessFileSystem {
	lstat(path: string): Promise<SourceAccessStat>;
	stat(path: string): Promise<unknown>;
	access(path: string, mode?: number): Promise<void>;
}

export async function findSourceAccessIssuesForPaths(
	root: string,
	trackedFiles: string[],
	options: {
		concurrency?: number;
		fs?: SourceAccessFileSystem;
		limit?: number;
	} = {},
): Promise<NodeSubstrateCheck["sourceAccessIssues"]> {
	const fsApi = options.fs ?? fs;
	const concurrency = Math.max(1, Math.floor(options.concurrency ?? 32));
	const limit = Math.max(1, Math.floor(options.limit ?? 200));
	const candidates = trackedFiles.filter(isSourceOwnershipCandidate);
	const issues: NodeSubstrateCheck["sourceAccessIssues"] = [];

	let nextIndex = 0;
	async function worker(): Promise<void> {
		while (issues.length < limit) {
			const index = nextIndex;
			nextIndex += 1;
			const relativePath = candidates[index];
			if (!relativePath) return;
			const issue = await findSourceAccessIssue(root, relativePath, fsApi);
			if (issue) issues.push(issue);
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.min(concurrency, candidates.length) },
			() => worker(),
		),
	);
	return issues.slice(0, limit);
}

async function findSourceAccessIssue(
	root: string,
	relativePath: string,
	fsApi: SourceAccessFileSystem,
): Promise<NodeSubstrateCheck["sourceAccessIssues"][number] | null> {
		const absolutePath = path.join(root, relativePath);
		try {
			const lstat = await fsApi.lstat(absolutePath);
			if (lstat.isSymbolicLink()) {
				try {
					await fsApi.stat(absolutePath);
				} catch {
					return {
						path: relativePath,
						reason: "broken-symlink",
						uid: lstat.uid,
						gid: lstat.gid,
						mode: (lstat.mode & 0o777).toString(8).padStart(3, "0"),
					};
				}
			} else if (!lstat.isFile()) {
				return null;
			}
			await fsApi.access(absolutePath, fsConstants.W_OK);
		} catch {
			try {
				const stat = await fsApi.lstat(absolutePath);
				return {
					path: relativePath,
					reason: "not-writable",
					uid: stat.uid,
					gid: stat.gid,
					mode: (stat.mode & 0o777).toString(8).padStart(3, "0"),
				};
			} catch {
				return { path: relativePath, reason: "missing" };
			}
		}
	return null;
}

function isSourceOwnershipCandidate(relativePath: string): boolean {
	return (
		!relativePath.startsWith(".git/") &&
		!relativePath.includes("/node_modules/") &&
		!relativePath.startsWith("node_modules/") &&
		!relativePath.includes("/dist/") &&
		!relativePath.startsWith("dist/") &&
		!relativePath.includes("/build/") &&
		!relativePath.startsWith("build/") &&
		!relativePath.includes("/.turbo/") &&
		!relativePath.startsWith(".turbo/")
	);
}

async function readGitTrackedFiles(root: string): Promise<string[]> {
	try {
		const { runProcessHandoff } = await import("@refarm.dev/cli/process-handoff");
		const { stdout } = await runProcessHandoff(
			{
				command: "git",
				args: ["ls-files", "-z"],
				display: "git ls-files -z",
				cwd: root,
			},
			{ capture: true },
		);
		return (stdout ?? "")
			.split("\0")
			.map((file: string) => file.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

async function findNodeSubstrateRuntimeChecks(
	root: string,
): Promise<NodeSubstrateCheck["runtimeChecks"]> {
	const checks: NodeSubstrateCheck["runtimeChecks"] = [];
	for await (const workspacePackage of readWorkspacePackageManifests(root)) {
		if (
			!workspacePackage.manifest.bin ||
			!workspacePackage.manifest.dependencies
		)
			continue;
		const requireFromPackage = createRequire(workspacePackage.manifestPath);
		for (const [dependency, version] of Object.entries(
			workspacePackage.manifest.dependencies,
		).sort()) {
			if (version.startsWith("workspace:")) continue;
			try {
				requireFromPackage.resolve(dependency);
				checks.push({
					id: `runtime_dep_${workspacePackage.packageName}_${dependency}`,
					ok: true,
					package: workspacePackage.packageName,
					dependency,
					path: workspacePackage.relativePackageDir,
				});
			} catch {
				checks.push({
					id: `runtime_dep_${workspacePackage.packageName}_${dependency}`,
					ok: false,
					package: workspacePackage.packageName,
					dependency,
					path: workspacePackage.relativePackageDir,
				});
			}
		}
	}
	return checks;
}

async function* readWorkspacePackageManifests(root: string): AsyncGenerator<{
	packageDir: string;
	manifestPath: string;
	relativePackageDir: string;
	packageName: string;
	manifest: {
		name?: string;
		bin?: unknown;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
}> {
	for (const workspaceGroup of ["apps", "packages"]) {
		const groupPath = path.join(root, workspaceGroup);
		let entries: Array<{ name: string; isDirectory(): boolean }>;
		try {
			entries = await fs.readdir(groupPath, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const packageDir = path.join(groupPath, entry.name);
			const manifestPath = path.join(packageDir, "package.json");
			let manifest: {
				name?: string;
				bin?: unknown;
				dependencies?: Record<string, string>;
			};
			try {
				manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
			} catch {
				continue;
			}
			const relativePackageDir = path.relative(root, packageDir);
			yield {
				packageDir,
				manifestPath,
				relativePackageDir,
				packageName: manifest.name ?? relativePackageDir,
				manifest,
			};
		}
	}
}

async function findNodeSubstrateMountIssues(
	root: string,
): Promise<NodeSubstrateCheck["mountIssues"]> {
	const target = await readDevcontainerNodeModulesTarget(root);
	if (!target) return [];
	const mountPoints = await readLinuxMountPoints();
	if (mountPoints.length === 0) return [];
	if (mountPoints.includes(target)) return [];
	return [
		{
			id: "devcontainer_node_modules_mount",
			path: "node_modules",
			target,
		},
	];
}

async function readDevcontainerNodeModulesTarget(
	root: string,
): Promise<string | null> {
	try {
		const raw = await fs.readFile(
			path.join(root, ".devcontainer", "devcontainer.json"),
			"utf8",
		);
		const config = JSON.parse(raw) as { mounts?: unknown };
		if (!Array.isArray(config.mounts)) return null;
		for (const mount of config.mounts) {
			if (typeof mount !== "string") continue;
			const fields = Object.fromEntries(
				mount.split(",").map((field) => {
					const index = field.indexOf("=");
					if (index === -1) return [field.trim(), ""];
					return [field.slice(0, index).trim(), field.slice(index + 1).trim()];
				}),
			);
			if (fields.source !== "refarm-node-modules") continue;
			if (typeof fields.target !== "string" || fields.target.length === 0)
				continue;
			const target = path.resolve(fields.target);
			if (target === path.resolve(root, "node_modules")) return target;
		}
	} catch {
		return null;
	}
	return null;
}

async function readLinuxMountPoints(): Promise<string[]> {
	if (process.platform !== "linux") return [];
	const content = await fs.readFile("/proc/self/mountinfo", "utf8");
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split(" - ")[0]?.split(" ")[4])
		.filter((mountPoint): mountPoint is string => Boolean(mountPoint))
		.map(decodeMountInfoPath)
		.map((mountPoint) => path.resolve(mountPoint));
}

function decodeMountInfoPath(value: string): string {
	return value.replace(/\\([0-7]{3})/g, (_, octal: string) =>
		String.fromCharCode(Number.parseInt(octal, 8)),
	);
}
