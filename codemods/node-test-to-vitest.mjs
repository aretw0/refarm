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
	const normalizedSource = stripLeadingBom(source);
	const imports = rewriteImports(normalizedSource);
	const dirname = imports.renameToMjs
		? rewriteCommonJsGlobals(imports.code)
		: { code: imports.code, rewritten: 0 };
	const unsupported = detectUnsupportedCommonJs(dirname.code);
	const bindings = imports.importsRewritten > 0 || dirname.rewritten > 0
		? rewriteNodeTestBindings(dirname.code)
		: { code: dirname.code };
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
		unsupported,
		renameToMjs: imports.renameToMjs || dirname.rewritten > 0,
	};
}

function stripLeadingBom(source) {
	return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

function rewriteNodeTestBindings(source) {
	return {
		code: source
			.replace(/\bbefore\s*\(/g, "beforeAll(")
			.replace(/\bafter\s*\(/g, "afterAll(")
			.replace(/\bmock\./g, "vi."),
	};
}

function detectUnsupportedCommonJs(source) {
	const unsupported = [];
	const checks = [
		{
			re: /\brequire\s*\(\s*["']node:test["']\s*\)/,
			message: "unsupported CommonJS require: node:test; migrate the file to ESM before applying this codemod",
		},
		{
			re: /\brequire\s*\(\s*["']node:assert(?:\/strict)?["']\s*\)/,
			message: "unsupported CommonJS require: node:assert; migrate the file to ESM before applying this codemod",
		},
	];

	for (const check of checks) {
		if (check.re.test(source)) unsupported.push(check.message);
	}
	const remainingRequires = source
		.replace(/\brequire\s*\(\s*["']node:test["']\s*\)/g, "")
		.replace(/\brequire\s*\(\s*["']node:assert(?:\/strict)?["']\s*\)/g, "");
	if (/\brequire\s*\(/.test(remainingRequires)) {
		unsupported.push("unsupported CommonJS require remains; convert or remove it before renaming the file to .mjs");
	}
	return unsupported;
}

function rewriteCommonJsGlobals(source) {
	const code = source.replace(/\b__dirname\b/g, "import.meta.dirname");
	return { code, rewritten: code === source ? 0 : 1 };
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
	const moduleImports = [];
	const moduleDeclarations = [];
	const usedIdentifiers = new Set(source.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []);
	let firstImportIndex = null;
	let importsRewritten = 0;
	let commonJsRewritten = 0;
	let jsonImportIndex = 0;
	let assertName = null;

	const nextJsonModuleIdentifier = () => {
		while (usedIdentifiers.has(`__refarmJsonModule${jsonImportIndex}`)) {
			jsonImportIndex += 1;
		}
		const identifier = `__refarmJsonModule${jsonImportIndex}`;
		usedIdentifiers.add(identifier);
		jsonImportIndex += 1;
		return identifier;
	};

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

		const commonJsRequire = /^(?:const|let|var)\s+(.+?)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\);?\s*$/.exec(line);
		if (commonJsRequire) {
			const binding = commonJsRequire[1].trim();
			const specifier = commonJsRequire[2];

			if (specifier === "node:test") {
				const names = parseNodeTestRequireClause(binding);
				if (names.length > 0) {
					for (const name of names) {
						vitestNames.add(NODE_TEST_NAME_MAP.get(name) ?? name);
					}
					if (firstImportIndex === null) firstImportIndex = kept.length;
					importsRewritten += 1;
					commonJsRewritten += 1;
					continue;
				}
				kept.push(line);
				continue;
			}

			if (specifier === "node:assert" || specifier === "node:assert/strict") {
				const mappedAssertName = parseAssertRequireBinding(binding, specifier);
				if (mappedAssertName) {
					assertName = mappedAssertName;
					vitestNames.add("expect");
					if (firstImportIndex === null) firstImportIndex = kept.length;
					importsRewritten += 1;
					commonJsRewritten += 1;
					continue;
				}
				kept.push(line);
				continue;
			}

			const moduleImport = commonJsRequireImport(binding, specifier, nextJsonModuleIdentifier);
			if (moduleImport) {
				moduleImports.push(...moduleImport.imports);
				moduleDeclarations.push(...moduleImport.declarations);
				if (firstImportIndex === null) firstImportIndex = kept.length;
				importsRewritten += 1;
				commonJsRewritten += 1;
				continue;
			}
		}

		const nodeAssertDefault = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']node:assert(?:\/strict)?["'];?\s*$/.exec(line);
		if (nodeAssertDefault) {
			assertName = nodeAssertDefault[1];
			vitestNames.add("expect");
			if (firstImportIndex === null) firstImportIndex = kept.length;
			importsRewritten += 1;
			continue;
		}

		const nodeAssertNamespace = /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']node:assert(?:\/strict)?["'];?\s*$/.exec(line);
		if (nodeAssertNamespace) {
			assertName = nodeAssertNamespace[1];
			vitestNames.add("expect");
			if (firstImportIndex === null) firstImportIndex = kept.length;
			importsRewritten += 1;
			continue;
		}

		const nodeAssertStrictAlias = /^import\s+\{\s*strict\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s+from\s+["']node:assert["'];?\s*$/.exec(line);
		if (nodeAssertStrictAlias) {
			assertName = nodeAssertStrictAlias[1];
			vitestNames.add("expect");
			if (firstImportIndex === null) firstImportIndex = kept.length;
			importsRewritten += 1;
			continue;
		}

		kept.push(line);
	}

	if (vitestNames.size === 0) {
		if (moduleImports.length === 0) {
			return { code: source, importsRewritten: 0, assertName, renameToMjs: false };
		}
		kept.splice(firstImportIndex ?? 0, 0, ...moduleImports, ...moduleDeclarations);
		return {
			code: kept.join("\n"),
			importsRewritten,
			assertName,
			renameToMjs: commonJsRewritten > 0,
		};
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
	kept.splice(firstImportIndex ?? 0, 0, importLine, ...moduleImports, ...moduleDeclarations);
	return {
		code: kept.join("\n"),
		importsRewritten,
		assertName,
		renameToMjs: commonJsRewritten > 0,
	};
}

function parseAssertRequireBinding(binding, specifier) {
	if (/^[A-Za-z_$][\w$]*$/.test(binding)) return binding;
	if (specifier === "node:assert") {
		const strict = /^\{\s*strict\s*:\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(binding);
		if (strict) return strict[1];
		if (/^\{\s*strict\s*\}$/.test(binding)) return "strict";
	}
	return null;
}

function commonJsRequireImport(binding, specifier, nextJsonModuleIdentifier) {
	if (/^[A-Za-z_$][\w$]*$/.test(binding)) {
		if (specifier.endsWith(".json")) {
			return {
				imports: [`import ${binding} from "${specifier}" with { type: "json" };`],
				declarations: [],
			};
		}
		return { imports: [`import ${binding} from "${specifier}";`], declarations: [] };
	}

	if (!binding.startsWith("{")) return null;
	if (specifier.endsWith(".json")) {
		if (!isSupportedCommonJsDestructuring(binding.slice(1, -1))) return null;
		const identifier = nextJsonModuleIdentifier();
		return {
			imports: [`import ${identifier} from "${specifier}" with { type: "json" };`],
			declarations: [`const ${binding} = ${identifier};`],
		};
	}
	const named = parseCommonJsNamedImportSpec(binding.slice(1, -1));
	if (!named) return null;
	return { imports: [`import { ${named} } from "${specifier}";`], declarations: [] };
}

function parseCommonJsNamedImportSpec(source) {
	const items = source
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	if (items.length === 0) return null;

	const mapped = [];
	for (const item of items) {
		if (item.startsWith("...") || /[={}\[\]]/.test(item)) return null;
		const [imported, local] = item.split(/\s*:\s*/);
		if (!/^[A-Za-z_$][\w$]*$/.test(imported)) return null;
		if (local === undefined) {
			mapped.push(imported);
			continue;
		}
		if (!/^[A-Za-z_$][\w$]*$/.test(local)) return null;
		mapped.push(`${imported} as ${local}`);
	}
	return mapped.join(", ");
}

function isSupportedCommonJsDestructuring(source) {
	const items = source
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	if (items.length === 0) return false;

	for (const item of items) {
		if (item.startsWith("...") || /[={}\[\]]/.test(item)) return false;
		const [property, local] = item.split(/\s*:\s*/);
		if (!/^[A-Za-z_$][\w$]*$/.test(property)) return false;
		if (local !== undefined && !/^[A-Za-z_$][\w$]*$/.test(local)) return false;
	}
	return true;
}

function parseNodeTestRequireClause(clause) {
	const trimmed = clause.trim();
	if (trimmed.startsWith("{")) {
		return parseCommonJsNamedBindings(trimmed.slice(1, -1)).filter((name) =>
			VITEST_IMPORT_ORDER.includes(name) || NODE_TEST_NAME_MAP.has(name)
		);
	}
	if (VITEST_IMPORT_ORDER.includes(trimmed) || NODE_TEST_NAME_MAP.has(trimmed)) return [trimmed];
	return [];
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

function parseCommonJsNamedBindings(source) {
	if (source.split(",").some((item) => item.includes(":"))) return [];
	return source
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.map((item) => item.trim());
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
		case "throws": {
			if (args.length < 1) return null;
			const { expected: thrownMatcher, message: thrownMessage } = throwableArgs(expected, message);
			if (isFunctionExpression(thrownMatcher)) {
				return throwsPredicateReplacement(actual, thrownMatcher, thrownMessage);
			}
			return `${expectCall(actual, thrownMessage)}.toThrow(${thrownMatcher ?? ""})`;
		}
		case "rejects": {
			if (args.length < 1) return null;
			const { expected: thrownMatcher, message: thrownMessage } = throwableArgs(expected, message);
			if (isFunctionExpression(thrownMatcher)) {
				return rejectsPredicateReplacement(actual, thrownMatcher, thrownMessage);
			}
			return `${expectCall(actual, thrownMessage)}.rejects.toThrow(${thrownMatcher ?? ""})`;
		}
		case "doesNotReject": {
			if (args.length < 1) return null;
			const { expected: rejectionMatcher, message: rejectionMessage } =
				rejectionArgs(expected, message);
			return `${expectCall(promiseExpressionForAssert(actual), rejectionMessage)}.resolves.not.toThrow(${rejectionMatcher ?? ""})`;
		}
		case "fail":
			return args.length >= 1 ? `expect.fail(${actual})` : "expect.fail()";
		default:
			return null;
	}
}

function throwableArgs(expected, message) {
	if (message !== undefined) {
		return { expected, message };
	}
	if (isStringLiteral(expected)) {
		return { expected: undefined, message: expected };
	}
	return { expected, message: undefined };
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

function isFunctionExpression(value) {
	if (value === undefined) return false;
	const trimmed = value.trim();
	return /^(?:async\s+)?function\b/.test(trimmed) ||
		/^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/s.test(trimmed);
}

function promiseExpressionForAssert(actual) {
	if (isFunctionExpression(actual)) return `(${actual})()`;
	return actual;
}

function throwsPredicateReplacement(actual, predicate, message) {
	const thrown = "__refarmThrown";
	const didThrow = "__refarmDidThrow";
	return `(() => { let ${didThrow} = false; let ${thrown}; try { (${actual})(); } catch (error) { ${didThrow} = true; ${thrown} = error; } ${expectCall(didThrow, message)}.toBe(true); ${expectCall(`(${predicate})(${thrown})`, message)}.toBeTruthy(); })()`;
}

function rejectsPredicateReplacement(actual, predicate, message) {
	const thrown = "__refarmThrown";
	const didThrow = "__refarmDidThrow";
	return `(async () => { let ${didThrow} = false; let ${thrown}; try { await ${promiseExpressionForAssert(actual)}; } catch (error) { ${didThrow} = true; ${thrown} = error; } ${expectCall(didThrow, message)}.toBe(true); ${expectCall(`(${predicate})(${thrown})`, message)}.toBeTruthy(); })()`;
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
	let regex = false;
	let regexCharClass = false;
	let lastSignificant = "";
	for (let index = open; index < source.length; index += 1) {
		const char = source[index];
		if (regex) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === "[") {
				regexCharClass = true;
			} else if (char === "]") {
				regexCharClass = false;
			} else if (char === "/" && !regexCharClass) {
				regex = false;
				lastSignificant = "/";
			}
			continue;
		}
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
		if (char === "/" && looksLikeRegexStart(lastSignificant)) {
			regex = true;
			regexCharClass = false;
			escaped = false;
			continue;
		}
		if (char === "(") depth += 1;
		if (char === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
		if (!/\s/.test(char)) lastSignificant = char;
	}
	return -1;
}

function splitTopLevelArgs(source) {
	const args = [];
	let start = 0;
	let depth = 0;
	let quote = null;
	let escaped = false;
	let regex = false;
	let regexCharClass = false;
	let lastSignificant = "";

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (regex) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === "[") {
				regexCharClass = true;
			} else if (char === "]") {
				regexCharClass = false;
			} else if (char === "/" && !regexCharClass) {
				regex = false;
				lastSignificant = "/";
			}
			continue;
		}
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
		if (char === "/" && looksLikeRegexStart(lastSignificant)) {
			regex = true;
			regexCharClass = false;
			escaped = false;
			continue;
		}
		if (char === "(" || char === "[" || char === "{") depth += 1;
		if (char === ")" || char === "]" || char === "}") depth -= 1;
		if (char === "," && depth === 0) {
			args.push(source.slice(start, index).trim());
			start = index + 1;
		}
		if (!/\s/.test(char)) lastSignificant = char;
	}

	const tail = source.slice(start).trim();
	if (tail) args.push(tail);
	return args;
}

function looksLikeRegexStart(previous) {
	return previous === "" || "([{=,:;!&|?".includes(previous);
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
				unsupported: result.unsupported,
				renameToMjs: result.renameToMjs,
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
