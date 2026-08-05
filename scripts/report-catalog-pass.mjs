#!/usr/bin/env node
/**
 * Print the ONE human line the model-rate-catalog pass produced, reading a
 * `refarm plugin update --json` envelope on stdin. Prints nothing when there is
 * nothing to say (the ordinary `kept` start), and nothing on any error.
 *
 * WHY THIS EXISTS. `tractor-start.sh` runs `plugin update --json >/dev/null 2>&1`
 * before every daemon start — the pass that materialises the rate catalog into the
 * sovereign dir rides along, and its result went straight to /dev/null. So a node
 * that could not be given a catalog (and prices from the agent's built-in table
 * instead of the audited artifact), or one holding back a newer catalog because
 * someone edited the local copy, was visible ONLY to whoever thought to run
 * `refarm plugin update --json` by hand. The human starting their node — the one
 * person who can act on it — saw nothing. This is the ~10 lines that fixes that.
 *
 * Like `resolve-boot-plugins.mjs`, this is a thin shell↔TS bridge: it imports the
 * COMPILED `describeModelRateCatalog` rather than re-wording the message here, so
 * the sentence an operator reads has exactly one source.
 *
 * Usage: node "$REFARM_CLI" plugin update --json | node scripts/report-catalog-pass.mjs
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
	const raw = (await readStdin()).trim();
	if (!raw) return;

	const envelope = JSON.parse(raw);
	const result = envelope?.modelRateCatalog;
	if (!result || typeof result.status !== "string") return;

	const here = path.dirname(new URL(import.meta.url).pathname);
	const distModule = path.resolve(
		here,
		"..",
		"apps",
		"refarm",
		"dist",
		"commands",
		"model-rate-catalog.js",
	);
	const { describeModelRateCatalog } = await import(pathToFileURL(distModule).href);

	const line = describeModelRateCatalog(result);
	if (line) process.stdout.write(`${line}\n`);
}

main().catch(() => {
	// A start script must never be blocked by its own reporting. Silence here means the
	// operator is exactly as informed as they were before this file existed.
	process.exitCode = 0;
});
