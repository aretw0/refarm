#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

import { migratePiAgentSessionNodes } from "./ci/migrate-pi-agent-sessions-lib.mjs";

function printHelp() {
	console.log(`Usage: node scripts/migrate-pi-agent-sessions.mjs --input <path> [options]

Options:
  --input <path>     JSON/NDJSON file with session nodes (required)
  --output <path>    Write migrated nodes to this file
  --in-place         Overwrite input file with migrated nodes
  --check            Do not write; exit 1 if migration is still needed
  --help             Show this message
`);
}

function parseArgs(argv) {
	const options = {
		input: null,
		output: null,
		inPlace: false,
		check: false,
		help: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--input") {
			options.input = argv[i + 1] ?? null;
			i += 1;
			continue;
		}
		if (arg === "--output") {
			options.output = argv[i + 1] ?? null;
			i += 1;
			continue;
		}
		if (arg === "--in-place") {
			options.inPlace = true;
			continue;
		}
		if (arg === "--check") {
			options.check = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function parseInput(content) {
	const trimmed = content.trim();
	if (!trimmed) return [];

	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) return parsed;
		if (Array.isArray(parsed.nodes)) return parsed.nodes;
		throw new Error("JSON input must be an array or { nodes: [...] }");
	} catch (error) {
		const lines = trimmed
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length === 0) return [];
		return lines.map((line, index) => {
			try {
				return JSON.parse(line);
			} catch {
				throw new Error(`Invalid NDJSON at line ${index + 1}`);
			}
		});
	}
}

async function run() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	if (!options.input) {
		throw new Error("--input is required");
	}

	if (options.output && options.inPlace) {
		throw new Error("Use either --output or --in-place, not both");
	}

	const raw = await readFile(options.input, "utf-8");
	const nodes = parseInput(raw);
	const migrated = migratePiAgentSessionNodes(nodes);

	const report = {
		...migrated.report,
		input: options.input,
		output: options.output ?? (options.inPlace ? options.input : null),
	};

	if (options.check) {
		console.log(JSON.stringify(report, null, 2));
		if (report.migrated > 0) process.exitCode = 1;
		return;
	}

	const outputJson = `${JSON.stringify(migrated.nodes, null, 2)}\n`;
	if (options.output) {
		await writeFile(options.output, outputJson, "utf-8");
		console.error(`[migrate-pi-agent-sessions] wrote ${options.output}`);
	} else if (options.inPlace) {
		await writeFile(options.input, outputJson, "utf-8");
		console.error(`[migrate-pi-agent-sessions] updated ${options.input}`);
	} else {
		process.stdout.write(outputJson);
	}

	console.error(
		`[migrate-pi-agent-sessions] total=${report.total} migrated=${report.migrated} idRewrites=${report.idRewrites} referenceRewrites=${report.referenceRewrites}`,
	);
}

run().catch((error) => {
	console.error(`[migrate-pi-agent-sessions] ${error.message}`);
	process.exitCode = 1;
});
