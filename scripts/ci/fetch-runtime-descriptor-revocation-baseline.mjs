#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "./runtime-descriptor-cli.mjs";
import { runRevocationBaselineResolution } from "./runtime-descriptor-revocation-baseline-fetch-lib.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = process.cwd();
	const { config, metadata, baselineSummaryPath } =
		await runRevocationBaselineResolution({
			args,
			root,
			env: process.env,
		});

	console.log(
		`[runtime-descriptor-revocation-baseline] metadata: ${path.relative(root, config.outputJson)}`,
	);
	if (baselineSummaryPath) {
		console.log(
			`[runtime-descriptor-revocation-baseline] baseline summary: ${path.relative(
				root,
				baselineSummaryPath,
			)}`,
		);
	} else {
		console.log(
			`[runtime-descriptor-revocation-baseline] baseline missing: ${metadata.reason || "unknown reason"}`,
		);
	}
	if (config.reportsFile) {
		console.log(
			`[runtime-descriptor-revocation-baseline] reports file: ${path.relative(root, config.reportsFile)}`,
		);
	}

	if (config.required && !baselineSummaryPath) {
		throw new Error(
			`baseline required but unavailable (${metadata.reason || "unknown reason"})`,
		);
	}
}

main().catch((error) => {
	console.error(
		`[runtime-descriptor-revocation-baseline] failed: ${error?.message ?? error}`,
	);
	process.exit(1);
});
