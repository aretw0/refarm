import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const canonicalPath = resolve(root, "packages/refarm-plugin-wit/wit/refarm-plugin-host.wit");
const piAgentPath = resolve(root, "packages/pi-agent/wit/refarm-plugin-host.wit");

const canonical = readFileSync(canonicalPath, "utf8").replace(/\r\n/g, "\n");
const piAgent = readFileSync(piAgentPath, "utf8").replace(/\r\n/g, "\n");

if (canonical !== piAgent) {
	console.error(
		[
			"[pi-agent-wit-sync] packages/pi-agent/wit/refarm-plugin-host.wit differs from the canonical host WIT.",
			`Canonical: ${canonicalPath}`,
			`Pi agent:  ${piAgentPath}`,
			"Update both files together so Windows checkouts do not depend on Git symlinks.",
		].join("\n"),
	);
	process.exit(1);
}

console.log("[pi-agent-wit-sync] OK");
