import chalk from "chalk";
import {
	isModuleResolutionError,
	renderBootstrapFailure,
} from "./bootstrap-preflight.js";
import { TokenAuthError } from "./credentials/token-auth-error.js";

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
	if (commandName !== "check") return false;

	const { checkCommand } = await import("./commands/check.js");
	await checkCommand.parseAsync(commandArgs, { from: "user" });
	return true;
}

export async function runCliMain(argv = process.argv): Promise<void> {
	try {
		if (await parseFastCommand(argv)) return;

		const { program } = await import("./program.js");
		await program.parseAsync(argv);
	} catch (err) {
		handleCliMainError(err);
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
