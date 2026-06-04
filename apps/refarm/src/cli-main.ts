import chalk from "chalk";
import { TokenAuthError } from "./credentials/token-auth-error.js";
import { program } from "./program.js";

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

program.parseAsync(process.argv).catch((err: unknown) => {
	if (err instanceof TokenAuthError) {
		renderTokenAuthError(err);
		process.exitCode = 1;
		return;
	}
	throw err;
});
