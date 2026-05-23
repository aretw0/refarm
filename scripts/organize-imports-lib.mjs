import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const GENERATED_SEGMENTS = new Set([".turbo", "build", "dist", "node_modules"]);

const FORMAT_SETTINGS = {
	convertTabsToSpaces: false,
	indentSize: 4,
	insertSpaceAfterCommaDelimiter: true,
	insertSpaceAfterConstructor: false,
	insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
	insertSpaceAfterKeywordsInControlFlowStatements: true,
	insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: false,
	insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
	insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
	insertSpaceAfterSemicolonInForStatements: true,
	insertSpaceAfterTypeAssertion: false,
	insertSpaceBeforeAndAfterBinaryOperators: true,
	insertSpaceBeforeFunctionParenthesis: false,
	insertSpaceBeforeTypeAnnotation: false,
	newLineCharacter: "\n",
	semicolons: ts.SemicolonPreference.Insert,
	tabSize: 4,
};

export function isOrganizableSourceFile(filePath) {
	const normalized = filePath.replaceAll("\\", "/");
	if (normalized.endsWith(".d.ts")) return false;
	if (!SOURCE_EXTENSIONS.has(path.extname(normalized))) return false;
	return !normalized.split("/").some((segment) => GENERATED_SEGMENTS.has(segment));
}

export function uniqueSourceFiles(files, root = process.cwd()) {
	const seen = new Set();
	const selected = [];
	for (const file of files) {
		const relative = path.relative(root, path.resolve(root, file)).replaceAll("\\", "/");
		if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
		if (!isOrganizableSourceFile(relative)) continue;
		if (seen.has(relative)) continue;
		seen.add(relative);
		selected.push(relative);
	}
	return selected.sort();
}

export function changedSourceFiles(root = process.cwd()) {
	const files = new Set();
	for (const args of [
		["diff", "--name-only", "--diff-filter=ACMR", "--"],
		["diff", "--name-only", "--cached", "--diff-filter=ACMR", "--"],
		["ls-files", "--others", "--exclude-standard"],
	]) {
		const output = execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		for (const line of output.split(/\r?\n/)) {
			const file = line.trim();
			if (file) files.add(file);
		}
	}
	return uniqueSourceFiles([...files], root).filter((file) =>
		fs.existsSync(path.join(root, file)),
	);
}

export function organizeImportText(fileName, text, root = process.cwd()) {
	const absolute = path.resolve(root, fileName);
	let currentText = text;
	const snapshots = new Map([[absolute, ts.ScriptSnapshot.fromString(currentText)]]);
	const updateSnapshot = (next) => {
		currentText = next;
		snapshots.set(absolute, ts.ScriptSnapshot.fromString(currentText));
	};
	const service = createLanguageService(root, absolute, snapshots);
	const changes = service.organizeImports(
		{ type: "file", fileName: absolute },
		{},
		{},
	);

	for (const fileChanges of changes) {
		if (path.resolve(fileChanges.fileName) !== absolute) continue;
		updateSnapshot(applyTextChanges(currentText, fileChanges.textChanges));
	}

	const formatting = service.getFormattingEditsForDocument(absolute, FORMAT_SETTINGS);
	return applyTextChanges(currentText, formatting);
}

export function organizeImports(files, { root = process.cwd(), check = false } = {}) {
	const changed = [];
	for (const file of uniqueSourceFiles(files, root)) {
		const absolute = path.join(root, file);
		if (!fs.existsSync(absolute)) continue;
		const current = fs.readFileSync(absolute, "utf8");
		const organized = organizeImportText(file, current, root);
		if (organized === current) continue;
		changed.push(file);
		if (!check) fs.writeFileSync(absolute, organized, "utf8");
	}
	return changed;
}

function createLanguageService(root, absolute, snapshots) {
	const compilerOptions = {
		allowJs: true,
		checkJs: false,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		target: ts.ScriptTarget.ESNext,
	};
	const host = {
		getCompilationSettings: () => compilerOptions,
		getCurrentDirectory: () => root,
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		getDirectories: ts.sys.getDirectories,
		getNewLine: () => "\n",
		getScriptFileNames: () => [absolute],
		getScriptSnapshot(filePath) {
			const resolved = path.resolve(filePath);
			if (snapshots.has(resolved)) return snapshots.get(resolved);
			if (!fs.existsSync(resolved)) return undefined;
			return ts.ScriptSnapshot.fromString(fs.readFileSync(resolved, "utf8"));
		},
		getScriptVersion: () => "0",
		readDirectory: ts.sys.readDirectory,
		readFile: ts.sys.readFile,
		fileExists: ts.sys.fileExists,
		directoryExists: ts.sys.directoryExists,
	};
	return ts.createLanguageService(host);
}

function applyTextChanges(text, changes) {
	let next = text;
	for (const change of [...changes].sort((a, b) => b.span.start - a.span.start)) {
		next =
			next.slice(0, change.span.start) +
			change.newText +
			next.slice(change.span.start + change.span.length);
	}
	return next;
}
