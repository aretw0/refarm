import type { CapabilityEnvelope } from "@refarm.dev/capabilities";
import { quoteCommandArg, refarmCommand, shellCommand } from "@refarm.dev/cli/command-handoff";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/cli/json-output";
import { runProcessHandoff } from "@refarm.dev/cli/process-handoff";
import { basename, extname } from "node:path";
import {
	createPackageBinaryCommand,
	PACKAGE_MANAGER_OVERRIDE,
	PACKAGE_MANAGERS,
} from "./package-manager.js";

const PACKAGE_MANAGER_OVERRIDE_HELP = PACKAGE_MANAGERS.join("|");

function pluginBundleCommand(
	input: string,
	options: {
		output: string;
		name: string;
		dryRun?: boolean;
		json?: boolean;
	},
): string {
	return refarmCommand([
		"plugin",
		"bundle",
		quoteCommandArg(input),
		"-o",
		quoteCommandArg(options.output),
		"--name",
		quoteCommandArg(options.name),
		...(options.dryRun ? ["--dry-run"] : []),
		...(options.json ? ["--json"] : []),
	]);
}

/** The child-process spawn `bundle` needs — the ONLY side effect. Injected so
 * the pure builder is headless-testable. */
export type RunBundleProcess = (
	spec: Parameters<typeof runProcessHandoff>[0],
) => Promise<Awaited<ReturnType<typeof runProcessHandoff>>>;

/**
 * Build the byte-stable `plugin bundle` envelope — the pure core the
 * CapabilityGroup's `bundle` run() returns. All three legacy branches (dry-run /
 * success / failure) are preserved verbatim; the only side effect (the jco spawn)
 * is injected via `runBundle`. On failure the child's exit code rides as the flat
 * `exitCode` field (envelopes spread `extra` at top level — json-output.ts:99,135),
 * which the group's exit-code hook reads to forward jco's own code.
 */
export async function buildBundleReport(options: {
	input: string;
	output?: string;
	name?: string;
	dryRun?: boolean;
	runBundle: RunBundleProcess;
}): Promise<CapabilityEnvelope> {
	const input = options.input;
	const output = options.output ?? "./dist";
	const name = options.name ?? basename(input, extname(input));
	const command = createPackageBinaryCommand("jco", [
		"transpile",
		input,
		"-o",
		output,
		"--name",
		name,
	]);
	const executableCommand = shellCommand(command.command, command.args);
	const bundleRefarmCommand = pluginBundleCommand(input, { output, name });

	if (options.dryRun) {
		return buildJsonSuccessEnvelope({
			command: "plugin",
			operation: "bundle",
			nextCommand: bundleRefarmCommand,
			nextCommands: [bundleRefarmCommand],
			extra: {
				input,
				output,
				name,
				dryRun: true,
				bundleCommand: executableCommand,
				packageManager: command.packageManager ?? null,
				packageManagerCommand: command.command,
				process: command,
				processCommand: command.command,
				processArgs: command.args,
				display: command.display,
				args: command.args,
			},
		});
	}

	let result: Awaited<ReturnType<typeof runProcessHandoff>> | undefined;
	try {
		result = await options.runBundle({ ...command, display: command.display });
		if (result.exitCode !== 0) {
			const detail = result.stderr?.trim() || result.stdout?.trim();
			throw new Error(detail || `jco exited with code ${result.exitCode}`);
		}
		return buildJsonSuccessEnvelope({
			command: "plugin",
			operation: "bundle",
			extra: {
				input,
				output,
				name,
				dryRun: false,
				bundleCommand: executableCommand,
				packageManager: command.packageManager ?? null,
				packageManagerCommand: command.command,
				process: command,
				processCommand: command.command,
				processArgs: command.args,
				display: command.display,
				args: command.args,
				stdout: result.stdout,
				stderr: result.stderr,
				artifact: `${output}/${name}.js`,
			},
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "bundle",
			error: "plugin-bundle-failed",
			message,
			nextAction: `Override package manager with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}, or install jco for the detected package manager.`,
			nextCommand: bundleRefarmCommand,
			nextCommands: [
				bundleRefarmCommand,
				pluginBundleCommand(input, {
					output,
					name,
					dryRun: true,
					json: true,
				}),
			],
			extra: {
				input,
				output,
				name,
				dryRun: false,
				bundleCommand: executableCommand,
				packageManager: command.packageManager ?? null,
				packageManagerCommand: command.command,
				process: command,
				processCommand: command.command,
				processArgs: command.args,
				display: command.display,
				args: command.args,
				exitCode: result?.exitCode ?? 1,
				stdout: result?.stdout,
				stderr: result?.stderr,
			},
		});
	}
}

export async function bundlePluginAction(
	input: string,
	options: { output: string; name?: string; dryRun?: boolean; json?: boolean },
): Promise<void> {
	const name = options.name ?? basename(input, extname(input));
	const command = createPackageBinaryCommand("jco", [
		"transpile",
		input,
		"-o",
		options.output,
		"--name",
		name,
	]);
	if (!options.json && options.dryRun) {
		console.log(`Bundle dry-run for ${name} from ${input}:`);
		console.log(`  → ${command.display}`);
		return;
	}
	if (!options.json) {
		console.log(`Bundling plugin ${name} from ${input}...`);
		console.log(`  → ${command.display}`);
	}
	const report = await buildBundleReport({
		input,
		output: options.output,
		name: options.name,
		dryRun: options.dryRun,
		runBundle: (spec) => runProcessHandoff(spec, { capture: options.json === true }),
	});
	if (options.json) {
		printJson(report);
	} else if (report.ok) {
		if (!options.dryRun) {
			console.log(`  ✓ Plugin bundled to ${options.output}/${name}.js`);
		}
	} else {
		console.error(`  ✗ Bundle failed: ${(report as { message?: string }).message}`);
		console.error(`    Command: ${command.display}`);
		console.error(
			`    Override package manager with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
		);
	}
	if (!report.ok) {
		const code = (report as { exitCode?: number }).exitCode;
		process.exitCode = code && code !== 0 ? code : 1;
	}
}
