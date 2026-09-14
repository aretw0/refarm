import { Command } from "commander";
import { actionsCommand } from "./commands/actions.js";
import { agentCommand } from "./commands/agent.js";
import { askCommand } from "./commands/ask.js";
import { authCommand } from "./commands/auth.js";
import { backupCommand } from "./commands/backup.js";
import { budgetCommand } from "./commands/budget.js";
import { capabilitiesCommand } from "./commands/capabilities.js";
import { capabilityCliCommands } from "./commands/capability-registry.js";
import { createCertCommand } from "./commands/cert.js";
import { chatCommand } from "./commands/chat.js";
import { checkCommand } from "./commands/check.js";
import { configCommand } from "./commands/config.js";
import { configureCommand } from "./commands/configure.js";
import { connectionCommand } from "./commands/connection.js";
import { contextCommand } from "./commands/context.js";
import { credentialCommand } from "./commands/credential.js";
import { deliveryCommand } from "./commands/delivery-command.js";
import { deployCommand } from "./commands/deploy.js";
import { discoverCommand } from "./commands/discover.js";
import { distCommand } from "./commands/dist.js";
import { doctorCommand } from "./commands/doctor.js";
import { guideCommand } from "./commands/guide.js";
import { hardeningCommand } from "./commands/hardening.js";
import { headlessCommand } from "./commands/headless.js";
import { inspectCommand } from "./commands/inspect.js";
import { intentionCommand } from "./commands/intention.js";
import { issuesCommand } from "./commands/issues.js";
import { lintCommand } from "./commands/lint.js";
import { nodeCommand } from "./commands/node.js";
import { openUrlCommand } from "./commands/open-url.js";
import { packageManagerCommand } from "./commands/package-manager.js";
import { parityCommand } from "./commands/parity.js";
import { extensionCommand } from "./commands/plugin-local.js";
import { createProcessCommand } from "./commands/process.js";
import { projectCommand } from "./commands/project.js";
import { provisionCommand } from "./commands/provision.js";
import { releaseCommand } from "./commands/release.js";
import { requirementsCommand } from "./commands/requirements.js";
import { resumeCommand } from "./commands/resume.js";
import { resolveRefarmVersion } from "./commands/runtime-metadata.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
} from "./commands/runtime-recovery.js";
import { runtimeCommand } from "./commands/runtime.js";
import { serveCommand } from "./commands/serve-capability.js";
import { runSessionLaunchFlow, sessionCommand } from "./commands/session.js";
import { sessionsCommand } from "./commands/sessions.js";
import {
	SOW_COMMAND_DESCRIPTION,
	SOW_HELP_TEXT,
	SOW_MODEL_OPTION_DESCRIPTION,
} from "./commands/sow-metadata.js";
import { statusCommand } from "./commands/status.js";
import { createSurfaceCommand } from "./commands/surface.js";
import { taskCommand } from "./commands/task.js";
import { tasksCommand } from "./commands/tasks.js";
import { telemetryCommand } from "./commands/telemetry.js";
import { tidyCommand } from "./commands/tidy.js";
import { createToolsCommand } from "./commands/tools-command.js";
import { treeCommand } from "./commands/tree.js";
import { tuiCommand } from "./commands/tui.js";
import { webCommand } from "./commands/web.js";
import { workspaceCommand } from "./commands/workspace.js";
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
			'  $ refarm ask "hello"             Send one prompt and exit',
			"  $ refarm resume                  Show runtime and worker resume hints",
			"  $ refarm sow                     Configure credentials and model provider",
			"  $ refarm runtime                 Inspect selected runtime engine and autostart",
			"  $ refarm health                  Audit project structure and package alignment",
			"  $ refarm check --next-action     Print the next blocking recovery action",
			"  $ refarm check --next-command    Print the next executable recovery command",
			"  $ refarm tidy imports --check    Check import organization on changed files",
			"  $ refarm package-manager --json  Inspect detected npm/pnpm/yarn/bun launcher",
			"  $ refarm workspace execution --json Inspect workspace executor/cache readiness",
			"  $ refarm connection status --json Probe declared connections (VPN tunnels, sessions)",
			"  $ refarm intention check --profile cross-device-handoff --json Inspect explicit operator intent",
			"  $ refarm capabilities --json List compact capability descriptors for consumers",
			"  $ refarm project handoff validate --json Validate durable project handoff state",
			"  $ refarm release preflight --selection default --json Inspect release candidates and supply posture",
			"  $ refarm agent --next-command    Print the first agent handoff command",
			"  $ refarm agent finish --next-command Print the next end-of-slice command",
			"  $ refarm agent finish --lane after-edit --run --json Verify changed workspaces",
			"  $ refarm agent finish --lane before-push --run --json Verify branch changes",
			"  $ refarm agent finish --lane handoffs --run --json Verify JSON handoff contracts",
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
			"Inside the interactive session, use /help for /model, /login, /reload, /clear, /cls, and session commands.",
		].join("\n"),
	)
	.action(async () => {
		await runSessionLaunchFlow();
	});

/**
 * THE LAST MILE — declared delivery is brought up once, before any command runs.
 *
 * This is the only place in the CLI that knows delivery exists, and it is here
 * rather than in a wizard because of D5: *"a wizard author writes nothing about
 * delivery"*. `installDeclaredDelivery` declares where this process publishes its
 * questions; every `createStdioOperatorChannel()` built afterwards — in `auth`,
 * in `init`, in `sow`, in anything not yet written — is peered with the declared
 * channels automatically. Not one of them changes, and none can tell.
 *
 * Three things keep this honest:
 *
 *  - **undeclared is inert (D1)**: with no `delivery` block the install returns
 *    before the adapter registry is even imported, and nothing is installed, so
 *    prompts run the identical code path they ran before this hook existed;
 *  - **it can never break a command (D4)**: the whole call is contained, and a
 *    failure to arrange notification is reported on stderr, never raised into
 *    the command the operator actually ran;
 *  - **the dynamic import** keeps the delivery graph out of CLI startup for the
 *    invocations (the vast majority) that never mount anything.
 */
program.hook("preAction", async (_thisCommand, actionCommand) => {
	try {
		const { askerForCommandPath, installDeclaredDelivery } =
			await import("./commands/delivery-mount.js");
		const argvPath: string[] = [];
		for (let node: Command | null = actionCommand; node && node.parent; node = node.parent) {
			argvPath.unshift(node.name());
		}
		await installDeclaredDelivery({
			asker: askerForCommandPath(argvPath),
			// A TERMINAL IS READING THIS. Measured 2026-08-19: every prompt of `refarm process add`
			// was preceded by "a question is waiting and could not be delivered", written into the
			// prompt line. The notice exists for the case where nobody is looking; repeating it at
			// someone who is reading the question teaches them to read past it.
			attendedLocally: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
		});
	} catch (error) {
		// Notification is never the reason a command does not run.
		process.stderr.write(
			`refarm delivery: could not bring up declared delivery (${
				error instanceof Error ? error.message : String(error)
			})\n`,
		);
	}
});

program.addCommand(
	createLazyCommand<{ force?: boolean; json?: boolean; template?: string }>({
		name: "init",
		description: "Initialize a new Refarm workspace",
		argument: {
			flags: "[name]",
			description: "Project name",
			defaultValue: "my-workspace",
		},
		options: [
			{
				flags: "--force",
				description: "Reinitialize even if already initialized (destructive)",
			},
			{ flags: "--json", description: "Output machine-readable initialization result" },
			{ flags: "--template <id>", description: "Template to scaffold without prompting" },
		],
		helpText: `

Examples:
  $ refarm init my-workspace
  $ refarm init .
  $ refarm init my-workspace --force

Notes:
  This creates .refarm/config.json and .refarm/identity.json.
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
			...(opts.json ? ["--json"] : []),
			...(opts.template ? ["--template", opts.template] : []),
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
		reconfigure?: boolean;
		modelProvider?: string;
		alias?: string;
	}>({
		name: "sow",
		description: SOW_COMMAND_DESCRIPTION,
		options: [
			{ flags: "--model <ref>", description: SOW_MODEL_OPTION_DESCRIPTION },
			{ flags: "--github", description: "Configure GitHub credentials" },
			{
				flags: "--cloudflare",
				description: "Configure Cloudflare credentials",
			},
			{
				flags: "--all",
				description: "Configure or reconfigure all credentials",
			},
			{
				flags: "--reconfigure",
				description: "Reconfigure model credentials even if already configured",
			},
			{
				flags: "--model-provider <id>",
				description: "Configure this model provider directly, skipping the picker (e.g. openai-codex)",
			},
			{
				flags: "--alias <name>",
				description: "Name this account (unique per provider; renameable later)",
			},
			{ flags: "--json", description: "Output machine-readable sow result" },
		],
		helpText: SOW_HELP_TEXT,
		load: async () => (await import("./commands/sow.js")).sowCommand,
		toArgs: (_unused, opts) => [
			...(opts.model ? ["--model", opts.model] : []),
			...(opts.github ? ["--github"] : []),
			...(opts.cloudflare ? ["--cloudflare"] : []),
			...(opts.all ? ["--all"] : []),
			...(opts.reconfigure ? ["--reconfigure"] : []),
			...(opts.modelProvider ? ["--model-provider", opts.modelProvider] : []),
			...(opts.alias ? ["--alias", opts.alias] : []),
			...(opts.json ? ["--json"] : []),
		],
	}),
);
program.addCommand(backupCommand);
program.addCommand(nodeCommand);
program.addCommand(credentialCommand);
program.addCommand(provisionCommand);
program.addCommand(guideCommand);
program.addCommand(hardeningCommand);
program.addCommand(checkCommand);
program.addCommand(lintCommand);
program.addCommand(configCommand);
program.addCommand(configureCommand);
program.addCommand(releaseCommand);
program.addCommand(distCommand);
program.addCommand(authCommand);
// The door the browser surface needs: `crypto.subtle` refuses to exist outside a
// secure context, so `/attend` and `/auth/verify` cannot work over plain http off
// localhost. `refarm cert` is how the operator opens it without depending on anyone.
program.addCommand(createCertCommand());
// Capability verbs (health, model, skill, …) are derived from the ONE capability
// registry — the same registry the REPL slashes derive from — so a verb declared
// (and, later, plugin-contributed) once lights up on the CLI and the REPL without
// a second hand-mount here.
for (const command of capabilityCliCommands()) {
	program.addCommand(command);
}
program.addCommand(webCommand);
program.addCommand(discoverCommand);
program.addCommand(serveCommand);
program.addCommand(workspaceCommand);
program.addCommand(connectionCommand);
program.addCommand(deliveryCommand);
// The tools this node depends on but does not ship — declared here, measured by `health`.
program.addCommand(createToolsCommand());
program.addCommand(budgetCommand);
program.addCommand(createSurfaceCommand());
// The long-running processes refarm OWNS: declared in `.refarm/config.json`, supervised by the
// host's own supervisor. Before this, `refarm web serve` ran under a nohup'd shell — the operator
// rebooted, it went away, and nothing said so.
program.addCommand(createProcessCommand());
program.addCommand(intentionCommand);
program.addCommand(inspectCommand);
program.addCommand(tuiCommand);
program.addCommand(headlessCommand);
program.addCommand(
	createLazyCommand<{ target?: string; dryRun?: boolean; json?: boolean }>({
		name: "migrate",
		description: "Mirror your project to another Git remote",
		options: [
			{ flags: "--target <url>", description: "Target Git URL for mirroring" },
			{
				flags: "--dry-run",
				description: "Simulate the migration without pushing",
			},
			{
				flags: "--json",
				description: "Output machine-readable migration result",
			},
		],
		helpText: `

Examples:
  $ refarm migrate --target https://github.com/user/fork.git --dry-run
  $ refarm migrate --target https://github.com/user/fork.git --dry-run --json
  $ refarm migrate --target git@github.com:user/fork.git

Notes:
  This mirrors the current repository to another Git remote.
  Use --dry-run first; live migration may push the full repository.
  The source remote is read from .refarm/config.json or .git/config.
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
program.addCommand(contextCommand);
program.addCommand(parityCommand);
program.addCommand(packageManagerCommand);
program.addCommand(capabilitiesCommand);
program.addCommand(projectCommand);
program.addCommand(issuesCommand);
program.addCommand(requirementsCommand);
program.addCommand(extensionCommand);
program.addCommand(agentCommand);
program.addCommand(openUrlCommand);
program.addCommand(actionsCommand);
program.addCommand(resumeCommand);
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
