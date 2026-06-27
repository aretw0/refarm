#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const IMPORTS = [
	'@import "@refarm.dev/ds/tokens.css";',
	'@import "@refarm.dev/ds/themes/verde-jardim.css";',
	'@import "@refarm.dev/ds/components.css";',
];

const SEMANTIC_TOKENS = new Set([
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"muted",
	"muted-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"accent",
	"accent-foreground",
	"border",
	"input",
	"ring",
	"error",
	"warning",
	"success",
	"info",
	"radius-sm",
	"radius-md",
	"radius-lg",
	"shadow-sm",
	"shadow-md",
	"shadow-lg",
	"font-sans",
	"font-mono",
]);

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
			args.set(key, next);
			i += 1;
		}
	}
	return args;
}

function ensureImports(css) {
	const missing = IMPORTS.filter((line) => !css.includes(line));
	if (missing.length === 0) return css;
	return `${missing.join("\n")}\n\n${css.replace(/^\s+/, "")}`;
}

function stripSemanticDeclarations(css) {
	let output = "";
	let cursor = 0;

	for (const block of topLevelBlocks(css)) {
		output += css.slice(cursor, block.start);
		const selector = css.slice(block.start, block.open).trim();
		if (!isSemanticTokenSelector(selector)) {
			output += css.slice(block.start, block.end + 1);
			cursor = block.end + 1;
			continue;
		}

		const body = css.slice(block.open + 1, block.end);
		const kept = body
			.split("\n")
			.filter((line) => {
				const declaration = /^\s*--([a-z0-9-]+)\s*:/.exec(line);
				return !declaration || !SEMANTIC_TOKENS.has(declaration[1]);
			})
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd();

		if (kept.trim().length > 0) {
			output += `${css.slice(block.start, block.open + 1)}${kept}\n}`;
		}
		cursor = block.end + 1;
	}

	return output + css.slice(cursor);
}

function isSemanticTokenSelector(selector) {
	return (
		selector.includes(":root") ||
		selector.includes("data-vault-marimo-theme")
	);
}

function topLevelBlocks(css) {
	const blocks = [];
	let depth = 0;
	let start = 0;
	let open = -1;

	for (let index = 0; index < css.length; index += 1) {
		const char = css[index];
		if (char === "{") {
			if (depth === 0) {
				open = index;
				start = previousRuleBoundary(css, index);
			}
			depth += 1;
			continue;
		}
		if (char !== "}") continue;

		depth -= 1;
		if (depth === 0 && open >= 0) {
			blocks.push({ start, open, end: index });
			open = -1;
		}
	}

	return blocks;
}

function previousRuleBoundary(css, openIndex) {
	const boundary = css.lastIndexOf("}", openIndex);
	return boundary === -1 ? 0 : boundary + 1;
}

export function transformDsTokenAdoption(css) {
	return stripSemanticDeclarations(ensureImports(css))
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.concat("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.size > 0) {
	const input = args.get("input");
	if (typeof input !== "string") {
		console.error("Usage: node codemods/ds-token-adoption.mjs --input <css> [--write]");
		process.exit(2);
	}

	const output = transformDsTokenAdoption(readFileSync(input, "utf8"));
	if (args.get("write")) {
		writeFileSync(input, output);
	} else {
		process.stdout.write(output);
	}
}
