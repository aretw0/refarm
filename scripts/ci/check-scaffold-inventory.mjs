#!/usr/bin/env node
import { buildScaffoldInventory } from "./lib/scaffold-inventory.mjs";

function usage() {
	console.error("Usage: node scripts/ci/check-scaffold-inventory.mjs [--json] [--strict] [--root <path>]");
}

const args = process.argv.slice(2);
const options = {
	json: false,
	strict: false,
	root: process.cwd(),
};
const unknownArgs = [];

for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === "--json") {
		options.json = true;
		continue;
	}
	if (arg === "--strict") {
		options.strict = true;
		continue;
	}
	if (arg === "--root") {
		const root = args[index + 1];
		if (!root || root.startsWith("--")) {
			unknownArgs.push(arg);
			continue;
		}
		options.root = root;
		index += 1;
		continue;
	}
	unknownArgs.push(arg);
}

if (unknownArgs.length > 0) {
	usage();
	process.exit(2);
}

const report = buildScaffoldInventory({ root: options.root });
const blockingItems = report.items
	.filter((item) => item.status === "needs-generator" || item.findings.length > 0)
	.map((item) => ({
		path: item.path,
		archetype: item.archetype,
		status: item.status,
		findings: item.findings,
	}));
const ok = !options.strict || blockingItems.length === 0;
const output = {
	...report,
	ok,
	...(options.strict ? { blockingItems } : {}),
};

if (options.json) {
	console.log(JSON.stringify(output, null, 2));
} else {
	console.log(`scaffold-inventory: ${output.summary.total} workspaces/templates`);
	for (const [status, count] of Object.entries(report.summary.byStatus).sort()) {
		console.log(`  ${status}: ${count}`);
	}
	const candidates = report.items.filter((item) => item.status !== "covered");
	if (candidates.length > 0) {
		console.log("");
		for (const item of candidates) {
			console.log(`  ${item.path}: ${item.archetype} -> ${item.expectedGenerator}`);
			for (const finding of item.findings) {
				console.log(`    ${finding.severity}: ${finding.id} - ${finding.summary}`);
			}
		}
	}
	if (options.strict && blockingItems.length > 0) {
		console.log("");
		console.log(`strict: ${blockingItems.length} blocking scaffold item(s)`);
	}
}

if (!ok) process.exit(1);
