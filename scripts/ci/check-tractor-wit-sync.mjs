import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const canonicalPath = resolve(root, "wit/refarm-sdk.wit");
const tractorPath = resolve(root, "packages/tractor/wit/refarm-sdk.wit");

const canonical = readFileSync(canonicalPath, "utf8").replace(/\r\n/g, "\n");
const tractor = readFileSync(tractorPath, "utf8").replace(/\r\n/g, "\n");

if (canonical !== tractor) {
	console.error(
		[
			"[tractor-wit-sync] packages/tractor/wit/refarm-sdk.wit differs from the canonical SDK WIT.",
			`Canonical: ${canonicalPath}`,
			`Tractor:   ${tractorPath}`,
			"Update both files together so Windows checkouts do not depend on Git symlinks.",
		].join("\n"),
	);
	process.exit(1);
}

console.log("[tractor-wit-sync] OK");
