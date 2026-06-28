#!/usr/bin/env node
import { buildFactoryPressureReport } from "./factory-pressure-lib.mjs";

function usage() {
	console.error("Usage: node scripts/ci/check-factory-pressure.mjs [--json] [--strict]");
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const strict = args.includes("--strict");
const unknownArgs = args.filter((arg) => arg !== "--json" && arg !== "--strict");

if (unknownArgs.length > 0) {
	usage();
	process.exit(2);
}

const report = buildFactoryPressureReport();

if (json) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`factory-pressure: ${report.decision}`);
	for (const signal of report.signals) {
		console.log(`  ${signal.severity}: ${signal.id} - ${signal.summary}`);
	}
	if (report.nextAction) {
		console.log(`  next: ${report.nextAction}`);
	}
	if (report.nextCommand) {
		console.log(`  command: ${report.nextCommand}`);
	}
}

process.exit(strict && report.decision !== "continue" ? 1 : 0);
