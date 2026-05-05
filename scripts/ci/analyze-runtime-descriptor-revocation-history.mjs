#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./runtime-descriptor-cli.mjs";
import {
	buildRuntimeDescriptorRevocationHistorySnapshot,
	renderRuntimeDescriptorRevocationHistoryMarkdown,
} from "./runtime-descriptor-revocation-report-lib.mjs";
import {
	evaluateHistoryFailurePolicy,
	loadNormalizedReports,
	resolveReportPaths,
} from "./runtime-descriptor-revocation-history-lib.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = process.cwd();
	const outDir = path.resolve(
		root,
		args["out-dir"] || ".artifacts/runtime-descriptor-revocation-history",
	);
	const outputJson = path.resolve(
		outDir,
		args["output-json"] || "history.json",
	);
	const outputMd = path.resolve(outDir, args["output-md"] || "history.md");

	const reportPaths = await resolveReportPaths({
		root,
		reports: args.reports,
		reportsFile: args["reports-file"],
		historyDir: args["history-dir"],
	});

	const reports = await loadNormalizedReports(reportPaths);
	const snapshot = buildRuntimeDescriptorRevocationHistorySnapshot(reports, {
		maxPoints: args["max-points"],
	});

	await mkdir(outDir, { recursive: true });
	await writeFile(outputJson, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
	await writeFile(
		outputMd,
		`${renderRuntimeDescriptorRevocationHistoryMarkdown(snapshot)}\n`,
		"utf8",
	);

	console.log(
		`[runtime-descriptor-revocation-history] history json: ${path.relative(root, outputJson)}`,
	);
	console.log(
		`[runtime-descriptor-revocation-history] history md: ${path.relative(root, outputMd)}`,
	);
	console.log(
		`[runtime-descriptor-revocation-history] reports analyzed: ${snapshot.reportsAnalyzed}`,
	);

	evaluateHistoryFailurePolicy(snapshot, args);
}

main().catch((error) => {
	console.error(
		`[runtime-descriptor-revocation-history] failed: ${error?.message ?? error}`,
	);
	process.exit(1);
});
