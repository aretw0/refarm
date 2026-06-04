import chalk from "chalk";
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
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
import { type HealthReport, runHealthAudit } from "./health.js";
import { printJson } from "./json-output.js";
import {
	buildModelDoctorStatus,
	defaultModelDeps,
	type ModelDoctorStatus,
} from "./model.js";
import { resolveStatusPayload } from "./status.js";

const NODE_SUBSTRATE_ENVIRONMENT_COMMAND = "Run validation inside the environment that owns this node_modules tree, or rebuild/reopen the devcontainer so node_modules is isolated per platform.";
const NODE_SUBSTRATE_INSTALL_COMMAND = "Run the package-manager install command for this environment, then retry `refarm check --next-action --json`.";
const RUST_SUBSTRATE_BUILD_TOOLS_COMMAND = "Install Visual Studio Build Tools with the C++ build tools workload.";
const RUST_SUBSTRATE_DEVELOPER_SHELL_COMMAND = "Open a Developer PowerShell for VS or put the MSVC linker before Git usr/bin in PATH.";
const RUST_SUBSTRATE_CARGO_COMPONENT_COMMAND = "cargo install cargo-component --locked";
const RUST_SUBSTRATE_WASI_TARGET_COMMAND = "rustup target add wasm32-wasip1";

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
	recommendations: DiagnosticRecommendation[];
}

export interface RustSubstrateCheck {
	command: "rust-substrate";
	operation: "check";
	ok: boolean;
	required: boolean;
	platform: NodeJS.Platform;
	rustcHost: string | null;
	missing: string[];
	linker: string | null;
	compiler: string | null;
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
}

export function buildRefarmCheckReport(checks: {
	health: HealthReport;
	doctor: RefarmDoctorReport;
	model?: ModelDoctorStatus;
	nodeSubstrate?: NodeSubstrateCheck;
	rustSubstrate?: RustSubstrateCheck;
}): RefarmCheckReport {
	const recommendations: DiagnosticRecommendation[] = [
		...(checks.nodeSubstrate?.recommendations ?? []),
		...(checks.rustSubstrate?.recommendations ?? []),
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
			modelDoctorCheckRecommendations(checks.model).length,
		checks,
		recommendations,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
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
			`Node substrate: ${report.checks.nodeSubstrate.ok ? "pass" : "fail"} (${report.checks.nodeSubstrate.missing.length} missing, ${report.checks.nodeSubstrate.foreignPlatformShims.length} foreign shims, ${report.checks.nodeSubstrate.mountIssues.length} mount issues)`,
		);
	}
	if (report.checks.rustSubstrate?.required) {
		console.log(
			`Rust substrate: ${report.checks.rustSubstrate.ok ? "pass" : "fail"} (${report.checks.rustSubstrate.missing.length} missing)`,
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
	const recommendations = buildNodeSubstrateRecommendations({
		missing,
		foreignPlatformShims,
		mountIssues,
	});
	return {
		command: "node-substrate",
		operation: "check",
		ok: recommendations.length === 0,
		platform,
		missing,
		foreignPlatformShims,
		mountIssues,
		recommendations,
	};
}

function buildNodeSubstrateRecommendations(input: {
	missing: string[];
	foreignPlatformShims: NodeSubstrateCheck["foreignPlatformShims"];
	mountIssues: NodeSubstrateCheck["mountIssues"];
}): DiagnosticRecommendation[] {
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
				command: "pnpm install --frozen-lockfile",
				target: input.missing.join(", "),
			},
		];
	}
	return [];
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

async function rustSubstrateRequired(root: string): Promise<boolean> {
	return (await exists(path.join(root, "Cargo.toml"))) ||
		(await exists(path.join(root, "rust-toolchain.toml"))) ||
		(await exists(path.join(root, ".cargo", "config.toml")));
}

function runProbe(command: string, args: string[] = []): {
	ok: boolean;
	stdout: string;
	stderr: string;
} {
	try {
		return {
			ok: true,
			stdout: execFileSync(command, args, {
				encoding: "utf8",
				windowsHide: true,
			}).trim(),
			stderr: "",
		};
	} catch (error) {
		const probeError = error as {
			message?: string;
			stdout?: Buffer | string;
			stderr?: Buffer | string;
		};
		return {
			ok: false,
			stdout: probeError.stdout?.toString().trim() ?? "",
			stderr: probeError.stderr?.toString().trim() ?? probeError.message ?? "",
		};
	}
}

function stripAnsi(value: string): string {
	return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function commandSource(command: string): string | null {
	if (process.platform !== "win32") return null;
	const result = runProbe("powershell.exe", [
		"-NoProfile",
		"-Command",
		`(Get-Command ${command} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)`,
	]);
	return result.ok && result.stdout ? result.stdout : null;
}

async function runDefaultRustSubstrate(): Promise<RustSubstrateCheck> {
	const root = process.cwd();
	const required = await rustSubstrateRequired(root);
	const platform = os.platform();
	if (!required) {
		return {
			command: "rust-substrate",
			operation: "check",
			ok: true,
			required: false,
			platform,
			rustcHost: null,
			missing: [],
			linker: null,
			compiler: null,
			recommendations: [],
		};
	}

	const rustc = runProbe("rustc", ["-vV"]);
	const cargoList = runProbe("cargo", ["--list"]);
	const rustupTargets = runProbe("rustup", ["target", "list", "--installed"]);
	const rustcHost = rustc.stdout.match(/^host:\s*(.+)$/m)?.[1] ?? null;
	const installedTargets = rustupTargets.stdout.split(/\r?\n/).filter(Boolean);
	const cargoCommands = stripAnsi(cargoList.stdout).split(/\r?\n/).map((line) => line.trim());
	const missing: string[] = [];

	if (!rustc.ok) missing.push("rustc");
	if (!cargoList.ok) missing.push("cargo");
	if (!rustupTargets.ok) missing.push("rustup_targets");
	if (!installedTargets.includes("wasm32-wasip1")) missing.push("target_wasm32_wasip1");
	if (!cargoCommands.some((line) => line === "component" || line.startsWith("component "))) {
		missing.push("cargo_component");
	}

	const compiler = platform === "win32" ? commandSource("cl.exe") : null;
	const linker = platform === "win32" ? commandSource("link.exe") : null;
	if (platform === "win32" && rustcHost?.endsWith("-msvc")) {
		if (!compiler) missing.push("msvc_cl");
		if (!linker || /\\Git\\usr\\bin\\link\.exe$/i.test(linker)) missing.push("msvc_link");
	}

	const recommendations = buildRustSubstrateRecommendations({
		missing,
		rustcHost,
		linker,
	});
	return {
		command: "rust-substrate",
		operation: "check",
		ok: missing.length === 0,
		required,
		platform,
		rustcHost,
		missing,
		linker,
		compiler,
		recommendations,
	};
}

function buildRustSubstrateRecommendations(input: {
	missing: string[];
	rustcHost: string | null;
	linker: string | null;
}): DiagnosticRecommendation[] {
	const recommendations: DiagnosticRecommendation[] = [];
	const missingMsvcPrerequisite =
		input.rustcHost?.endsWith("-msvc") &&
		(input.missing.includes("msvc_cl") || input.missing.includes("msvc_link"));
	if (input.missing.includes("target_wasm32_wasip1")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-wasi-target",
			severity: "failure",
			summary: "The Rust target wasm32-wasip1 is required for Refarm WASM plugin builds.",
			action: RUST_SUBSTRATE_WASI_TARGET_COMMAND,
			command: RUST_SUBSTRATE_WASI_TARGET_COMMAND,
			target: "wasm32-wasip1",
		});
	}
	if (input.rustcHost?.endsWith("-msvc") && input.missing.includes("msvc_cl")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-msvc-build-tools",
			severity: "failure",
			summary: "The Windows MSVC Rust toolchain requires Visual Studio C++ build tools.",
			action: RUST_SUBSTRATE_BUILD_TOOLS_COMMAND,
			target: "cl.exe",
		});
	}
	if (
		input.rustcHost?.endsWith("-msvc") &&
		input.missing.includes("msvc_link") &&
		input.linker?.includes("\\Git\\usr\\bin\\link.exe")
	) {
		recommendations.push({
			diagnostic: "rust-substrate:wrong-msvc-linker",
			severity: "failure",
			summary: "The Rust MSVC linker resolves to Git's Unix-style link.exe instead of the MSVC linker.",
			action: RUST_SUBSTRATE_DEVELOPER_SHELL_COMMAND,
			target: input.linker,
		});
	}
	if (input.missing.includes("cargo_component")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-cargo-component",
			severity: "failure",
			summary: "cargo-component is required to build Refarm component-model WASM packages.",
			action: RUST_SUBSTRATE_CARGO_COMPONENT_COMMAND,
			command: missingMsvcPrerequisite ? undefined : RUST_SUBSTRATE_CARGO_COMPONENT_COMMAND,
			target: "cargo component",
		});
	}
	if (input.missing.includes("rustc") || input.missing.includes("cargo") || input.missing.includes("rustup_targets")) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-rust-toolchain",
			severity: "failure",
			summary: "The Rust toolchain is required by this workspace.",
			action: "Install Rust with rustup, then retry `refarm check --next-action --json`.",
		});
	}
	return recommendations;
}

export function createCheckCommand(
	deps: RefarmCheckDeps = {
		runHealth: runHealthAudit,
	runDoctor: runDefaultDoctor,
	runModelDoctor: runDefaultModelDoctor,
	runNodeSubstrate: runDefaultNodeSubstrate,
	runRustSubstrate: runDefaultRustSubstrate,
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
			const report = buildRefarmCheckReport({
				nodeSubstrate,
				rustSubstrate,
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
