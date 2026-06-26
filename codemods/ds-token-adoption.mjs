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
	return css.replace(/([^{}]+)\{([^{}]*)\}/g, (match, selector, body) => {
		const scopedSelector = selector.trim();
		if (
			!scopedSelector.includes(":root") &&
			!scopedSelector.includes("data-vault-marimo-theme")
		) {
			return match;
		}

		const kept = body
			.split("\n")
			.filter((line) => {
				const declaration = /^\s*--([a-z0-9-]+)\s*:/.exec(line);
				return !declaration || !SEMANTIC_TOKENS.has(declaration[1]);
			})
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd();

		if (kept.trim().length === 0) return "";
		return `${selector}{${kept}\n}`;
	});
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
