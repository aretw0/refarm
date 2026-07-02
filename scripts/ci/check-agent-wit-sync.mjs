import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const canonicalPath = resolve(root, "packages/refarm-plugin-wit/wit/refarm-plugin-host.wit");
const agentPath = resolve(root, "packages/agent/wit/refarm-plugin-host.wit");

const canonical = readFileSync(canonicalPath, "utf8").replace(/\r\n/g, "\n");
const agent = readFileSync(agentPath, "utf8").replace(/\r\n/g, "\n");

if (canonical !== agent) {
	console.error(
		[
			"[agent-wit-sync] packages/agent/wit/refarm-plugin-host.wit differs from the canonical host WIT.",
			`Canonical: ${canonicalPath}`,
			`Pi agent:  ${agentPath}`,
			"Update both files together so Windows checkouts do not depend on Git symlinks.",
		].join("\n"),
	);
	process.exit(1);
}

console.log("[agent-wit-sync] OK");
