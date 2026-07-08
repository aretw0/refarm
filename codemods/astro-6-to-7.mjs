#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];

const DEFAULT_TARGET_RANGE = "^7.0.0";
const DEFAULT_PEER_TARGET_RANGE = "^7";

const EXPERIMENTAL_FLAGS = [
	[
		"logger",
		"Astro 7 removes experimental.logger; move logger to the top-level config.",
	],
	[
		"queuedRendering",
		"Astro 7 removes experimental.queuedRendering; queued rendering is now the default.",
	],
	[
		"rustCompiler",
		"Astro 7 removes experimental.rustCompiler; the Rust compiler path is now stable/default.",
	],
	[
		"advancedRouting",
		"Astro 7 removes experimental.advancedRouting; advanced routing is now enabled by default.",
	],
	[
		"cache",
		"Astro 7 removes experimental.cache; move cache to the top-level config.",
	],
	[
		"routeRules",
		"Astro 7 removes experimental.routeRules; move routeRules to the top-level config.",
	],
];

const TRANSITION_INTERNALS = [
	"TRANSITION_BEFORE_PREPARATION",
	"TRANSITION_AFTER_PREPARATION",
	"TRANSITION_BEFORE_SWAP",
	"TRANSITION_AFTER_SWAP",
	"TRANSITION_PAGE_LOAD",
	"isTransitionBeforePreparationEvent",
	"isTransitionBeforeSwapEvent",
	"createAnimationScope",
];

function parseArgs(argv) {
	const args = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args.set(key, true);
		} else {
			const current = args.get(key);
			if (current === undefined) {
				args.set(key, next);
			} else if (Array.isArray(current)) {
				current.push(next);
			} else {
				args.set(key, [current, next]);
			}
			i += 1;
		}
	}
	return args;
}

function values(value) {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function stringifyPackageJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function shouldUpdateAppRange(range) {
	return typeof range === "string" && /^[~^]?[0-6]\./.test(range.trim());
}

function shouldWidenPeerRange(range, peerTargetRange) {
	if (typeof range !== "string") return false;
	const normalized = range.trim();
	if (!/^[~^]?[0-6]\./.test(normalized)) return false;
	return !new RegExp(`(^|\\|\\|)\\s*${escapeRegex(peerTargetRange)}(\\s|$)`).test(
		normalized,
	);
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function packageFindings(manifest) {
	const findings = [];
	for (const sectionName of DEPENDENCY_SECTIONS) {
		const section = manifest[sectionName];
		if (!section || typeof section !== "object" || Array.isArray(section)) {
			continue;
		}
		if (Object.hasOwn(section, "@astrojs/db")) {
			findings.push({
				code: "removed-astro-db",
				path: `${sectionName}.@astrojs/db`,
				message:
					"@astrojs/db was removed in Astro 7; replace it before upgrading.",
			});
		}
	}
	return findings;
}

export function transformAstro6To7WithReport(
	json,
	{
		targetRange = DEFAULT_TARGET_RANGE,
		peerTargetRange = DEFAULT_PEER_TARGET_RANGE,
	} = {},
) {
	const manifest = JSON.parse(json);
	const next = structuredClone(manifest);
	let astroRangesUpdated = 0;
	let peerRangesWidened = 0;

	for (const sectionName of DEPENDENCY_SECTIONS) {
		const section = next[sectionName];
		if (!section || typeof section !== "object" || Array.isArray(section)) {
			continue;
		}
		const range = section.astro;
		if (sectionName === "peerDependencies") {
			if (shouldWidenPeerRange(range, peerTargetRange)) {
				section.astro = `${range} || ${peerTargetRange}`;
				peerRangesWidened += 1;
			}
		} else if (shouldUpdateAppRange(range)) {
			section.astro = targetRange;
			astroRangesUpdated += 1;
		}
	}

	const packageRangeChanged = astroRangesUpdated > 0 || peerRangesWidened > 0;
	const output = packageRangeChanged ? stringifyPackageJson(next) : json;
	return {
		json: output,
		changed: packageRangeChanged && output !== json,
		astroRangesUpdated,
		peerRangesWidened,
		findings: packageFindings(manifest),
	};
}

export function transformAstro6To7(json, options) {
	return transformAstro6To7WithReport(json, options).json;
}

export function scanAstro7UpgradeText(text, { path: sourcePath = "<memory>" } = {}) {
	const findings = [];
	const normalizedPath = sourcePath.replaceAll("\\", "/");

	if (/\/?src\/fetch\.(ts|js)$/.test(normalizedPath)) {
		findings.push({
			code: "reserved-src-fetch",
			path: sourcePath,
			message:
				"Astro 7 reserves src/fetch.ts and src/fetch.js for advanced routing; rename or configure fetchFile if this is not a route entrypoint.",
		});
	}

	for (const [flag, message] of EXPERIMENTAL_FLAGS) {
		if (hasExperimentalFlag(text, flag)) {
			findings.push({
				code: "removed-experimental-flag",
				path: sourcePath,
				message,
			});
		}
	}

	if (
		/getContainerRenderer/.test(text) &&
		/from\s+["']@astrojs\/(?:react|preact|solid-js|svelte|vue|mdx)["']/.test(text)
	) {
		findings.push({
			code: "deprecated-container-renderer-root-import",
			path: sourcePath,
			message:
				"Import getContainerRenderer from the integration container-renderer entrypoint.",
		});
	}

	if (
		/from\s+["']astro:transitions(?:\/client)?["']/.test(text) &&
		TRANSITION_INTERNALS.some((symbol) => text.includes(symbol))
	) {
		findings.push({
			code: "removed-transitions-internal",
			path: sourcePath,
			message:
				"Astro 7 removes deprecated astro:transitions internals; replace lifecycle constants/helpers.",
		});
	}

	return findings;
}

function hasExperimentalFlag(text, flag) {
	return new RegExp(`experimental\\s*:\\s*\\{[\\s\\S]*?\\b${flag}\\s*:`).test(text);
}

export function runAstro6To7Cli(
	argv = process.argv.slice(2),
	{ stdout = process.stdout, stderr = process.stderr } = {},
) {
	const args = parseArgs(argv);
	const input = args.get("input");
	if (typeof input !== "string") {
		stderr.write(
			"Usage: node codemods/astro-6-to-7.mjs --input <package.json> [--scan <path>] [--target <range>] [--peer-target <range>] [--write] [--json]\n",
		);
		return 2;
	}

	const original = readFileSync(input, "utf8");
	const result = transformAstro6To7WithReport(original, {
		targetRange: args.get("target") || DEFAULT_TARGET_RANGE,
		peerTargetRange: args.get("peer-target") || DEFAULT_PEER_TARGET_RANGE,
	});
	const findings = [...result.findings];
	for (const scanPath of values(args.get("scan"))) {
		findings.push(
			...scanAstro7UpgradeText(readFileSync(scanPath, "utf8"), {
				path: scanPath,
			}),
		);
	}

	if (args.get("write")) {
		writeFileSync(input, result.json);
	}
	if (args.get("json")) {
		stdout.write(
			`${JSON.stringify(
				{
					input,
					changed: result.changed,
					astroRangesUpdated: result.astroRangesUpdated,
					peerRangesWidened: result.peerRangesWidened,
					findings,
					written: Boolean(args.get("write")),
				},
				null,
				2,
			)}\n`,
		);
	} else {
		stdout.write(result.json);
	}
	return 0;
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain() && process.argv.slice(2).length > 0) {
	process.exit(runAstro6To7Cli());
}
