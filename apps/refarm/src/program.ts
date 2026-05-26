import { Command } from "commander";
import { actionsCommand } from "./commands/actions.js";
import { agentCommand } from "./commands/agent.js";
import { askCommand } from "./commands/ask.js";
import { chatCommand } from "./commands/chat.js";
import { checkCommand } from "./commands/check.js";
import { configCommand } from "./commands/config.js";
import { deployCommand } from "./commands/deploy.js";
import { doctorCommand } from "./commands/doctor.js";
import { extensionCommand } from "./commands/extension.js";
import { guideCommand } from "./commands/guide.js";
import { headlessCommand } from "./commands/headless.js";
import { healthCommand } from "./commands/health.js";
import { modelCommand } from "./commands/model.js";
import { openUrlCommand } from "./commands/open-url.js";
import { packageManagerCommand } from "./commands/package-manager.js";
import { pluginCommand } from "./commands/plugin.js";
import { provisionCommand } from "./commands/provision.js";
import { resolveRefarmVersion } from "./commands/runtime-metadata.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
} from "./commands/runtime-recovery.js";
import { runtimeCommand } from "./commands/runtime.js";
import { runSessionLaunchFlow, sessionCommand } from "./commands/session.js";
import { sessionsCommand } from "./commands/sessions.js";
import {
	SOW_COMMAND_DESCRIPTION,
	SOW_HELP_TEXT,
	SOW_MODEL_OPTION_DESCRIPTION,
} from "./commands/sow-metadata.js";
import { statusCommand } from "./commands/status.js";
import { taskCommand } from "./commands/task.js";
import { tasksCommand } from "./commands/tasks.js";
import { telemetryCommand } from "./commands/telemetry.js";
import { tidyCommand } from "./commands/tidy.js";
import { treeCommand } from "./commands/tree.js";
import { tuiCommand } from "./commands/tui.js";
import { webCommand } from "./commands/web.js";
import { defaultProviderModelRef } from "./model-routing.js";

export const program = new Command();

const OPENAI_DEFAULT_REF = defaultProviderModelRef("openai");

interface LazyCommandOption {
	flags: string;
	description: string;
}

interface LazyCommandConfig<TOptions extends Record<string, unknown>> {
	name: string;
	description: string;
	argument?: { flags: string; description: string; defaultValue?: string };
	options?: LazyCommandOption[];
	helpText?: string;
	load: () => Promise<Command>;
	toArgs: (argument: string | undefined, options: TOptions) => string[];
}

function createLazyCommand<TOptions extends Record<string, unknown>>(
	config: LazyCommandConfig<TOptions>,
): Command {
	const command = new Command(config.name).description(config.description);
	if (config.argument) {
		command.argument(
			config.argument.flags,
			config.argument.description,
			config.argument.defaultValue,
		);
	}
	for (const option of config.options ?? []) {
		command.option(option.flags, option.description);
	}
	if (config.helpText) {
		command.addHelpText("after", config.helpText);
	}
	return command.action(async (...actionArgs: unknown[]) => {
		const invokedCommand = actionArgs.at(-1) as Command;
		const argument = config.argument ? (actionArgs[0] as string | undefined) : undefined;
		const opts = invokedCommand.opts<TOptions>();
		const loaded = await config.load();
		await loaded.parseAsync(config.toArgs(argument, opts), { from: "user" });
	});
}

program
	.name("refarm")
	.description("Refarm CLI")
	.version(resolveRefarmVersion())
	.addHelpText(
		"after",
		[
			"",
			"Common workflows:",
			"  $ refarm                         Start or resume the interactive agent session",
			"  $ refarm ask \"hello\"             Send one prompt and exit",
			"  $ refarm sow                     Configure credentials and model provider",
			"  $ refarm runtime                 Inspect selected runtime engine and autostart",
			"  $ refarm health                  Audit project structure and package alignment",
			"  $ refarm check --next-action     Print the next blocking recovery action",
			"  $ refarm check --next-command    Print the next executable recovery command",
			"  $ refarm tidy imports --check    Check import organization on changed files",
			"  $ refarm package-manager --json  Inspect detected npm/pnpm/yarn/bun launcher",
			"  $ refarm agent finish --next-command Print the next end-of-slice command",
			"  $ refarm agent finish --profile affected --run Verify changed workspaces",
			"  $ refarm agent finish --profile affected --since upstream --run Verify branch changes",
			"  $ refarm agent finish --fix --run Organize imports, then verify",
			"  $ refarm agent finish --profile package --workspace apps/refarm --run",
			"  $ refarm doctor                  Diagnose host/runtime readiness",
			"",
			"Runtime controls:",
			`  $ ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}`,
			`  $ ${RUNTIME_ENGINE_AUTO_COMMAND}`,
			"  $ refarm model current",
			`  $ refarm model ${OPENAI_DEFAULT_REF}`,
			"  $ refarm model base-url http://127.0.0.1:8000",
			"",
			"Inside the interactive session, use /help for /model, /login, /reload, and session commands.",
		].join("\n"),
	)
	.action(async () => {
		await runSessionLaunchFlow();
	});

program.addCommand(
	createLazyCommand<{ force?: boolean }>({
		name: "init",
		description: "Initialize a new Refarm workspace",
		argument: { flags: "[name]", description: "Project name", defaultValue: "my-workspace" },
		options: [
			{
				flags: "--force",
				description: "Reinitialize even if already initialized (destructive)",
			},
		],
		helpText: `

Examples:
  $ refarm init my-workspace
  $ refarm init .
  $ refarm init my-workspace --force

Notes:
  This creates refarm.config.json and .refarm/identity.json.
  The workspace identity is metadata; operator credentials are saved later
  under ~/.refarm/identity.json by refarm sow.
  --force reinitializes an existing workspace and can overwrite generated metadata.
  After init, run refarm sow to configure model credentials.
  Use refarm model current to inspect the default route, and refarm guide
  to generate a local setup audit with GitHub/Cloudflare next steps.
`,
		load: async () => (await import("./commands/init.js")).initCommand,
		toArgs: (name, opts) => [
			name ?? "my-workspace",
			...(opts.force ? ["--force"] : []),
		],
	}),
);
program.addCommand(
	createLazyCommand<{
		model?: string;
		github?: boolean;
		cloudflare?: boolean;
		all?: boolean;
		json?: boolean;
	}>({
		name: "sow",
		description: SOW_COMMAND_DESCRIPTION,
		options: [
			{ flags: "--model <ref>", description: SOW_MODEL_OPTION_DESCRIPTION },
			{ flags: "--github", description: "Configure GitHub credentials" },
			{ flags: "--cloudflare", description: "Configure Cloudflare credentials" },
			{ flags: "--all", description: "Configure or reconfigure all credentials" },
			{ flags: "--json", description: "Output machine-readable sow result" },
		],
		helpText: SOW_HELP_TEXT,
		load: async () => (await import("./commands/sow.js")).sowCommand,
		toArgs: (_unused, opts) => [
			...(opts.model ? ["--model", opts.model] : []),
			...(opts.github ? ["--github"] : []),
			...(opts.cloudflare ? ["--cloudflare"] : []),
			...(opts.all ? ["--all"] : []),
			...(opts.json ? ["--json"] : []),
		],
	}),
);
program.addCommand(provisionCommand);
program.addCommand(guideCommand);
program.addCommand(checkCommand);
program.addCommand(configCommand);
program.addCommand(healthCommand);
program.addCommand(modelCommand);
program.addCommand(webCommand);
program.addCommand(tuiCommand);
program.addCommand(headlessCommand);
program.addCommand(
	createLazyCommand<{ target?: string; dryRun?: boolean; json?: boolean }>({
		name: "migrate",
		description: "Mirror your project to another Git remote",
		options: [
			{ flags: "--target <url>", description: "Target Git URL for mirroring" },
			{ flags: "--dry-run", description: "Simulate the migration without pushing" },
			{ flags: "--json", description: "Output machine-readable migration result" },
		],
		helpText: `

Examples:
  $ refarm migrate --target https://github.com/user/fork.git --dry-run
  $ refarm migrate --target https://github.com/user/fork.git --dry-run --json
  $ refarm migrate --target git@github.com:user/fork.git

Notes:
  This mirrors the current repository to another Git remote.
  Use --dry-run first; live migration may push the full repository.
  The source remote is read from refarm.config.json or .git/config.
`,
		load: async () => (await import("./commands/migrate.js")).migrateCommand,
		toArgs: (_unused, opts) => [
			...(opts.target ? ["--target", opts.target] : []),
			...(opts.dryRun ? ["--dry-run"] : []),
			...(opts.json ? ["--json"] : []),
		],
	}),
);
program.addCommand(deployCommand);
program.addCommand(doctorCommand);
program.addCommand(packageManagerCommand);
program.addCommand(pluginCommand);
program.addCommand(extensionCommand);
program.addCommand(agentCommand);
program.addCommand(openUrlCommand);
program.addCommand(actionsCommand);
program.addCommand(statusCommand);
program.addCommand(runtimeCommand);
program.addCommand(taskCommand);
program.addCommand(sessionCommand);
program.addCommand(chatCommand);
program.addCommand(askCommand);
program.addCommand(sessionsCommand);
program.addCommand(tasksCommand);
program.addCommand(telemetryCommand);
program.addCommand(tidyCommand);
program.addCommand(treeCommand);
