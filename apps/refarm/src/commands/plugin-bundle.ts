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
	const executableCommand = shellCommand(command.command, command.args);
	const bundleRefarmCommand = pluginBundleCommand(input, {
		output: options.output,
		name,
	});
	if (options.dryRun) {
		if (options.json) {
			printJson(
				buildJsonSuccessEnvelope({
					command: "plugin",
					operation: "bundle",
					nextCommand: bundleRefarmCommand,
					nextCommands: [bundleRefarmCommand],
					extra: {
						input,
						output: options.output,
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
				}),
			);
			return;
		}
		console.log(`Bundle dry-run for ${name} from ${input}:`);
		console.log(`  → ${command.display}`);
		return;
	}
	if (!options.json) {
		console.log(`Bundling plugin ${name} from ${input}...`);
	}
	let result:
		| Awaited<ReturnType<typeof runProcessHandoff>>
		| undefined;
	try {
		if (!options.json) {
			console.log(`  → ${command.display}`);
		}
		result = await runProcessHandoff(
			{
				...command,
				display: command.display,
			},
			{
				capture: options.json === true,
			},
		);
		if (result.exitCode !== 0) {
			const detail = result.stderr?.trim() || result.stdout?.trim();
			throw new Error(detail || `jco exited with code ${result.exitCode}`);
		}
		if (options.json) {
			printJson(
				buildJsonSuccessEnvelope({
					command: "plugin",
					operation: "bundle",
					extra: {
						input,
						output: options.output,
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
						artifact: `${options.output}/${name}.js`,
					},
				}),
			);
			return;
		}
		console.log(`  ✓ Plugin bundled to ${options.output}/${name}.js`);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "plugin",
					operation: "bundle",
					error: "plugin-bundle-failed",
					message,
					nextAction: `Override package manager with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}, or install jco for the detected package manager.`,
					nextCommand: bundleRefarmCommand,
					nextCommands: [
						bundleRefarmCommand,
						pluginBundleCommand(input, {
							output: options.output,
							name,
							dryRun: true,
							json: true,
						}),
					],
					extra: {
						input,
						output: options.output,
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
				}),
			);
		} else {
			console.error(`  ✗ Bundle failed: ${message}`);
			console.error(`    Command: ${command.display}`);
			console.error(
				`    Override package manager with ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
			);
		}
		process.exitCode = result?.exitCode && result.exitCode !== 0 ? result.exitCode : 1;
	}
}
