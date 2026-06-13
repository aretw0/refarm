import chalk from "chalk";
import type { CollectContext, CredentialProvider } from "./types.js";
import { createStdioOperatorChannel } from "@refarm.dev/prompt-contract-v1";

const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

export const cloudflareCredentialProvider: CredentialProvider = {
	id: "cloudflare",
	label: "Cloudflare",

	async collect(ctx: CollectContext): Promise<string> {
		console.log(chalk.bold("\n  Cloudflare"));
		console.log(
			chalk.gray(
				"  Create an API Token with two permissions:",
			),
		);
		console.log(chalk.gray("    · Workers Scripts:Edit  (deploy Worker, manage secrets)"));
		console.log(chalk.gray("    · Workers R2 Storage:Edit  (create bucket, bind to Worker)"));
		console.log(chalk.cyan(`  → ${TOKEN_URL}\n`));
		ctx.tryOpenUrl(TOKEN_URL);

		const value = await (ctx.operator ?? createStdioOperatorChannel()).ask({
			type: "secret",
			question: "Paste the value",
			visibleTail: 4,
		});
		console.log(chalk.green("  ✓ Cloudflare — token received"));
		return value;
	},
};
