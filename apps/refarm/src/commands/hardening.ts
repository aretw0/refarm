import {
	collectHardeningSignal,
	evaluateHardeningRatchet,
	findWorkspaceRoot,
	readHardeningBaseline,
	type BaselineRead,
	type HardeningSignal,
	type RatchetVerdict,
} from "@refarm.dev/hardening";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import { CommandRefusal, guardedAction } from "./action-boundary.js";

export interface HardeningCommandOptions {
	json?: boolean;
	gate?: boolean;
}

export interface HardeningCommandReport {
	command: "hardening";
	operation: "signal" | "gate";
	ok: boolean;
	signal: HardeningSignal;
	baseline: BaselineRead;
	ratchet: RatchetVerdict;
}

export interface HardeningCommandDeps {
	cwd: () => string;
	collect: typeof collectHardeningSignal;
	findRoot: typeof findWorkspaceRoot;
	readBaseline: typeof readHardeningBaseline;
	evaluate: typeof evaluateHardeningRatchet;
	emit: (line: string) => void;
	setExitCode: (code: number) => void;
}

const defaultDeps: HardeningCommandDeps = {
	cwd: () => process.cwd(),
	collect: collectHardeningSignal,
	findRoot: findWorkspaceRoot,
	readBaseline: readHardeningBaseline,
	evaluate: evaluateHardeningRatchet,
	emit: (line) => console.log(line),
	setExitCode: (code) => {
		process.exitCode = code;
	},
};

export async function buildHardeningReport(
	options: HardeningCommandOptions,
	deps: HardeningCommandDeps = defaultDeps,
): Promise<HardeningCommandReport> {
	const workspaceRoot = deps.findRoot(deps.cwd());
	if (!workspaceRoot) {
		throw new CommandRefusal(
			"no-workspace-root",
			"No pnpm workspace root found from the current directory.",
			"Run this from inside a pnpm workspace — hardening reads a workspace's conformance signal.",
		);
	}
	const signal = await deps.collect({ workspaceRoot });
	const baseline = deps.readBaseline(workspaceRoot);
	const ratchet = baseline.error
		? {
				ok: false,
				regressions: [],
				fixed: [],
				stale: [],
				held: [],
				malformed: [`${baseline.path}: ${baseline.error}`],
			}
		: deps.evaluate(signal, baseline.baseline);
	return {
		command: "hardening",
		operation: options.gate ? "gate" : "signal",
		ok: options.gate ? ratchet.ok : true,
		signal,
		baseline,
		ratchet,
	};
}

function renderHuman(report: HardeningCommandReport): string {
	const { counts } = report.signal;
	const lines = [
		`${counts.suites} conformance suites, ${counts.conformant} conformant (${counts.checks} checks); ${counts.notYetHardened} not yet hardened; ${counts.notApplicable} not applicable.`,
	];
	for (const entry of report.signal.entries.filter((item) => item.state !== "conformant")) {
		lines.push(`\n${entry.state}: ${entry.id}`);
		lines.push(`  ${entry.fix ?? entry.reason ?? "No detail reported."}`);
	}
	if (report.operation === "gate") {
		lines.push(`\nratchet: ${report.ratchet.ok ? "held" : "REJECTED"}`);
		for (const item of report.ratchet.regressions) lines.push(`  new debt: ${item.id} — ${item.fix}`);
		for (const id of report.ratchet.fixed) lines.push(`  remove fixed baseline entry: ${id}`);
		for (const item of report.ratchet.stale) lines.push(`  remove stale baseline entry: ${item.id} — ${item.why}`);
		for (const id of report.ratchet.malformed) lines.push(`  malformed baseline entry: ${id}`);
	}
	return lines.join("\n");
}

export function createHardeningCommand(deps: HardeningCommandDeps = defaultDeps): Command {
	return new Command("hardening")
		.description("Collect the workspace conformance signal and enforce its shrinking baseline")
		.option("--json", "Output the complete machine-readable hardening signal")
		.option("--gate", "Fail when hardening debt grows or the baseline becomes stale")
		.action(
			guardedAction(
				(options: HardeningCommandOptions) => ({
					json: options.json === true,
					command: "hardening",
					operation: options.gate ? "gate" : "signal",
					error: "hardening-failed",
					nextAction: "Run the command from a directory inside the workspace you mean to inspect.",
					nextCommand: refarmCommand(["hardening", "--json"]),
				}),
				async (options: HardeningCommandOptions) => {
					const report = await buildHardeningReport(options, deps);
					deps.emit(options.json ? JSON.stringify(report, null, 2) : renderHuman(report));
					if (!report.ok) deps.setExitCode(1);
				},
			),
		);
}

export const hardeningCommand = createHardeningCommand();
