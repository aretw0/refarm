import chalk from "chalk";
import { isModuleResolutionError, renderBootstrapFailure } from "./bootstrap-preflight.js";
import { TokenAuthError } from "./credentials/token-auth-error.js";
import { renderActivityOnCli } from "./utils/activity-cli.js";
import { followActivityFile } from "./utils/activity-follow.js";

function terminalLink(text: string, url: string): string {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function renderTokenAuthError(err: TokenAuthError): void {
	const urlText = process.stderr.isTTY
		? terminalLink(chalk.cyan(err.rotationUrl), err.rotationUrl)
		: chalk.cyan(err.rotationUrl);
	process.stderr.write(chalk.red(`\n✗  ${err.message}\n`));
	process.stderr.write(chalk.dim("   Rotate at: ") + urlText + "\n");
}

async function parseFastCommand(argv: string[]): Promise<boolean> {
	const [, , commandName, ...commandArgs] = argv;
	if (commandName === "agent" && commandArgs[0] === "finish") {
		const { agentCommand } = await import("./commands/agent.js");
		await agentCommand.parseAsync(commandArgs, { from: "user" });
		return true;
	}
	if (commandName === "tidy") {
		const { tidyCommand } = await import("./commands/tidy.js");
		await tidyCommand.parseAsync(commandArgs, { from: "user" });
		return true;
	}
	if (commandName !== "check") return false;

	const { checkCommand } = await import("./commands/check.js");
	await checkCommand.parseAsync(commandArgs, { from: "user" });
	return true;
}

export async function runCliMain(argv = process.argv): Promise<void> {
	// Render the surface-neutral activity signal as a terminal spinner for the whole run,
	// so ANY command that wraps slow work in `withActivity` (a provider login, a git
	// clone, an agent turn) shows the operator that something is happening. Attached once
	// here; torn down in finally so it never outlives the command.
	const activity = renderActivityOnCli();
	// Also tail the daemon's activity file into the same sink, so work running in the
	// runtime (an agent turn, a dispatch) lights up this CLI's spinner too — the renderer
	// can't tell local `withActivity` work from remote daemon work.
	const activityFollower = followActivityFile();
	try {
		if (await parseFastCommand(argv)) return;

		const { program } = await import("./program.js");
		await program.parseAsync(argv);
	} catch (err) {
		handleCliMainError(err);
	} finally {
		activityFollower.stop();
		activity.stop();
	}
}

function handleCliMainError(err: unknown): void {
	if (err instanceof TokenAuthError) {
		renderTokenAuthError(err);
		process.exitCode = 1;
		return;
	}
	if (isModuleResolutionError(err)) {
		renderBootstrapFailure(err);
		process.exitCode = 1;
		return;
	}
	throw err;
}

if (!process.env.VITEST) {
	await runCliMain();
}
