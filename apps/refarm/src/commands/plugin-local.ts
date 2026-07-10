import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
	type JsonErrorEnvelope,
} from "@refarm.dev/capabilities/envelope";
import { quoteCommandArg } from "@refarm.dev/cli/command-handoff";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import { capabilityCliCommandsForGroup } from "./capability-registry.js";
import { PLUGIN_STATUS_JSON_COMMAND } from "./plugin-handoffs.js";

const EXTENSION_LIST_JSON_COMMAND = refarmCommand([
	"extension",
	"list",
	"--json",
]);
const EXAMPLE_EXTENSION_SAVE_GLOBAL_COMMAND = refarmCommand([
	"extension",
	"save",
	"my-tool",
	"--global",
]);
const EXAMPLE_EXTENSION_SAVE_LOCAL_COMMAND = refarmCommand([
	"extension",
	"save",
	"my-tool",
	"--local",
]);
const EXAMPLE_EXTENSION_SAVE_GLOBAL_JSON_COMMAND = refarmCommand([
	"extension",
	"save",
	"my-tool",
	"--global",
	"--json",
]);
const EXAMPLE_EXTENSION_SAVE_LOCAL_JSON_COMMAND = refarmCommand([
	"extension",
	"save",
	"my-tool",
	"--local",
	"--json",
]);

function extensionSaveCommand(
	name: string,
	scope: "global" | "local",
	json = false,
): string {
	return refarmCommand([
		"extension",
		"save",
		quoteCommandArg(name),
		`--${scope}`,
		...(json ? ["--json"] : []),
	]);
}

// The scaffold model + fs writes + local-plugin scan live in the leaf module
// `plugin-scaffold.ts` (ADR-086) so both the `plugin` CapabilityGroup and the
// unified `plugin list` reader can reuse them without this file's
// `capability-registry` dependency (that closed an import cycle). Only what this
// file's body uses is imported; other consumers import from the leaf directly.
import {
	buildCreatedPluginReport,
	buildExtensionListReport,
	extensionReloadCommand,
	type CreatedExtensionReport,
} from "./plugin-scaffold.js";

function printCreatedExtension(report: CreatedExtensionReport): void {
	console.log(`Created extension '${report.slug}' at ${report.dir} (${report.scope})`);
	console.log(`  id: ${report.id}`);
	console.log(`  Edit: ${report.indexPath}`);
	if (report.surfaceCommand) {
		console.log(`  Surface: ${report.surfaceCommand}`);
	}
	console.log(`  Activate: ${report.nextActions[0]}`);
	if (report.nextActions[1]) {
		console.log(`  Fallback: ${report.nextActions[1]}`);
	}
	}

async function newExtension(
	name: string,
	isGlobal: boolean,
	options: { json?: boolean; verb?: string } = {},
): Promise<void> {
	const report = await buildCreatedPluginReport({
		name,
		isGlobal,
		verb: options.verb,
		cwd: process.cwd(),
		homeDir: os.homedir(),
	});
	if (report.ok === false) {
		if (options.json) printJson(report);
		else console.error((report as JsonErrorEnvelope).message);
		process.exitCode = 1;
		return;
	}
	if (options.json) {
		printJson(report);
		return;
	}
	printCreatedExtension(report);
	}

async function saveExtension(
	name: string,
	toGlobal: boolean,
	options: { json?: boolean } = {},
): Promise<void> {
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "extension",
					operation: "save",
					error: "invalid-extension-name",
					message:
						"Use lowercase letters, digits, and hyphens only (e.g. my-tool).",
					nextAction: EXAMPLE_EXTENSION_SAVE_GLOBAL_COMMAND,
					nextActions: [
						EXAMPLE_EXTENSION_SAVE_GLOBAL_COMMAND,
						EXAMPLE_EXTENSION_SAVE_LOCAL_COMMAND,
					],
					nextCommand: EXAMPLE_EXTENSION_SAVE_GLOBAL_JSON_COMMAND,
					nextCommands: [
						EXAMPLE_EXTENSION_SAVE_GLOBAL_JSON_COMMAND,
						EXAMPLE_EXTENSION_SAVE_LOCAL_JSON_COMMAND,
					],
					extra: {
						name,
						action: "save",
					},
				}),
			);
			process.exitCode = 1;
			return;
		}
		console.error(
			`Invalid extension name '${name}': use lowercase letters, digits, and hyphens only (e.g. my-tool)`,
		);
		process.exitCode = 1;
		return;
	}
	const cwd = process.cwd();
	const homeDir = os.homedir();

	const srcDir = toGlobal
		? path.join(cwd, ".refarm", "extensions", name)
		: path.join(homeDir, ".refarm", "extensions", name);

	const destDir = toGlobal
		? path.join(homeDir, ".refarm", "extensions", name)
		: path.join(cwd, ".refarm", "extensions", name);

	if (!existsSync(srcDir)) {
		const fromScope = toGlobal ? "project" : "global";
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "extension",
					operation: "save",
					error: "extension-not-found",
					nextAction: EXTENSION_LIST_JSON_COMMAND,
					nextCommand: EXTENSION_LIST_JSON_COMMAND,
					extra: {
						name,
						action: "save",
						fromScope,
						sourceDir: srcDir,
						destinationDir: destDir,
					},
				}),
			);
			process.exitCode = 1;
			return;
		}
		console.error(`Extension '${name}' not found in ${fromScope} scope (${srcDir})`);
		process.exitCode = 1;
		return;
	}

	await mkdir(path.dirname(destDir), { recursive: true });
	await rename(srcDir, destDir);

	const toScope = toGlobal ? "global" : "project";
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "extension",
				operation: "save",
				nextAction: EXTENSION_LIST_JSON_COMMAND,
				nextCommand: EXTENSION_LIST_JSON_COMMAND,
				extra: {
					name,
					action: "save",
					fromScope: toGlobal ? "project" : "global",
					toScope,
					sourceDir: srcDir,
					destinationDir: destDir,
				},
			}),
		);
		return;
	}
	console.log(`Extension '${name}' moved to ${toScope} scope (${destDir})`);
	}

function publishExtensionPlan(name: string) {
	const reloadCommand = extensionReloadCommand(name, true);
	return buildJsonErrorEnvelope({
		command: "extension",
		operation: "publish",
		error: "extension-publish-manual",
		message: `Publishing local extension '${name}' is not automated yet.`,
		nextAction: "Package the extension as a WASM plugin before bundling.",
		nextActions: [
			refarmCommand(["extension", "list"]),
			reloadCommand,
			"Package the extension as a WASM plugin before bundling.",
			refarmCommand(["plugin", "status"]),
		],
		nextCommand: EXTENSION_LIST_JSON_COMMAND,
		nextCommands: [EXTENSION_LIST_JSON_COMMAND, reloadCommand, PLUGIN_STATUS_JSON_COMMAND],
		extra: {
			name,
			action: "publish",
			status: "manual",
		},
	});
	}

function listHandler(options: { json?: boolean } = {}): void {
	const report = buildExtensionListReport(process.cwd(), os.homedir());
	if (options.json) {
		printJson(report);
		return;
	}

	const entries = report.extensions;
	if (entries.length === 0) {
		console.log("No local extensions. Create one: refarm extension new <name>");
		return;
	}

	const idW = Math.max(...entries.map((e) => e.id.length), 2);
	const verW = Math.max(...entries.map((e) => e.version.length), 7);

	console.log(`  ${"ID".padEnd(idW)}  ${"VERSION".padEnd(verW)}  SCOPE`);
	for (const { id, version, scope } of entries) {
		console.log(`  ${id.padEnd(idW)}  ${version.padEnd(verW)}  ${scope}`);
	}
	}


export const extensionCommand = new Command("extension").description(
	"[deprecated: use `plugin`] Manage local JS extensions",
);

// ADR-086 phase 4: `extension` is a deprecated alias for `plugin`. Each sub-verb
// that has a canonical `plugin` home is pointed there; this notice writes to
// STDERR so a `--json` stdout envelope stays clean (machines parse stdout only).
// `save`/`publish` have no `plugin` equivalent yet — they get a generic notice.
const EXTENSION_TO_PLUGIN_HINT: Record<string, string> = {
	new: "plugin new",
	review: "plugin review",
	list: "plugin list --origin local",
	install: "plugin install",
};

extensionCommand.hook("preAction", (_thisCommand, actionCommand) => {
	// Suppress the notice on `--json` so structured consumers never see it on stderr
	// interleaved with progress; the notice is for humans at a terminal.
	const opts = actionCommand.opts();
	if (opts.json === true) return;
	const verb = actionCommand.name();
	const hint = EXTENSION_TO_PLUGIN_HINT[verb];
	process.stderr.write(
		hint
			? `note: \`extension ${verb}\` is deprecated; use \`${hint}\`.\n`
			: `note: the \`extension\` command is deprecated; prefer \`plugin\` (\`${verb}\` will move there).\n`,
	);
});

extensionCommand.addHelpText(
	"after",
	`
Deprecated — use the \`plugin\` command (ADR-086):
  refarm extension new     ->  refarm plugin new
  refarm extension review  ->  refarm plugin review
  refarm extension list    ->  refarm plugin list --origin local
  refarm extension install ->  refarm plugin install <path>
  (save/publish have no plugin equivalent yet)

Notes:
  Local plugins are loaded by the Refarm runtime. After editing one, run
  refarm plugin reload @local/<name> --json or restart the runtime.
  Dispatch verbs surface with scoped names: wallet:open becomes wallet-open.
  Inside refarm chat, /reload @local/<name> (or /r @local/<name>) is the interactive equivalent.
`,
);

extensionCommand
	.command("new <name>")
	.description("Scaffold a new local extension in .refarm/extensions/<name>/")
	.option("-g, --global", "Create in ~/.refarm/extensions/ (available in all projects)", false)
	.option("--verb <verb>", "Declare a dispatchable verb (bare 'open' -> <name>:open and surfaces as <name>-open)")
	.option("--json", "Output machine-readable created extension metadata")
	.action(async (name: string, options: { global: boolean; json?: boolean; verb?: string }) => {
		await newExtension(name, options.global, { json: options.json, verb: options.verb });
	});

	// `extension review` is declared once as a capability descriptor with
	// `transports.cli.group: "extension"`; the parent self-populates from the ONE
	// registry (via the group projector), so the same declaration drives the CLI
	// subcommand and the REPL `/review` slash with no hand-mount here.
	for (const command of capabilityCliCommandsForGroup("extension")) {
	extensionCommand.addCommand(command);
	}

	extensionCommand
	.command("list")
	.description("List local extensions in this project and globally")
	.option("--json", "Output machine-readable extension inventory")
	.action(listHandler);

	extensionCommand
	.command("save <name>")
	.description("Move a project extension to global scope (or vice versa)")
	.option("-g, --global", "Move from project to global scope", false)
	.option("-l, --local", "Move from global to project scope", false)
	.option("--json", "Output machine-readable move result")
	.action(async (name: string, options: { global: boolean; local: boolean; json?: boolean }) => {
		if (!options.global && !options.local) {
			if (options.json) {
				printJson(
					buildJsonErrorEnvelope({
						command: "extension",
						operation: "save",
						error: "missing-scope",
						message: "Specify --global or --local.",
						nextAction: `refarm extension save ${name} --global`,
						nextActions: [
							`refarm extension save ${name} --global`,
							`refarm extension save ${name} --local`,
						],
						nextCommand: extensionSaveCommand(name, "global", true),
						nextCommands: [
							extensionSaveCommand(name, "global", true),
							extensionSaveCommand(name, "local", true),
						],
						extra: {
							name,
							action: "save",
						},
					}),
				);
				process.exitCode = 1;
				return;
			}
			console.error("Specify --global (project→global) or --local (global→project)");
			process.exitCode = 1;
			return;
		}
		await saveExtension(name, options.global, { json: options.json });
	});

	extensionCommand
	.command("publish <name>")
	.description("Show the current path from a local extension to a plugin package")
	.option("--json", "Output machine-readable publish plan")
	.action((name: string, options: { json?: boolean }) => {
		const plan = publishExtensionPlan(name);
		if (options.json) {
			printJson(plan);
			process.exitCode = 1;
			return;
		}
		console.log(`Publishing local extension '${name}' is not automated yet.`);
		console.log("Current path:");
		console.log(`  1. Keep iterating locally: refarm extension list`);
		console.log(`  2. Apply changes:         ${extensionReloadCommand(name, true)}`);
		console.log("  3. Package WASM manually: refarm plugin bundle <plugin.wasm>");
		console.log("  4. Check runtime state:   refarm plugin status");
		process.exitCode = 1;
	});
