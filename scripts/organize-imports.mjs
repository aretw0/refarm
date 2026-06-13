#!/usr/bin/env node

import {
	changedSourceFiles,
	organizeImports,
	uniqueSourceFiles,
} from "./organize-imports-lib.mjs";

function usage() {
	console.error("Usage: node scripts/organize-imports.mjs [--check] [--all|file...]");
	console.error("");
	console.error("Defaults to changed source files from git. Skips dist/, build/, .turbo/, node_modules/, and .d.ts.");
}

const root = process.cwd();
const args = process.argv.slice(2);
const check = args.includes("--check");
const all = args.includes("--all");
const files = args.filter((arg) => arg !== "--check" && arg !== "--all");

if (args.includes("--help") || args.includes("-h")) {
	usage();
	process.exit(0);
}

let selected;
if (all) {
	console.error("Use explicit files or changed-file mode; --all is intentionally not implemented for this repo.");
	process.exit(1);
} else if (files.length > 0) {
	selected = uniqueSourceFiles(files, root);
} else {
	selected = changedSourceFiles(root);
}

if (selected.length === 0) {
	console.log("No changed source files to organize.");
	process.exit(0);
}

const changed = organizeImports(selected, { root, check });
if (changed.length === 0) {
	console.log(`Imports already organized (${selected.length} file${selected.length === 1 ? "" : "s"} checked).`);
	process.exit(0);
}

for (const file of changed) console.log(file);

if (check) {
	console.error(`Imports need organizing in ${changed.length} file${changed.length === 1 ? "" : "s"}.`);
	process.exit(1);
}

console.log(`Organized imports in ${changed.length} file${changed.length === 1 ? "" : "s"}.`);
