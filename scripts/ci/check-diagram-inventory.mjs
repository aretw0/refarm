#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDiagramInventory, renderDiagramInventoryMarkdown } from "./lib/diagram-inventory.mjs";

function usage() {
	console.error("Usage: node scripts/ci/check-diagram-inventory.mjs [--json] [--write] [--root <path>]");
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

const report = buildDiagramInventory({ root: options.root });
const markdown = renderDiagramInventoryMarkdown(report);
const documentPath = resolve(options.root, "docs/DIAGRAM_INVENTORY.md");
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
	document: { path: "docs/DIAGRAM_INVENTORY.md", current: documentCurrent },
	ok: report.ok && documentCurrent,
};

if (options.json) console.log(JSON.stringify(output, null, 2));
else {
	console.log(`diagram-inventory: ${report.summary.sources} sources, ${report.summary.rendered} rendered SVGs`);
	console.log(`  missing SVGs: ${report.summary.missing}`);
	console.log(`  generated document: ${documentCurrent ? "current" : "stale"}`);
	if (!documentCurrent) console.log("  run: pnpm run diagrams:inventory:write");
	for (const missing of report.missingRenderings) console.log(`  missing: ${missing}`);
}

if (!output.ok) process.exit(1);
