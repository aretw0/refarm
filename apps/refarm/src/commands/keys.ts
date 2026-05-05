import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Command } from "commander";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const KEYS_SCRIPT = path.join(ROOT, "scripts/setup-llm-keys.mjs");

export const keysCommand = new Command("keys")
	.description("Configure LLM provider API keys (stored in .refarm/.env)")
	.option("--status", "Show current key status without making changes")
	.action((opts: { status?: boolean }) => {
		const args = opts.status ? ["--status"] : [];
		const result = spawnSync(process.execPath, [KEYS_SCRIPT, ...args], {
			stdio: "inherit",
		});
		if (result.status !== null && result.status !== 0) {
			process.exitCode = result.status;
		}
	});
