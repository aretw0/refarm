import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import {
	RUNTIME_AGENT_NPM_PACKAGE,
} from "@refarm.dev/config/plugin-identity";
import { Command } from "commander";
import {
	PACKAGE_MANAGER_OVERRIDE,
	PACKAGE_MANAGERS,
} from "./package-manager.js";
import { bundlePluginAction } from "./plugin-bundle.js";
import { installBundledPlugins } from "./plugin-install.js";
import {
	listInstalledPlugins,
	printRuntimePluginStatus,
	reloadRuntimePluginCommand,
} from "./plugin-runtime.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";

const PACKAGE_MANAGER_OVERRIDE_HELP = PACKAGE_MANAGERS.join("|");
const PLUGIN_RELOAD_RESTART_RUNTIME_AGENT_JSON_COMMAND = refarmCommand([
	"plugin",
	"reload",
	"agent",
	"--restart-if-needed",
	"--wait",
	"--json",
]);

export const pluginCommand = new Command("plugin").description(
	"Manage refarm plugins",
).addHelpText(
	"after",
	[
		"",
		"Examples:",
		"  $ refarm plugin status",
		"  $ refarm plugin status --json",
		"  $ refarm plugin reload agent --json",
		"  $ refarm plugin install",
		"  $ refarm plugin list",
		"  $ refarm plugin list --json",
		"  $ refarm plugin bundle ./plugin.wasm --name my-plugin",
		"  $ refarm",
		"",
	"Notes:",
	"  Install writes bundled plugin artifacts into $REFARM_HOME/plugins, or ~/.refarm/plugins when REFARM_HOME is unset.",
	`  Status reads the active Refarm runtime; ensure it with ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND} if unavailable.`,
	`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
	`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
	"  refarm ask preflights the runtime agent plugin and asks the runtime to reload it when installed but not loaded.",
	"  In refarm chat, /reload agent or /r agent is the interactive equivalent.",
	].join("\n"),
);

pluginCommand
	.command("install")
	.description("Install (or force-reinstall) all bundled plugins from their npm packages")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin install",
			"  $ refarm plugin install --json",
			"  $ refarm plugin install --force",
			"",
			"Notes:",
			`  If the bundled runtime agent WASM is missing, build ${RUNTIME_AGENT_NPM_PACKAGE} first with the command printed by the error.`,
			"  After install, start or restart the runtime, then run refarm plugin reload agent --json.",
		"  In refarm chat, /reload agent or /r agent is the interactive equivalent.",
			"  Run refarm plugin status to confirm runtime load state.",
		].join("\n"),
	)
	.option("-f, --force", "Reinstall even if already up-to-date", false)
	.option("--json", "Output machine-readable install report")
	.action(async (options: { force: boolean; json?: boolean }) => {
		await installBundledPlugins({
			force: options.force,
			json: options.json,
			heading: "Installing bundled plugins...",
		});
	});

pluginCommand
	.command("update")
	.description("Update bundled plugins when a newer npm package version is available")
	.option("--json", "Output machine-readable update report")
	.action(async (options: { json?: boolean }) => {
		await installBundledPlugins({
			force: false,
			json: options.json,
			heading: "Checking bundled plugins for updates...",
		});
	});

pluginCommand
	.command("list")
	.description("List installed plugins and their versions")
	.option("--json", "Output machine-readable plugin inventory")
	.action(listInstalledPlugins);

pluginCommand
	.command("status")
	.description("Show runtime plugin install/load state")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin status",
			"  $ refarm plugin status --json",
			"  $ refarm plugin reload agent --json",
			`  $ ${RUNTIME_STATUS_COMMAND}`,
			"  $ refarm",
			"",
			"Notes:",
			"  This command requires the selected Refarm runtime sidecar.",
			`  Use ${RUNTIME_STATUS_COMMAND} to see the selected engine and readiness.`,
			`  Ensure it with ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}.`,
			`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
			`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
		"  In refarm chat, /reload agent or /r agent is the interactive equivalent.",
		].join("\n"),
	)
	.option("--json", "Output machine-readable runtime plugin state")
	.action(printRuntimePluginStatus);

pluginCommand
	.command("reload [pluginIds...]")
	.description("Ask the running Refarm runtime to hot-reload plugins")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin reload",
			"  $ refarm plugin reload agent",
			"  $ refarm plugin reload agent --json",
			`  $ ${PLUGIN_RELOAD_RESTART_RUNTIME_AGENT_JSON_COMMAND}`,
			"",
			"Notes:",
		"  This is the non-interactive equivalent of /reload (or /r) in refarm chat.",
			"  Hot reload is attempted first; runtime restart only happens with --restart-if-needed.",
			"  Polling timeout is controlled by REFARM_PLUGIN_RELOAD_MAX_WAIT_MS (default 120000ms).",
			`  Use ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND} if the runtime is not running.`,
		].join("\n"),
	)
	.option("--json", "Output machine-readable reload result")
	.option("--restart-if-needed", "Restart the runtime when hot reload is not supported")
	.option("--wait", "Wait for runtime readiness after --restart-if-needed")
	.action(reloadRuntimePluginCommand);

pluginCommand
	.command("bundle <input>")
	.description("Transpile a WASM plugin to a JS component using jco transpile")
	.option("-o, --output <dir>", "Output directory", "./dist")
	.option("-n, --name <name>", "Plugin name (defaults to input filename without extension)")
	.option("--dry-run", "Print the plugin bundle plan without executing it")
	.option("--json", "Output machine-readable bundle plan or result")
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm plugin bundle ./plugin.wasm",
			"  $ refarm plugin bundle ./plugin.wasm --dry-run --json",
			"  $ refarm plugin bundle ./plugin.wasm --name my-plugin --output ./dist",
			`  $ ${PACKAGE_MANAGER_OVERRIDE}=npm refarm plugin bundle ./plugin.wasm`,
			"",
			"Notes:",
			"  This command runs jco through the detected package manager.",
			"  Refarm maps this to pnpm exec, npm exec --, yarn, or bun x",
			"  based on the project packageManager field or lockfile.",
			"  Override detection with",
			`  ${PACKAGE_MANAGER_OVERRIDE}=${PACKAGE_MANAGER_OVERRIDE_HELP}.`,
		].join("\n"),
	)
	.action(bundlePluginAction);
