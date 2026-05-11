import chalk from "chalk";
import type { CollectContext, CredentialProvider } from "./types.js";
import { secretInput } from "../prompts/secret-input.js";

const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

export const cloudflareCredentialProvider: CredentialProvider = {
	id: "cloudflare",
	label: "Cloudflare",

	async collect(ctx: CollectContext): Promise<string> {
		console.log(chalk.bold("\n  Cloudflare"));
		console.log(
			chalk.gray(
				"  Create an API Token with Workers Scripts:Edit and R2:Edit permissions.",
			),
		);
		console.log(chalk.cyan(`  → ${TOKEN_URL}\n`));
		ctx.tryOpenUrl(TOKEN_URL);

		const value = await secretInput({ message: "Paste the value:" });
		console.log(chalk.green("  ✓ Cloudflare — token received"));
		return value;
	},
};
