#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateValidationPocWritingConsumer } from "./validation-poc-writing-consumer-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(ROOT, "validations", "poc-evidence-index.json");

function readJson(relativePath) {
	return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
}

const index = readJson("validations/poc-evidence-index.json");
const result = validateValidationPocWritingConsumer(index, {
	exists: (relativePath) => existsSync(path.join(ROOT, relativePath)),
	readText: (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8"),
});

console.log(
	`Validated writing consumer readiness for ${result.pocCount} validation POC(s) from ${path.relative(ROOT, INDEX_PATH)}.`,
);
