/**
 * `refarm tools` — the guided half of `nodeTools`.
 *
 * Thin by design. Everything it does lives in `tools.ts`, which composes the repository's existing
 * blocks; this file is argument parsing, two renderers, and the JSON envelope every other command
 * already speaks.
 */
import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import chalk from "chalk";
import { Command } from "commander";
import {
	runToolsAdd,
	runToolsList,
	TOOLS_ADD_COMMAND,
	type ToolsAddResult,
	type ToolsListResult,
} from "./tools.js";

const STATE_MARK: Record<string, string> = {
	ok: "✓",
	absent: "✗",
	outdated: "!",
	"cannot-say": "?",
};

function printList(result: ToolsListResult): void {
	if (result.tools.length === 0 && result.malformed.length === 0) {
		console.log(chalk.dim(`No tools declared in ${result.configPath}.`));
		console.log(chalk.dim(`Declare one with \`${TOOLS_ADD_COMMAND} <command>\`.`));
		return;
	}
	console.log(chalk.bold(`Declared node tools — ${result.configPath}`));
	for (const tool of result.tools) {
		const mark = STATE_MARK[tool.state] ?? "·";
		const floor = tool.minVersion ? ` >= ${tool.minVersion}` : "";
		const measured = tool.measuredVersion ? ` (measured ${tool.measuredVersion})` : "";
		const line = `  ${mark} ${tool.command}${floor}${measured}`;
		console.log(tool.state === "ok" ? chalk.green(line) : chalk.yellow(line));
		if (tool.detail) console.log(chalk.dim(`      ${tool.detail}`));
	}
	for (const entry of result.malformed) {
		console.log(chalk.red(`  ! unreadable entry: ${JSON.stringify(entry)}`));
	}
}

function printAdd(result: ToolsAddResult): void {
	if (result.status === "authorized") {
		console.log(chalk.green(`✓ ${result.tool} declared.`));
		console.log(chalk.dim(`   ${result.minVersion ? `floor ${result.minVersion}` : "presence only"}`));
		return;
	}
	if (result.status === "declined") {
		console.log(chalk.yellow(`· ${result.tool} not declared — you said no. Recorded as ${result.recordId}.`));
		return;
	}
	if (result.status === "refused") {
		console.log(chalk.yellow(`· ${result.tool}: ${result.reason}`));
		return;
	}
	console.log(chalk.dim(`· ${result.tool}: nothing was written.`));
}

export function createToolsCommand(): Command {
	const command = new Command("tools").description(
		"The tools this node depends on but does not ship — declared, measured, reported",
	);

	command
		.command("list")
		.description("Every declared tool and where it stands, including the ones that are fine")
		.option("--json", "Output machine-readable JSON")
		.action((options: { json?: boolean }) => {
			const result = runToolsList();
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "tools",
						operation: "list",
						nextAction:
							result.tools.some((tool) => tool.state !== "ok") || result.malformed.length > 0
								? "Reconcile the declared tools this node cannot satisfy."
								: null,
						nextCommands: [],
						extra: { ...result },
					}),
				);
				return;
			}
			printList(result);
		});

	command
		.command("add")
		.description("Declare a tool, guided — measures it first, then writes the same .refarm/config.json")
		.argument("<command>", "The binary this node depends on")
		.option("--min <version>", "The floor. Asked, with the measured version proposed, when omitted")
		.option("--why <text>", "What breaks without it")
		// ONE token, not variadic. `--args` collides with Commander's own positional bag, and a
		// variadic `<args...>` is invisible to the ancestor-option guard, which probes a value
		// option by mirroring a sentinel and gets an ARRAY back. Both were caught by that guard.
		// A version probe is one token in practice (`--version`, `-V`, `version`); the config's
		// `args` array still carries the rare multi-token case.
		.option("--version-arg <arg>", "How to ask its version (defaults to --version)")
		.option("--even-if-absent", "Declare it although it did not run — you are about to install it")
		.option("--attended-elsewhere", "No terminal here; you are attending from another surface")
		.option("--json", "Output machine-readable JSON")
		.action(
			async (
				binary: string,
				options: {
					min?: string;
					why?: string;
					versionArg?: string;
					evenIfAbsent?: boolean;
					attendedElsewhere?: boolean;
					json?: boolean;
				},
			) => {
				const result = await runToolsAdd(binary, {
					...(options.min ? { minVersion: options.min } : {}),
					...(options.why ? { why: options.why } : {}),
					...(options.versionArg ? { args: [options.versionArg] } : {}),
					...(options.evenIfAbsent ? { evenIfAbsent: true } : {}),
					...(options.attendedElsewhere ? { attendedElsewhere: true } : {}),
				});
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "tools",
							operation: "add",
							nextAction:
								result.status === "authorized" ? "refarm tools list --json" : null,
							nextCommands: result.status === "authorized" ? ["refarm tools list --json"] : [],
							extra: { ...result },
						}),
					);
					return;
				}
				printAdd(result);
			},
		);

	return command;
}
