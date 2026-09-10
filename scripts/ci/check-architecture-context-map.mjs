#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildArchitectureInventory } from "./lib/architecture-inventory.mjs";
import {
	analyzeContextDependencyPressure,
	contextDependencyPressurePasses,
	renderArchitectureContextMapMarkdown,
	validateArchitectureContextMap,
} from "./lib/architecture-context-map.mjs";

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !["--json", "--write"].includes(arg)) || (args.has("--json") && args.has("--write"))) {
	console.error("Usage: node scripts/ci/check-architecture-context-map.mjs [--json|--write]");
	process.exit(2);
}
const root = process.cwd();
const sourcePath = resolve(root, "docs/architecture-context-map.v1.json");
const documentPath = resolve(root, "docs/ARCHITECTURE_CONTEXT_MAP.md");
const map = JSON.parse(readFileSync(sourcePath, "utf8"));
const inventory = buildArchitectureInventory({ root });
const validation = validateArchitectureContextMap(map, inventory);
const dependencyPressure = analyzeContextDependencyPressure(map, inventory);
const dependencyCoverageOk = contextDependencyPressurePasses(dependencyPressure);
const markdown = renderArchitectureContextMapMarkdown(map, dependencyPressure);
let current = false;
try {
	current = readFileSync(documentPath, "utf8") === markdown;
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}
if (args.has("--write")) {
	writeFileSync(documentPath, markdown);
	current = true;
}
const output = {
	command: "architecture-context-map",
	ok: validation.ok && dependencyCoverageOk && current,
	contexts: map.contexts.length,
	relationships: map.relationships.length,
	violations: validation.violations,
	fitness: { dependencyCoverageOk },
	observations: { dependencyPressure },
	document: { path: "docs/ARCHITECTURE_CONTEXT_MAP.md", current },
};
if (args.has("--json")) console.log(JSON.stringify(output, null, 2));
else {
	console.log(`architecture-context-map: ${output.contexts} contexts, ${output.relationships} relationships`);
	console.log(`  structural violations: ${output.violations.length}`);
	console.log(`  undeclared non-dev dependency pairs: ${dependencyPressure.summary.undeclaredRuntimePairs}`);
	console.log(`  generated document: ${current ? "current" : "stale"}`);
	if (!current) console.log("  run: pnpm run architecture:context-map:write");
	for (const violation of output.violations) console.log(`  violation: ${JSON.stringify(violation)}`);
}
if (!output.ok) process.exit(1);
