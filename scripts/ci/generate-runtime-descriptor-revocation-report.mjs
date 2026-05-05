#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./runtime-descriptor-cli.mjs";
import {
	buildRuntimeDescriptorRevocationReport,
	hasAlertAtOrAbove,
	normalizeRevocationEventsInput,
	renderRevocationReportMarkdown,
} from "./runtime-descriptor-revocation-report-lib.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = process.cwd();
	const inputPath = args.input ? path.resolve(root, args.input) : null;
	const outDir = path.resolve(
		root,
		args["out-dir"] || ".artifacts/runtime-descriptor-revocation-report",
	);
	const outputJson = path.resolve(
		outDir,
		args["output-json"] || "summary.json",
	);
	const outputMd = path.resolve(outDir, args["output-md"] || "summary.md");
	const failOnSeverity =
		typeof args["fail-on-severity"] === "string"
			? args["fail-on-severity"]
			: "";

	let events = [];
	if (inputPath) {
		const raw = JSON.parse(await readFile(inputPath, "utf8"));
		events = normalizeRevocationEventsInput(raw);
	}

	const report = buildRuntimeDescriptorRevocationReport({
		inputPath,
		events,
		thresholdArgs: args,
	});

	await mkdir(outDir, { recursive: true });
	await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await writeFile(
		outputMd,
		`${renderRevocationReportMarkdown(report)}\n`,
		"utf8",
	);

	console.log(
		`[runtime-descriptor-revocation-report] report json: ${path.relative(root, outputJson)}`,
	);
	console.log(
		`[runtime-descriptor-revocation-report] report md: ${path.relative(root, outputMd)}`,
	);

	if (hasAlertAtOrAbove(report.alerts, failOnSeverity)) {
		const triggeredAlerts = report.alerts
			.filter((alert) => hasAlertAtOrAbove([alert], failOnSeverity))
			.map((alert) => `${alert.id}:${alert.severity}`)
			.join(", ");
		throw new Error(
			`alerts at or above severity '${failOnSeverity}' detected (${triggeredAlerts})`,
		);
	}
}

main().catch((error) => {
	console.error(
		`[runtime-descriptor-revocation-report] failed: ${error?.message ?? error}`,
	);
	process.exit(1);
});
