#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VITEST_IMPORT_ORDER = [
	"describe",
	"it",
	"test",
	"beforeAll",
	"beforeEach",
	"afterAll",
	"afterEach",
	"expect",
	"vi",
];

const NODE_TEST_NAME_MAP = new Map([
	["before", "beforeAll"],
	["after", "afterAll"],
	["mock", "vi"],
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

export function transformNodeTestToVitest(source) {
	return transformNodeTestToVitestWithReport(source).code;
}

export function transformNodeTestToVitestWithReport(source) {
	const imports = rewriteImports(source);
	const bindings = rewriteNodeTestBindings(imports.code);
	const assertions = rewriteAssertions(bindings.code, imports.assertName);
	const unhandled = collectUnhandled(assertions.code, imports.assertName);
	const code = unhandled.length > 0 && imports.assertName
		? ensureAssertImport(assertions.code, imports.assertName)
		: assertions.code;
	return {
		code,
		changed: code !== source,
		importsRewritten: imports.importsRewritten,
		assertionsRewritten: assertions.assertionsRewritten,
		unhandled,
	};
}

function rewriteNodeTestBindings(source) {
	return {
		code: source
			.replace(/\bbefore\s*\(/g, "beforeAll(")
			.replace(/\bafter\s*\(/g, "afterAll(")
			.replace(/\bmock\./g, "vi."),
	};
}

function ensureAssertImport(source, assertName) {
	const importLine = `import ${assertName} from "node:assert/strict";`;
	if (source.includes(importLine)) return source;
	const lines = source.split("\n");
	const vitestIndex = lines.findIndex((line) => /\s+from\s+["']vitest["'];?\s*$/.test(line));
	lines.splice(vitestIndex === -1 ? 0 : vitestIndex + 1, 0, importLine);
	return lines.join("\n");
}

function rewriteImports(source) {
	const lines = source.split("\n");
	const kept = [];
	const vitestNames = new Set();
	let firstImportIndex = null;
	let importsRewritten = 0;
	let assertName = null;

	for (const line of lines) {
		const vitest = /^import\s+\{\s*([^}]+)\s*\}\s+from\s+["']vitest["'];?\s*$/.exec(line);
		if (vitest) {
			for (const name of parseNamedImports(vitest[1])) {
				vitestNames.add(name.imported);
			}
			if (firstImportIndex === null) firstImportIndex = kept.length;
			importsRewritten += 1;
			continue;
		}

		const nodeTest = /^import\s+(.+?)\s+from\s+["']node:test["'];?\s*$/.exec(line);
		if (nodeTest) {
			for (const name of parseImportClause(nodeTest[1])) {
				vitestNames.add(NODE_TEST_NAME_MAP.get(name) ?? name);
			}
			if (firstImportIndex === null) firstImportIndex = kept.length;
			importsRewritten += 1;
			continue;
		}

		const nodeAssert = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']node:assert\/strict["'];?\s*$/.exec(line);
		if (nodeAssert) {
			assertName = nodeAssert[1];
			vitestNames.add("expect");
			if (firstImportIndex === null) firstImportIndex = kept.length;
			importsRewritten += 1;
			continue;
		}

		kept.push(line);
	}

	if (vitestNames.size === 0) {
		return { code: source, importsRewritten: 0, assertName };
	}

	const ordered = [...vitestNames].sort((left, right) => {
		const leftIndex = VITEST_IMPORT_ORDER.indexOf(left);
		const rightIndex = VITEST_IMPORT_ORDER.indexOf(right);
		if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
		if (leftIndex === -1) return 1;
		if (rightIndex === -1) return -1;
		return leftIndex - rightIndex;
	});
	const importLine = `import { ${ordered.join(", ")} } from "vitest";`;
	kept.splice(firstImportIndex ?? 0, 0, importLine);
	return {
		code: kept.join("\n"),
		importsRewritten,
		assertName,
	};
}

function parseImportClause(clause) {
	const trimmed = clause.trim();
	if (trimmed.startsWith("{")) {
		return parseNamedImports(trimmed.slice(1, -1)).map((item) => item.imported);
	}

	const split = trimmed.indexOf(",");
	if (split === -1) return [trimmed];
	return [
		trimmed.slice(0, split).trim(),
		...parseNamedImports(trimmed.slice(split + 1).trim().slice(1, -1)).map((item) => item.imported),
	];
}

function parseNamedImports(source) {
	return source
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.map((item) => {
			const [imported] = item.split(/\s+as\s+/);
			return { imported: imported.trim() };
		});
}

function rewriteAssertions(source, assertName) {
	if (!assertName) return { code: source, assertionsRewritten: 0 };

	let output = "";
	let cursor = 0;
	let assertionsRewritten = 0;
	const needle = `${assertName}.`;

	while (cursor < source.length) {
		const start = source.indexOf(needle, cursor);
		if (start === -1) {
			output += source.slice(cursor);
			break;
		}

		const methodStart = start + needle.length;
		const methodMatch = /^[A-Za-z_$][\w$]*/.exec(source.slice(methodStart));
		if (!methodMatch) {
			output += source.slice(cursor, start + needle.length);
			cursor = start + needle.length;
			continue;
		}

		const method = methodMatch[0];
		const open = skipWhitespace(source, methodStart + method.length);
		if (source[open] !== "(") {
			output += source.slice(cursor, open);
			cursor = open;
			continue;
		}

		const close = findMatchingParen(source, open);
		if (close === -1) {
			output += source.slice(cursor, open + 1);
			cursor = open + 1;
			continue;
		}

		const args = splitTopLevelArgs(source.slice(open + 1, close));
		const replacement = assertionReplacement(method, args);
		output += source.slice(cursor, start);
		if (replacement) {
			output += replacement;
			assertionsRewritten += 1;
		} else {
			output += source.slice(start, close + 1);
		}
		cursor = close + 1;
	}

	return { code: output, assertionsRewritten };
}

function assertionReplacement(method, args) {
	const [actual, expected, message] = args;
	switch (method) {
		case "equal":
		case "strictEqual":
			return args.length >= 2 ? `${expectCall(actual, message)}.toBe(${expected})` : null;
		case "notEqual":
		case "notStrictEqual":
			return args.length >= 2 ? `${expectCall(actual, message)}.not.toBe(${expected})` : null;
		case "deepEqual":
		case "deepStrictEqual":
			return args.length >= 2 ? `${expectCall(actual, message)}.toEqual(${expected})` : null;
		case "notDeepEqual":
		case "notDeepStrictEqual":
			return args.length >= 2 ? `${expectCall(actual, message)}.not.toEqual(${expected})` : null;
		case "ok":
			return args.length >= 1 ? `${expectCall(actual, expected)}.toBeTruthy()` : null;
		case "match":
			return args.length >= 2 ? `${expectCall(actual, message)}.toMatch(${expected})` : null;
		case "doesNotMatch":
			return args.length >= 2 ? `${expectCall(actual, message)}.not.toMatch(${expected})` : null;
		case "throws":
			return args.length >= 1 ? `${expectCall(actual, message)}.toThrow(${expected ?? ""})` : null;
		case "rejects":
			return args.length >= 1 ? `${expectCall(actual, message)}.rejects.toThrow(${expected ?? ""})` : null;
		case "doesNotReject": {
			if (args.length < 1) return null;
			const { expected: rejectionMatcher, message: rejectionMessage } =
				rejectionArgs(expected, message);
			return `${expectCall(actual, rejectionMessage)}.resolves.not.toThrow(${rejectionMatcher ?? ""})`;
		}
		case "fail":
			return args.length >= 1 ? `expect.fail(${actual})` : "expect.fail()";
		default:
			return null;
	}
}

function rejectionArgs(expected, message) {
	if (message !== undefined) {
		return { expected, message };
	}
	if (isStringLiteral(expected)) {
		return { expected: undefined, message: expected };
	}
	return { expected, message: undefined };
}

function isStringLiteral(value) {
	if (value === undefined) return false;
	return /^(['"`])[\s\S]*\1$/.test(value.trim());
}

function expectCall(actual, message) {
	if (message === undefined || message === "") return `expect(${actual})`;
	return `expect(${actual}, ${message})`;
}

function skipWhitespace(source, index) {
	let next = index;
	while (/\s/.test(source[next])) next += 1;
	return next;
}

function findMatchingParen(source, open) {
	let depth = 0;
	let quote = null;
	let escaped = false;
	for (let index = open; index < source.length; index += 1) {
		const char = source[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === "\"" || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") depth += 1;
		if (char === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

function splitTopLevelArgs(source) {
	const args = [];
	let start = 0;
	let depth = 0;
	let quote = null;
	let escaped = false;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === "\"" || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(" || char === "[" || char === "{") depth += 1;
		if (char === ")" || char === "]" || char === "}") depth -= 1;
		if (char === "," && depth === 0) {
			args.push(source.slice(start, index).trim());
			start = index + 1;
		}
	}

	const tail = source.slice(start).trim();
	if (tail) args.push(tail);
	return args;
}

function collectUnhandled(source, assertName) {
	if (!assertName) return [];
	return [...source.matchAll(new RegExp(`\\b${assertName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([A-Za-z_$][\\w$]*)`, "g"))]
		.map((match) => `unhandled assertion: ${assertName}.${match[1]}`)
		.filter((value, index, all) => all.indexOf(value) === index);
}

export function runNodeTestToVitestCli(
	argv = process.argv.slice(2),
	{ stdout = process.stdout, stderr = process.stderr } = {},
) {
	const args = parseArgs(argv);
	const input = args.get("input");
	if (typeof input !== "string") {
		stderr.write("Usage: node codemods/node-test-to-vitest.mjs --input <test-file> [--write] [--json]\n");
		return 2;
	}

	const original = readFileSync(input, "utf8");
	const result = transformNodeTestToVitestWithReport(original);
	if (args.get("write")) {
		writeFileSync(input, result.code);
	}
	if (args.get("json")) {
		stdout.write(
			`${JSON.stringify({
				input,
				changed: result.changed,
				importsRewritten: result.importsRewritten,
				assertionsRewritten: result.assertionsRewritten,
				unhandled: result.unhandled,
				written: Boolean(args.get("write")),
			}, null, 2)}\n`,
		);
	} else {
		stdout.write(result.code);
	}
	return 0;
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain() && process.argv.slice(2).length > 0) {
	process.exit(runNodeTestToVitestCli());
}
