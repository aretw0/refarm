import {
	runRustSubstrateCheck,
	type RustSubstrateCheck,
} from "@refarm.dev/cli/rust-substrate";
import {
	declaredWorkspacesFromConfig,
	loadConfig,
	packageFrozenInstallCommand,
} from "@refarm.dev/config";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import {
	buildRefarmDoctorReport,
	type RefarmDoctorReport,
} from "./doctor.js";
import { runHealthAudit, type HealthReport } from "./health.js";
import { printJson } from "./json-output.js";
import {
	buildModelDoctorStatus,
	defaultModelDeps,
	type ModelDoctorStatus,
} from "./model.js";
import { resolveStatusPayload } from "./status.js";
import {
	buildWorkspaceExecutionStatus,
	type WorkspaceExecutionStatus,
} from "./workspace-execution.js";
import {
	buildWorkspaceExecutionSweepPayload,
	observeDeclaredWorkspacesExecution,
	type WorkspaceExecutionObservation,
	type WorkspaceExecutionRecommendation,
	type WorkspaceExecutionSummary,
	type WorkspaceExecutionSweepPayload,
} from "./workspace.js";

export type { RustSubstrateCheck } from "@refarm.dev/cli/rust-substrate";

const NODE_SUBSTRATE_ENVIRONMENT_COMMAND = "Run validation inside the environment that owns this node_modules tree, or rebuild/reopen the devcontainer so node_modules is isolated per platform.";
const NODE_SUBSTRATE_INSTALL_COMMAND = "Run the package-manager install command for this environment, then retry `refarm check --next-action --json`.";
const NODE_SUBSTRATE_WORKSPACE_MATERIALIZATION_COMMAND = "Use an environment-owned checkout for this platform, or rebuild this checkout's node_modules from the environment that owns it.";

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
	recommendations: DiagnosticRecommendation[];
}

export interface RefarmCheckReport {
	command: "check";
	operation: "readiness";
	ok: boolean;
	failureCount: number;
	warningCount: number;
	checks: {
		health: HealthReport;
		doctor: RefarmDoctorReport;
		model?: ModelDoctorStatus;
		nodeSubstrate?: NodeSubstrateCheck;
		rustSubstrate?: RustSubstrateCheck;
		workspaceExecution?: WorkspaceExecutionStatus;
		workspaceSweep?: WorkspaceSweepCheck;
		releasePolicy?: ReleasePolicyCheck;
	};
	recommendations: DiagnosticRecommendation[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface RefarmCheckNextActionJson {
	ok: boolean;
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface RefarmCheckOptions {
	json?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
	failOnWarnings?: boolean;
}

export interface RefarmCheckDeps {
	runHealth(): Promise<HealthReport>;
	runDoctor(options: { failOnWarnings?: boolean }): Promise<RefarmDoctorReport>;
	runModelDoctor?(): Promise<ModelDoctorStatus>;
	runNodeSubstrate?(): Promise<NodeSubstrateCheck>;
	runRustSubstrate?(): Promise<RustSubstrateCheck>;
	runWorkspaceExecution?(): Promise<WorkspaceExecutionStatus>;
	runWorkspaceSweep?(): Promise<WorkspaceSweepCheck>;
	runReleasePolicy?(): Promise<ReleasePolicyCheck>;
}

export interface WorkspaceSweepCheck {
	command: "workspace";
	operation: "execution";
	ok: boolean;
	mode: WorkspaceExecutionSweepPayload["mode"];
	summary: WorkspaceExecutionSummary;
	recommendations: WorkspaceExecutionRecommendation[];
	observations: WorkspaceExecutionObservation[];
}

export interface ReleasePolicyCheck {
	command: "release";
	operation: "plan";
	ok: boolean;
	status: string;
	packageCount: number;
	packages: string[];
	profileTags: string[];
	packageProfiles: unknown[];
	blockers: unknown[];
	recommendedCommand: string;
}

export function buildRefarmCheckReport(checks: {
	health: HealthReport;
	doctor: RefarmDoctorReport;
	model?: ModelDoctorStatus;
	nodeSubstrate?: NodeSubstrateCheck;
	rustSubstrate?: RustSubstrateCheck;
	workspaceExecution?: WorkspaceExecutionStatus;
	workspaceSweep?: WorkspaceSweepCheck;
	releasePolicy?: ReleasePolicyCheck;
}): RefarmCheckReport {
	const recommendations: DiagnosticRecommendation[] = [
		...(checks.nodeSubstrate?.recommendations ?? []),
		...(checks.rustSubstrate?.recommendations ?? []),
		...workspaceExecutionCheckRecommendations(checks.workspaceExecution),
		...workspaceSweepCheckRecommendations(checks.workspaceSweep),
		...releasePolicyCheckRecommendations(checks.releasePolicy),
		...checks.health.recommendations,
		...checks.doctor.recommendations,
		...modelDoctorCheckRecommendations(checks.model),
	];
	const blockingRecommendations = recommendations.filter(isBlockingRecommendation);
	const failureCount =
		(checks.nodeSubstrate?.ok === false ? 1 : 0) +
		(checks.rustSubstrate?.ok === false ? 1 : 0) +
		(checks.health.ok ? 0 : checks.health.issueCount) +
		checks.doctor.failureCount;

	const nextActions = diagnosticNextActions(blockingRecommendations);
	const nextCommands = diagnosticNextCommands(blockingRecommendations);
	return {
		command: "check",
		operation: "readiness",
		ok: (checks.nodeSubstrate?.ok ?? true) &&
			(checks.rustSubstrate?.ok ?? true) &&
			checks.health.ok &&
			checks.doctor.ok,
		failureCount,
		warningCount:
			checks.doctor.warningCount +
			workspaceExecutionCheckRecommendations(checks.workspaceExecution).filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			workspaceSweepCheckRecommendations(checks.workspaceSweep).filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			modelDoctorCheckRecommendations(checks.model).length,
		checks,
		recommendations,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

function releasePolicyCheckRecommendations(
	releasePolicy: ReleasePolicyCheck | undefined,
): DiagnosticRecommendation[] {
	if (!releasePolicy) return [];
	return [
		{
			diagnostic: "release-policy:kernel-candidates",
			severity: "info",
			summary: `Release policy currently selects ${releasePolicy.packageCount} kernel candidate package${releasePolicy.packageCount === 1 ? "" : "s"}.`,
			action: "Inspect the release plan before preparing npm or crates publication.",
			command: releasePolicy.recommendedCommand,
		},
	];
}

function workspaceSweepCheckRecommendations(
	sweep: WorkspaceSweepCheck | undefined,
): DiagnosticRecommendation[] {
	if (!sweep) return [];
	return sweep.recommendations.map((recommendation) => ({
		diagnostic: `workspace-sweep:${recommendation.code}`,
		severity: recommendation.code === "workspace-path-missing" ? "warning" : "info",
		summary: recommendation.message,
		action: workspaceSweepRecommendationAction(recommendation),
		command: recommendation.nextCommand,
		target: recommendation.workspaceId,
	}));
}

function workspaceSweepRecommendationAction(
	recommendation: WorkspaceExecutionRecommendation,
): string {
	if (recommendation.code === "workspace-path-missing") {
		return recommendation.mountHints?.[0] ?? "Make the declared workspace path visible to this runtime, or update its bridge configuration.";
	}
	if (recommendation.code === "turbo-install-needed") {
		return "Declare Turbo in the target workspace so Refarm can use cache-aware validation.";
	}
	return "Provision or configure the declared remote cache for this workspace.";
}

function workspaceExecutionCheckRecommendations(
	execution: WorkspaceExecutionStatus | undefined,
): DiagnosticRecommendation[] {
	if (!execution) return [];
	const recommendations: DiagnosticRecommendation[] = [];
	const turbo = execution.adapters.turbo;
	if (turbo.configured && !turbo.declared && turbo.installCommand) {
		recommendations.push({
			diagnostic: "workspace-execution:turbo-adapter-unprovisioned",
			severity: "warning",
			summary: "Workspace has turbo.json, but the Turbo adapter is not declared in package.json.",
			action: "Declare Turbo in the workspace so Refarm can use cache-aware validation, or remove turbo.json if direct package scripts are intentional.",
			command: turbo.installCommand,
			target: execution.root,
		});
	}
	if (turbo.available && !execution.cache.remote.configured) {
		recommendations.push({
			diagnostic: "workspace-execution:remote-cache-not-configured",
			severity: "info",
			summary: "Workspace validation can use the local Turbo cache, but no remote cache credentials are configured.",
			action: "Provision or configure a remote cache when validation should get hits across machines and containers.",
			command: execution.cache.remote.provisionCommand,
			target: execution.root,
		});
	}
	return recommendations;
}

function modelDoctorCheckRecommendations(
	model: ModelDoctorStatus | undefined,
): DiagnosticRecommendation[] {
	return (model?.recommendations ?? []).map((recommendation) => ({
		...recommendation,
		severity: "warning",
	}));
}

function isBlockingRecommendation(recommendation: DiagnosticRecommendation): boolean {
	return recommendation.severity !== "warning" && recommendation.severity !== "info";
}

function printRefarmCheckSummary(report: RefarmCheckReport): void {
	console.log(chalk.bold(`Check: ${report.ok ? "PASS" : "FAIL"}`));
	if (report.checks.nodeSubstrate) {
		console.log(
			`Node substrate: ${report.checks.nodeSubstrate.ok ? "pass" : "fail"} (${report.checks.nodeSubstrate.missing.length} missing, ${report.checks.nodeSubstrate.foreignPlatformShims.length} foreign shims, ${report.checks.nodeSubstrate.mountIssues.length} mount issues, ${report.checks.nodeSubstrate.missingWorkspaceDependencyLinks.length} workspace links, ${report.checks.nodeSubstrate.missingRuntimeDependencies.length} runtime deps)`,
		);
	}
	if (report.checks.rustSubstrate?.required) {
		console.log(
			`Rust substrate: ${report.checks.rustSubstrate.ok ? "pass" : "fail"} (${report.checks.rustSubstrate.missing.length} missing)`,
		);
	}
	if (report.checks.workspaceExecution) {
		console.log(
			`Workspace execution: ${report.checks.workspaceExecution.executor.selected} (local cache ${report.checks.workspaceExecution.cache.local.available ? "available" : "not found"}, remote cache ${report.checks.workspaceExecution.cache.remote.configured ? "configured" : "not configured"})`,
		);
	}
	if (report.checks.workspaceSweep) {
		console.log(
			`Workspace sweep: ${report.checks.workspaceSweep.summary.ok}/${report.checks.workspaceSweep.summary.total} ready (${report.checks.workspaceSweep.summary.missingPath} missing path${report.checks.workspaceSweep.summary.missingPath === 1 ? "" : "s"}, ${report.checks.workspaceSweep.summary.remoteCacheUnconfigured} remote cache pending)`,
		);
	}
	if (report.checks.releasePolicy) {
		console.log(
			`Release policy: ${report.checks.releasePolicy.packageCount} kernel candidate${report.checks.releasePolicy.packageCount === 1 ? "" : "s"} (${report.checks.releasePolicy.profileTags.join(" + ")})`,
		);
	}
	console.log(
		`Health: ${report.checks.health.ok ? "pass" : "fail"} (${report.checks.health.issueCount} issue${report.checks.health.issueCount === 1 ? "" : "s"})`,
	);
	console.log(
		`Doctor: ${report.checks.doctor.ok ? "pass" : "fail"} (${report.checks.doctor.failureCount} failure${report.checks.doctor.failureCount === 1 ? "" : "s"}, ${report.checks.doctor.warningCount} warning${report.checks.doctor.warningCount === 1 ? "" : "s"})`,
	);
	if (report.checks.model) {
		const modelWarnings = modelDoctorCheckRecommendations(report.checks.model).length;
		console.log(
			`Model: ${modelWarnings === 0 ? "pass" : "warn"} (${modelWarnings} warning${modelWarnings === 1 ? "" : "s"})`,
		);
	}

	const actionable = report.recommendations.filter(
		(recommendation) => recommendation.severity !== "info",
	);
	if (actionable.length > 0) {
		console.log(chalk.bold("\nRecommendations"));
		for (const recommendation of actionable) {
			const target = recommendation.target ? ` (${recommendation.target})` : "";
			console.log(
				chalk.gray(
					`  - ${recommendation.diagnostic}${target}: ${recommendation.summary}`,
				),
			);
			console.log(chalk.gray(`    ${recommendation.action}`));
		}
	}
}

function printRefarmCheckNextActionJson(report: RefarmCheckReport): void {
	const output: RefarmCheckNextActionJson = buildDiagnosticNextActionPayload({
		ok: report.ok,
		nextActions: report.nextActions,
		nextCommands: report.nextCommands,
		recommendations: compactActionableRecommendations(report.recommendations),
	});
	printJson(output);
}

function compactActionableRecommendations(
	recommendations: DiagnosticRecommendation[],
): DiagnosticRecommendation[] {
	const seen = new Set<string>();
	const compact: DiagnosticRecommendation[] = [];
	for (const recommendation of recommendations) {
		if (!isBlockingRecommendation(recommendation)) continue;
		const key = `${recommendation.action}\n${recommendation.command ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		compact.push(recommendation);
	}
	return compact;
}

async function runDefaultDoctor(options: {
	failOnWarnings?: boolean;
}): Promise<RefarmDoctorReport> {
	const statusPayload = await resolveStatusPayload({ renderer: "headless" });
	try {
		return buildRefarmDoctorReport(statusPayload.json, {
			failOnWarnings: options.failOnWarnings,
		});
	} finally {
		await statusPayload.shutdown?.();
	}
}

async function runDefaultModelDoctor(): Promise<ModelDoctorStatus> {
	const deps = defaultModelDeps();
	const tokens = await deps.loadTokens();
	return buildModelDoctorStatus(tokens);
}

async function runDefaultWorkspaceExecution(): Promise<WorkspaceExecutionStatus> {
	return buildWorkspaceExecutionStatus();
}

async function runDefaultWorkspaceSweep(): Promise<WorkspaceSweepCheck> {
	const config = loadConfig(process.cwd());
	const observations = observeDeclaredWorkspacesExecution(
		declaredWorkspacesFromConfig(config, { baseDir: process.cwd() }),
		undefined,
	);
	return {
		command: "workspace",
		operation: "execution",
		ok: true,
		...buildWorkspaceExecutionSweepPayload(observations),
	};
}

async function runDefaultReleasePolicy(): Promise<ReleasePolicyCheck> {
	const recommendedCommand = "refarm release plan --selection default --json";
	const engine = await import("@refarm.dev/release-engine") as {
		buildReleasePlan: (options: {
			cwd?: string;
			selectionId?: string;
			profileTags?: string[];
		}) => unknown;
		summarizePlan: (plan: unknown) => {
			ok: boolean;
			status: string;
			packageCount: number;
			packages: string[];
			profileTags: string[];
			packageProfiles: unknown[];
			blockers: unknown[];
		};
	};
	const plan = engine.buildReleasePlan({ cwd: process.cwd(), selectionId: "default" });
	const summary = engine.summarizePlan(plan);
	return {
		command: "release",
		operation: "plan",
		ok: summary.ok,
		status: summary.status,
		packageCount: summary.packageCount,
		packages: summary.packages,
		profileTags: summary.profileTags,
		packageProfiles: summary.packageProfiles,
		blockers: summary.blockers,
		recommendedCommand,
	};
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

async function runDefaultNodeSubstrate(): Promise<NodeSubstrateCheck> {
	const root = process.cwd();
	const platform = os.platform();
	const missing: string[] = [];
	const foreignPlatformShims: NodeSubstrateCheck["foreignPlatformShims"] = [];
	for (const relativePath of [
		"node_modules",
		"path:node_modules/.bin",
		...["vitest", "tsc", "eslint"].map(
			(binary) => `bin:${binary}`,
		),
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
	const mountIssues = await findNodeSubstrateMountIssues(root);
	const workspaceLinkChecks = await findNodeSubstrateWorkspaceLinkChecks(root);
	const missingWorkspaceDependencyLinks = workspaceLinkChecks.filter((check) => !check.ok);
	const runtimeChecks = await findNodeSubstrateRuntimeChecks(root);
	const missingRuntimeDependencies = runtimeChecks.filter((check) => !check.ok);
	const installCommand = packageFrozenInstallCommand({ cwd: root }).display;
	const recommendations = buildNodeSubstrateRecommendations({
		missing,
		foreignPlatformShims,
		mountIssues,
		missingWorkspaceDependencyLinks,
		missingRuntimeDependencies,
		installCommand,
	});
	return {
		command: "node-substrate",
		operation: "check",
		ok: recommendations.length === 0,
		platform,
		missing,
		foreignPlatformShims,
		mountIssues,
		workspaceLinkCount: workspaceLinkChecks.length,
		missingWorkspaceDependencyLinkCount: missingWorkspaceDependencyLinks.length,
		missingWorkspaceDependencyLinks: compactNodeSubstrateDependencyIssues(missingWorkspaceDependencyLinks),
		runtimeChecks,
		missingRuntimeDependencyCount: missingRuntimeDependencies.length,
		missingRuntimeDependencies: compactNodeSubstrateDependencyIssues(missingRuntimeDependencies),
		recommendations,
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
	installCommand?: string;
}): DiagnosticRecommendation[] {
	const installCommand = input.installCommand ?? packageFrozenInstallCommand().display;
	if (input.foreignPlatformShims.length > 0 || input.mountIssues.length > 0) {
		return [
			{
				diagnostic: input.mountIssues.length > 0
					? "node-substrate:shared-devcontainer-node-modules"
					: "node-substrate:foreign-platform-shims",
				severity: "failure",
				summary: input.mountIssues.length > 0
					? "The devcontainer contract expects node_modules to be a dedicated Docker volume, but this runtime is using the shared workspace mount."
					: "node_modules contains package-manager shims for a different platform.",
				action: NODE_SUBSTRATE_ENVIRONMENT_COMMAND,
				target: [
					...input.foreignPlatformShims.map((shim) => `${shim.found} -> ${shim.expected}`),
					...input.mountIssues.map((issue) => `${issue.path} -> ${issue.target}`),
				]
					.join(", "),
			},
		];
	}
	if (input.missing.length > 0) {
		return [
			{
				diagnostic: "node-substrate:missing-package-manager-bins",
				severity: "failure",
				summary: "node_modules is missing package-manager execution shims required by Refarm checks.",
				action: NODE_SUBSTRATE_INSTALL_COMMAND,
				command: installCommand,
				target: input.missing.join(", "),
			},
		];
	}
	if (input.missingWorkspaceDependencyLinks.length > 0) {
		const massiveWindowsWorkspaceLinkFailure =
			os.platform() === "win32" && input.missingWorkspaceDependencyLinks.length > 20;
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
				command: massiveWindowsWorkspaceLinkFailure ? undefined : installCommand,
				target: input.missingWorkspaceDependencyLinks
					.slice(0, 20)
					.map((dependency) => `${dependency.package} -> ${dependency.dependency}`)
					.join(", "),
			},
		];
	}
	if (input.missingRuntimeDependencies.length > 0) {
		return [
			{
				diagnostic: "node-substrate:missing-runtime-dependencies",
				severity: "failure",
				summary: "One or more workspace CLI packages cannot resolve declared external runtime dependencies from this environment.",
				action: NODE_SUBSTRATE_INSTALL_COMMAND,
				command: installCommand,
				target: input.missingRuntimeDependencies
					.map((dependency) => `${dependency.package} -> ${dependency.dependency}`)
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

async function findNodeSubstrateRuntimeChecks(
	root: string,
): Promise<NodeSubstrateCheck["runtimeChecks"]> {
	const checks: NodeSubstrateCheck["runtimeChecks"] = [];
	for await (const workspacePackage of readWorkspacePackageManifests(root)) {
		if (!workspacePackage.manifest.bin || !workspacePackage.manifest.dependencies) continue;
		const requireFromPackage = createRequire(workspacePackage.manifestPath);
		for (const [dependency, version] of Object.entries(workspacePackage.manifest.dependencies).sort()) {
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

async function readDevcontainerNodeModulesTarget(root: string): Promise<string | null> {
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
					return [
						field.slice(0, index).trim(),
						field.slice(index + 1).trim(),
					];
				}),
			);
			if (fields.source !== "refarm-node-modules") continue;
			if (typeof fields.target !== "string" || fields.target.length === 0) continue;
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

export function createCheckCommand(
	deps: RefarmCheckDeps = {
		runHealth: runHealthAudit,
	runDoctor: runDefaultDoctor,
	runModelDoctor: runDefaultModelDoctor,
	runNodeSubstrate: runDefaultNodeSubstrate,
	runRustSubstrate: runRustSubstrateCheck,
	runWorkspaceExecution: runDefaultWorkspaceExecution,
	runWorkspaceSweep: runDefaultWorkspaceSweep,
	runReleasePolicy: runDefaultReleasePolicy,
	},
): Command {
	return new Command("check")
		.description("Run the cheap composite readiness gate")
		.option("--json", "Output machine-readable composite report")
		.option("--next-action", "Print only the first blocking recovery action")
		.option("--next-command", "Print only the first executable recovery command")
		.option("--fail-on-warnings", "Treat doctor warning diagnostics as failures")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm check
  $ refarm check --json
  $ refarm check --next-action
  $ refarm check --next-action --json
  $ refarm check --next-command
  $ refarm check --fail-on-warnings

Notes:
  check combines refarm health and refarm doctor into one low-cost gate.
  Use it before a commit or handoff when you need a quick local confidence signal.
`,
		)
		.action(async (options: RefarmCheckOptions) => {
			const nodeSubstrate = await deps.runNodeSubstrate?.();
			const rustSubstrate = await deps.runRustSubstrate?.();
			const health = await deps.runHealth();
			const doctor = await deps.runDoctor({
				failOnWarnings: options.failOnWarnings,
			});
			const model = await deps.runModelDoctor?.();
			const workspaceExecution = await deps.runWorkspaceExecution?.();
			const workspaceSweep = await deps.runWorkspaceSweep?.();
			const releasePolicy = await deps.runReleasePolicy?.();
			const report = buildRefarmCheckReport({
				nodeSubstrate,
				rustSubstrate,
				workspaceExecution,
				workspaceSweep,
				releasePolicy,
				health,
				doctor,
				model,
			});

			if (options.nextCommand && options.json) {
				printRefarmCheckNextActionJson(report);
			} else if (options.nextCommand) {
				const [command] = report.nextCommands;
				if (command) console.log(command);
			} else if (options.nextAction && options.json) {
				printRefarmCheckNextActionJson(report);
			} else if (options.nextAction) {
				const [action] = report.nextActions;
				if (action) console.log(action);
			} else if (options.json) {
				printJson(report);
			} else {
				printRefarmCheckSummary(report);
			}

			if (!report.ok) {
				process.exitCode = 1;
			}
		});
}

export const checkCommand = createCheckCommand();
