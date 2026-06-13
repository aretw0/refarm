#!/usr/bin/env node
import { relative } from "node:path";
import {
	DEFAULT_TEXT_QUALITY_CONFIG,
	loadDiscoveredTextQualityConfig,
	scoreFile,
	severityCounts,
} from "./text-quality-lib.mjs";

function usage() {
	return [
		"Usage: node scripts/ci/check-text-quality.mjs [options] <file...>",
		"",
		"Options:",
		"  --config <path>    JSON rules file (defaults to .refarm/text-quality.json when present)",
		"  --profile <name>   Rules profile (default: default)",
		"  --audience <name>  Audience override",
		"  --json             Print machine-readable report",
		"  --strict           Exit non-zero on warnings",
		"  --help             Show this help",
	].join("\n");
}

function parseArgs(argv) {
	const args = {
		audience: undefined,
		config: undefined,
		files: [],
		help: false,
		json: false,
		missing: [],
		profile: "default",
		strict: false,
		unknown: [],
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--audience":
				args.audience = readOptionValue(argv, index, arg, args.missing);
				index += 1;
				break;
			case "--config":
				args.config = readOptionValue(argv, index, arg, args.missing);
				index += 1;
				break;
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--json":
				args.json = true;
				break;
			case "--profile":
				args.profile = readOptionValue(argv, index, arg, args.missing);
				index += 1;
				break;
			case "--strict":
				args.strict = true;
				break;
			default:
				if (arg.startsWith("-")) {
					args.unknown.push(arg);
				} else {
					args.files.push(arg);
				}
				break;
		}
	}
	return args;
}

function readOptionValue(argv, index, option, missing) {
	const value = argv[index + 1];
	if (!value || value.startsWith("-")) {
		missing.push(option);
		return undefined;
	}
	return value;
}

function printHuman(report) {
	console.log(
		`[text-quality] files=${report.summary.total} fail=${report.summary.fail} warn=${report.summary.warn} info=${report.summary.info}`,
	);
	for (const item of report.files) {
		if (item.status === "PASS") continue;
		console.log(`[text-quality] ${item.status} ${item.path}`);
		for (const finding of item.findings.slice(0, 10)) {
			const line = finding.line ? `:${finding.line}` : "";
			console.log(
				`  - ${finding.severity} ${finding.rule}${line}: ${finding.message}`,
			);
		}
		if (item.findings.length > 10) {
			console.log(`  - ... ${item.findings.length - 10} more finding(s)`);
		}
	}
}

function relativePath(value) {
	return value ? relative(process.cwd(), value).replace(/\\/gu, "/") : null;
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function printJsonError(error) {
	const payload = {
		schemaVersion: 1,
		command: "check-text-quality",
		ok: false,
		error: {
			code: error?.code ?? "ERR_TEXT_QUALITY",
			message: errorMessage(error),
			configPath: relativePath(error?.configPath),
			fsCode: error?.fsCode ?? null,
			issues: Array.isArray(error?.issues) ? error.issues : [],
		},
	};
	console.log(JSON.stringify(payload, null, 2));
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		return 0;
	}
	if (args.unknown.length > 0) {
		console.error(`Unknown argument(s): ${args.unknown.join(", ")}`);
		console.error(usage());
		return 2;
	}
	if (args.missing.length > 0) {
		console.error(`Missing value for: ${args.missing.join(", ")}`);
		console.error(usage());
		return 2;
	}
	if (args.files.length === 0) {
		console.error("No files provided.");
		console.error(usage());
		return 2;
	}

	let config;
	let configPath;
	const files = [];
	try {
		const loaded = await loadDiscoveredTextQualityConfig({
			configPath: args.config,
		});
		config = loaded.config;
		configPath = loaded.configPath;
		for (const file of args.files) {
			const scored = await scoreFile(file, config ?? DEFAULT_TEXT_QUALITY_CONFIG, {
				audience: args.audience,
				profile: args.profile,
			});
			files.push({
				...scored,
				path: relativePath(scored.path),
			});
		}
	} catch (error) {
		if (args.json) {
			printJsonError(error);
		} else {
			console.error(errorMessage(error));
		}
		return 1;
	}

	const totals = { fail: 0, warn: 0, info: 0 };
	for (const item of files) {
		const counts = severityCounts(item.findings);
		totals.fail += counts.fail;
		totals.warn += counts.warn;
		totals.info += counts.info;
	}
	const report = {
		schemaVersion: 1,
		command: "check-text-quality",
		ok: true,
		profile: args.profile,
		audience: args.audience ?? null,
		configPath: relativePath(configPath),
		summary: {
			total: files.length,
			fail: totals.fail,
			warn: totals.warn,
			info: totals.info,
			pass: files.filter((file) => file.status === "PASS").length,
		},
		files,
	};

	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		printHuman(report);
	}

	if (totals.fail > 0) return 1;
	if (args.strict && totals.warn > 0) return 1;
	return 0;
}

main().then(
	(status) => {
		process.exitCode = status;
	},
	(error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	},
);
