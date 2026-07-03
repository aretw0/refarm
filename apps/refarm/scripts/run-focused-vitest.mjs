#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const timeoutMs = Number.parseInt(
	process.env.REFARM_FOCUSED_VITEST_TIMEOUT_MS ?? "60000",
	10,
);

if (args.length === 0) {
	console.error("Usage: pnpm -C apps/refarm run test:file <test-file> [more files]");
	console.error("Refusing to run the full apps/refarm suite from the focused test entrypoint.");
	process.exit(2);
}

const result = spawnSync(
	"vitest",
	["run", "--maxWorkers=1", ...args],
	{
		stdio: "inherit",
		timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000,
		killSignal: "SIGTERM",
	},
);

if (result.error) {
	if (result.error.code === "ETIMEDOUT") {
		console.error(
			`Focused Vitest command exceeded ${timeoutMs}ms and was stopped.`,
		);
		process.exit(124);
	}
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);
