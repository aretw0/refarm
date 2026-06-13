#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValidationPocWritingConsumer } from "./validation-poc-writing-consumer-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(ROOT, "validations", "poc-evidence-index.json");
const json = process.argv.includes("--json");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--json");

function readJson(relativePath) {
	return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
}

if (unknownArgs.length > 0) {
	console.error(
		"Usage: node scripts/ci/check-validation-poc-writing-consumer.mjs [--json]",
	);
	process.exit(2);
}

const index = readJson("validations/poc-evidence-index.json");
try {
	const result = validateValidationPocWritingConsumer(index, {
		exists: (relativePath) => existsSync(path.join(ROOT, relativePath)),
		readText: (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8"),
	});

	if (json) {
		console.log(JSON.stringify({
			ok: true,
			pocCount: result.pocCount,
			indexPath: path.relative(ROOT, INDEX_PATH),
			schema: index.schema,
		}, null, 2));
	} else {
		console.log(
			`Validated writing consumer readiness for ${result.pocCount} validation POC(s) from ${path.relative(ROOT, INDEX_PATH)}.`,
		);
	}
} catch (error) {
	if (json) {
		console.log(JSON.stringify({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			indexPath: path.relative(ROOT, INDEX_PATH),
		}, null, 2));
	} else {
		console.error(error instanceof Error ? error.message : String(error));
	}
	process.exit(1);
}
