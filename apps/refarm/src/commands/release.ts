import type {
	ReleaseGateResult,
	ReleasePlan,
	ReleasePlanSummary,
} from "@refarm.dev/release-engine";
import chalk from "chalk";
import { Command } from "commander";
import { printJson } from "./json-output.js";

export interface ReleaseCommandDeps {
	cwd?: () => string;
	buildReleasePlan?: ReleaseEngine["buildReleasePlan"];
	formatPlan?: ReleaseEngine["formatPlan"];
	runReleaseGates?: ReleaseEngine["runReleaseGates"];
	summarizePlan?: ReleaseEngine["summarizePlan"];
}

interface ReleaseEngine {
	buildReleasePlan: (input: BuildReleasePlanInput) => ReleasePlan;
	formatPlan: (plan: ReleasePlan) => string;
	runReleaseGates: (
		plan: ReleasePlan,
		options: { cwd?: string; dryRun?: boolean; onlyRequired?: boolean },
	) => ReleaseGateResult;
	summarizePlan: (plan: ReleasePlan) => ReleasePlanSummary;
}

interface BuildReleasePlanInput {
	cwd?: string;
	policyPath?: string;
	packageNames?: string[];
	profileTags?: string[];
	selectionId?: string;
	dryRun?: boolean;
}

export interface ReleasePlanCommandOptions {
	cwd?: string;
	policy?: string;
	tag?: string[];
	selection?: string;
	json?: boolean;
	checkGates?: boolean;
	dryRun?: boolean;
	onlyRequired?: boolean;
}

export type ReleaseCheckCommandOptions = Omit<ReleasePlanCommandOptions, "checkGates">;
export type ReleaseGatesCommandOptions = Omit<ReleaseCheckCommandOptions, "tag">;

function collectTag(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

function resolveTags(options: { tag?: string[] }): string[] {
	return (options.tag ?? []).map((tag) => tag.trim()).filter(Boolean);
}

async function loadReleaseEngine(deps: ReleaseCommandDeps | undefined): Promise<ReleaseEngine> {
	if (
		deps?.buildReleasePlan &&
		deps.formatPlan &&
		deps.runReleaseGates &&
		deps.summarizePlan
	) {
		return {
			buildReleasePlan: deps.buildReleasePlan,
			formatPlan: deps.formatPlan,
			runReleaseGates: deps.runReleaseGates,
			summarizePlan: deps.summarizePlan,
		};
	}
	const imported = await import("@refarm.dev/release-engine");
	if (
		typeof imported.buildReleasePlan !== "function" ||
		typeof imported.formatPlan !== "function" ||
		typeof imported.runReleaseGates !== "function" ||
		typeof imported.summarizePlan !== "function"
	) {
		throw new Error("Release engine module is missing required exports.");
	}
	return {
		buildReleasePlan: imported.buildReleasePlan,
		formatPlan: imported.formatPlan,
		runReleaseGates: imported.runReleaseGates,
		summarizePlan: imported.summarizePlan,
	};
}

function releaseJsonPayload(input: {
	operation: string;
	engine: ReleaseEngine;
	plan: ReleasePlan;
	gateResult?: ReleaseGateResult;
	commandNote?: string;
}): ReleasePlanSummary & {
	command: "release";
	operation: string;
	nextAction: null;
	nextActions: string[];
	nextCommand: null;
	nextCommands: string[];
	gates?: ReleasePlan["gates"];
	publishIntents?: ReleasePlan["publishIntents"];
	gateResult?: ReleaseGateResult;
	commandNote?: string;
} {
	return {
		...input.engine.summarizePlan(input.plan),
		command: "release",
		operation: input.operation,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
		gates: input.plan.gates,
		publishIntents: input.plan.publishIntents,
		...(input.gateResult ? { gateResult: input.gateResult } : {}),
		...(input.commandNote ? { commandNote: input.commandNote } : {}),
	};
}

function releaseErrorPayload(operation: string, error: unknown): {
	command: "release";
	operation: string;
	ok: false;
	status: "error";
	error: "release-command-failed";
	message: string;
	nextAction: null;
	nextActions: string[];
	nextCommand: null;
	nextCommands: string[];
} {
	return {
		command: "release",
		operation,
		ok: false,
		status: "error",
		error: "release-command-failed",
		message: error instanceof Error ? error.message : String(error),
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}

function handleReleaseCommandError(
	operation: string,
	options: { json?: boolean },
	error: unknown,
): void {
	if (options.json) {
		printJson(releaseErrorPayload(operation, error));
	} else {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
	}
	process.exitCode = 1;
}

function planFromOptions(
	packages: string[],
	options: ReleasePlanCommandOptions | ReleaseCheckCommandOptions | ReleaseGatesCommandOptions,
	deps: ReleaseCommandDeps | undefined,
	engine: ReleaseEngine,
): ReleasePlan {
	const cwd = options.cwd ?? deps?.cwd?.() ?? process.cwd();
	return engine.buildReleasePlan({
		cwd,
		policyPath: options.policy ?? "release-policy.json",
		packageNames: packages.length > 0 ? packages : undefined,
		profileTags: "tag" in options ? resolveTags(options) : [],
		selectionId: options.selection,
		dryRun: Boolean(options.dryRun),
	});
}

function printPlan(plan: ReleasePlan, engine: ReleaseEngine): void {
	console.log(engine.formatPlan(plan));
	if (plan.profileTags && plan.profileTags.length > 0) {
		console.log(chalk.dim(`Profile tags: ${plan.profileTags.join(", ")}`));
	}
}

export function createReleaseCommand(deps?: ReleaseCommandDeps): Command {
	const command = new Command("release")
		.description("Plan and verify release policy from Refarm config")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm release plan --selection default --json",
				"  $ refarm release plan --tag kernel --tag candidate --json",
				"  $ refarm release plan @refarm.dev/storage-contract-v1 --json",
				"  $ refarm release check --tag kernel-contract --dry-run",
				"  $ refarm release gates --dry-run --only-required",
				"",
				"Notes:",
				"  Release policy is read from .refarm/config.json by default.",
				"  The engine remains @refarm.dev/release-engine; this command is the operator surface.",
			].join("\n"),
		);

	command
		.command("plan")
		.description("Build a release plan without executing gates")
		.argument("[packages...]", "Explicit workspace package names to plan")
		.option("--cwd <dir>", "Workspace root for plan resolution")
		.option("--policy <file>", "Policy filename or path")
		.option("--selection <id>", "Select packages using a release policy selection")
		.option("--tag <tag>", "Select packages whose release profile contains this tag", collectTag, [])
		.option("--check-gates", "Also run gate validation after plan")
		.option("--dry-run", "Skip command execution when --check-gates is used")
		.option("--only-required", "Run only required gates when --check-gates is used")
		.option("--json", "Output machine-readable release plan")
		.action(async (packages: string[], options: ReleasePlanCommandOptions) => {
			try {
				const engine = await loadReleaseEngine(deps);
				const plan = planFromOptions(packages, options, deps, engine);
				const gateResult = options.checkGates
					? engine.runReleaseGates(plan, {
						cwd: options.cwd ?? deps?.cwd?.() ?? process.cwd(),
						dryRun: Boolean(options.dryRun),
						onlyRequired: Boolean(options.onlyRequired),
					})
					: undefined;

				if (options.json) {
					printJson(releaseJsonPayload({ operation: "plan", engine, plan, gateResult }));
				} else {
					printPlan(plan, engine);
					if (gateResult) {
						console.log(`\nGate check: ${gateResult.ok ? "passed" : "failed"}`);
					}
				}
				if (!plan.ok || gateResult?.ok === false) process.exitCode = 1;
			} catch (error) {
				handleReleaseCommandError("plan", options, error);
			}
		});

	command
		.command("check")
		.description("Dry-run release gates for a release plan")
		.argument("[packages...]", "Explicit workspace package names to plan")
		.option("--cwd <dir>", "Workspace root for plan resolution")
		.option("--policy <file>", "Policy filename or path")
		.option("--selection <id>", "Select packages using a release policy selection")
		.option("--tag <tag>", "Select packages whose release profile contains this tag", collectTag, [])
		.option("--dry-run", "Keep gate commands in dry-run mode", true)
		.option("--only-required", "Run only required gates")
		.option("--json", "Output machine-readable release check")
		.action(async (packages: string[], options: ReleaseCheckCommandOptions) => {
			try {
				const engine = await loadReleaseEngine(deps);
				const plan = planFromOptions(packages, { ...options, dryRun: true }, deps, engine);
				const gateResult = plan.ok
					? engine.runReleaseGates(plan, {
						cwd: options.cwd ?? deps?.cwd?.() ?? process.cwd(),
						dryRun: true,
						onlyRequired: Boolean(options.onlyRequired),
					})
					: {
						ok: false,
						results: [],
						policy: plan.policy,
						dryRun: true,
					};
				if (options.json) {
					printJson(
						releaseJsonPayload({
							operation: "check",
							engine,
							plan,
							gateResult,
							commandNote: plan.ok
								? "Dry-run gate check complete."
								: "Plan is blocked before gate execution.",
						}),
					);
				} else {
					printPlan(plan, engine);
					console.log(`\nGate check: ${gateResult.ok ? "passed" : "failed"}`);
				}
				if (!plan.ok || !gateResult.ok) process.exitCode = 1;
			} catch (error) {
				handleReleaseCommandError("check", options, error);
			}
		});

	command
		.command("gates")
		.description("Execute release gates for the current release plan")
		.argument("[packages...]", "Explicit workspace package names to plan")
		.option("--cwd <dir>", "Workspace root for plan resolution")
		.option("--policy <file>", "Policy filename or path")
		.option("--selection <id>", "Select packages using a release policy selection")
		.option("--dry-run", "Skip command execution")
		.option("--only-required", "Run only required gates")
		.option("--json", "Output machine-readable gate result")
		.action(async (packages: string[], options: ReleaseGatesCommandOptions) => {
			try {
				const engine = await loadReleaseEngine(deps);
				const plan = planFromOptions(packages, options, deps, engine);
				const gateResult = plan.ok
					? engine.runReleaseGates(plan, {
						cwd: options.cwd ?? deps?.cwd?.() ?? process.cwd(),
						dryRun: Boolean(options.dryRun),
						onlyRequired: Boolean(options.onlyRequired),
					})
					: {
						ok: false,
						results: [],
						policy: plan.policy,
						dryRun: Boolean(options.dryRun),
					};
				if (options.json) {
					printJson(releaseJsonPayload({ operation: "gates", engine, plan, gateResult }));
				} else {
					console.log(gateResult.ok ? "Release gates passed." : "Release gates blocked.");
					printPlan(plan, engine);
				}
				if (!plan.ok || !gateResult.ok) process.exitCode = 1;
			} catch (error) {
				handleReleaseCommandError("gates", options, error);
			}
		});

	return command;
}

export const releaseCommand = createReleaseCommand();
