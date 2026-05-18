import { Command } from "commander";
import { actionsCommand } from "./commands/actions.js";
import { agentCommand } from "./commands/agent.js";
import { resolveRefarmVersion } from "./commands/runtime-metadata.js";
import { askCommand } from "./commands/ask.js";
import { chatCommand } from "./commands/chat.js";
import { sessionCommand, runSessionLaunchFlow } from "./commands/session.js";
import { sessionsCommand } from "./commands/sessions.js";
import { deployCommand } from "./commands/deploy.js";
import { doctorCommand } from "./commands/doctor.js";
import { guideCommand } from "./commands/guide.js";
import { headlessCommand } from "./commands/headless.js";
import { healthCommand } from "./commands/health.js";
import { openUrlCommand } from "./commands/open-url.js";
import { extensionCommand } from "./commands/extension.js";
import { pluginCommand } from "./commands/plugin.js";
import { provisionCommand } from "./commands/provision.js";
import { statusCommand } from "./commands/status.js";
import { taskCommand } from "./commands/task.js";
import { tasksCommand } from "./commands/tasks.js";
import { tuiCommand } from "./commands/tui.js";
import { telemetryCommand } from "./commands/telemetry.js";
import { treeCommand } from "./commands/tree.js";
import { webCommand } from "./commands/web.js";

export const program = new Command();

interface LazyCommandOption {
	flags: string;
	description: string;
}

interface LazyCommandConfig<TOptions extends Record<string, unknown>> {
	name: string;
	description: string;
	argument?: { flags: string; description: string; defaultValue?: string };
	options?: LazyCommandOption[];
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
	.action(async () => {
		await runSessionLaunchFlow();
	});

program.addCommand(
	createLazyCommand<{ force?: boolean }>({
		name: "init",
		description: "Initialize a new farm",
		argument: { flags: "[name]", description: "Project name", defaultValue: "my-farm" },
		options: [
			{
				flags: "--force",
				description: "Reinitialize even if already initialized (destructive)",
			},
		],
		load: async () => (await import("./commands/init.js")).initCommand,
		toArgs: (name, opts) => [
			name ?? "my-farm",
			...(opts.force ? ["--force"] : []),
		],
	}),
);
program.addCommand(
	createLazyCommand<{
		model?: boolean;
		github?: boolean;
		cloudflare?: boolean;
		all?: boolean;
	}>({
		name: "sow",
		description: "Configure refarm credentials (default: model provider only)",
		options: [
			{ flags: "--model", description: "Reconfigure the model provider" },
			{ flags: "--github", description: "Configure GitHub credentials" },
			{ flags: "--cloudflare", description: "Configure Cloudflare credentials" },
			{ flags: "--all", description: "Configure or reconfigure all credentials" },
		],
		load: async () => (await import("./commands/sow.js")).sowCommand,
		toArgs: (_unused, opts) => [
			...(opts.model ? ["--model"] : []),
			...(opts.github ? ["--github"] : []),
			...(opts.cloudflare ? ["--cloudflare"] : []),
			...(opts.all ? ["--all"] : []),
		],
	}),
);
program.addCommand(provisionCommand);
program.addCommand(guideCommand);
program.addCommand(healthCommand);
program.addCommand(webCommand);
program.addCommand(tuiCommand);
program.addCommand(headlessCommand);
program.addCommand(
	createLazyCommand<{ target?: string; dryRun?: boolean }>({
		name: "migrate",
		description: "Activate the Escape Hatch: Mirror your project to a sovereign target",
		options: [
			{ flags: "--target <url>", description: "Target Git URL for mirroring" },
			{ flags: "--dry-run", description: "Simulate the migration without pushing" },
		],
		load: async () => (await import("./commands/migrate.js")).migrateCommand,
		toArgs: (_unused, opts) => [
			...(opts.target ? ["--target", opts.target] : []),
			...(opts.dryRun ? ["--dry-run"] : []),
		],
	}),
);
program.addCommand(deployCommand);
program.addCommand(doctorCommand);
program.addCommand(pluginCommand);
program.addCommand(extensionCommand);
program.addCommand(agentCommand);
program.addCommand(openUrlCommand);
program.addCommand(actionsCommand);
program.addCommand(statusCommand);
program.addCommand(taskCommand);
program.addCommand(sessionCommand);
program.addCommand(chatCommand);
program.addCommand(askCommand);
program.addCommand(sessionsCommand);
program.addCommand(tasksCommand);
program.addCommand(telemetryCommand);
program.addCommand(treeCommand);
