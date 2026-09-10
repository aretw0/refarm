#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildArchitectureInventory,
	renderArchitectureInventoryMarkdown,
} from "./lib/architecture-inventory.mjs";

function usage() {
	console.error("Usage: node scripts/ci/check-architecture-inventory.mjs [--json] [--write] [--root <path>]");
}

const args = process.argv.slice(2);
const options = { json: false, write: false, root: process.cwd() };
const unknown = [];
for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === "--json") options.json = true;
	else if (arg === "--write") options.write = true;
	else if (arg === "--root" && args[index + 1] && !args[index + 1].startsWith("--")) {
		options.root = args[index + 1];
		index += 1;
	} else unknown.push(arg);
}
if (unknown.length > 0 || (options.json && options.write)) {
	usage();
	process.exit(2);
}

const report = buildArchitectureInventory({ root: options.root });
const markdown = renderArchitectureInventoryMarkdown(report);
const documentPath = resolve(options.root, "docs/ARCHITECTURE_INVENTORY.md");
let documentCurrent = false;
try {
	documentCurrent = readFileSync(documentPath, "utf8") === markdown;
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

if (options.write) {
	writeFileSync(documentPath, markdown);
	documentCurrent = true;
}

const output = {
	...report,
	document: {
		path: "docs/ARCHITECTURE_INVENTORY.md",
		current: documentCurrent,
	},
	ok: report.ok && documentCurrent,
};

if (options.json) console.log(JSON.stringify(output, null, 2));
else {
	console.log(`architecture-inventory: ${report.summary.workspaces} workspaces (${report.summary.apps} apps, ${report.summary.packages} packages)`);
	console.log(`  dependency cycles: ${report.invariants.cycles.length}`);
	console.log(`  package -> app edges: ${report.invariants.packageToApp.length}`);
	console.log(`  generated document: ${documentCurrent ? "current" : "stale"}`);
	if (!documentCurrent) console.log("  run: pnpm run architecture:inventory:write");
	for (const violation of report.invariants.violations) console.log(`  violation: ${JSON.stringify(violation)}`);
}

if (!output.ok) process.exit(1);
