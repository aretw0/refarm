#!/usr/bin/env node
import { buildEnvironmentPressureReport } from "./lib/environment-pressure.mjs";

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

const report = buildEnvironmentPressureReport({
	command: "factory-pressure",
	guidance: {
		diskPressureAction:
			"Run `pnpm run clean:rust:check`, then choose the smallest cleanup tier from docs/local-disk-hygiene.md before broad builds.",
		diskPressureCommand: "pnpm run clean:rust:check",
		diskProbeFailureAction: "Run `pnpm run disk:check` only if disk pressure is suspected.",
		diskProbeFailureCommand: "pnpm run disk:check",
		memoryPressureAction:
			"Use explicit test files, bounded workers, and package-scoped checks until memory pressure drops.",
		gitGcLogAction:
			"Inspect `.git/gc.log`; do not run prune or destructive Git cleanup from an agent without explicit operator intent.",
	},
});

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
