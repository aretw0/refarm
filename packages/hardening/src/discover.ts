/**
 * DISCOVERY — from the filesystem, never from a list.
 *
 * The inventory this collector was commissioned against named 15 runnable conformance entry points,
 * measured by hand. A hand-measured list is exactly what fails to catch the sixteenth — and it had
 * already failed: this scan finds 26 of them. Two reasons the hand count came up short, both worth
 * writing down because they will recur:
 *
 *   1. `grep -r` SILENTLY SKIPS a file containing a NUL byte. `packages/artifact-contract-v1/`
 *      `src/conformance.ts` has one (line 88, inside a string literal), so `grep` reports zero
 *      matches for it with no "binary file" notice under `-o`/`-h`, and `runArtifactV1Conformance`
 *      was invisible to every grep-driven audit of this repo. `readFileSync(file, "utf8")` has no
 *      such behaviour, which is why this scan reads files itself instead of shelling out.
 *   2. A suite is not always in a file called `conformance.ts` — `packages/ds/src/theme-conformance`
 *      `.ts`, `packages/homestead/src/sdk/host-renderer.ts` and `packages/prompt-contract-v1/src/`
 *      `index.ts` all declare one. Scanning by filename would miss them; scanning for the
 *      DECLARATION does not.
 *
 * What is discovered is the runner's declaration site. Whether a runner can be RUN is a separate
 * question with its own answer (see `subjects.ts`) — a suite the collector cannot drive is still
 * discovered and still reported. That is the difference that matters: the failure mode of a
 * hand-maintained list is SILENCE, and nothing here can be silent about a suite that exists.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** `export function runFooConformance(` / `export async function runFooV1Conformance<T>(` — the
 *  declaration form every conformance entry point in this repo uses. Anchored to `export` at the
 *  start of a line so a mention in prose or a re-export list is not mistaken for a declaration. */
const RUNNER_DECLARATION = /^export\s+(?:async\s+)?function\s+(run[A-Za-z0-9_$]*Conformance[A-Za-z0-9_$]*)\s*[(<]/gm;

/** A module that imports a test framework registers a suite; it does not return a result. */
const TEST_FRAMEWORK_IMPORT = /\bfrom\s+["'](?:vitest|node:test|mocha|jest|@jest\/globals)["']/;

/** `export interface TaskConformanceResult` / `export type FooConformanceReport` — the RESULT SHAPE
 *  a suite returns. A package that declares one but exports no runner has a shape with nothing
 *  behind it: a third thing, neither hardened nor broken (see `collect.ts`). */
const RESULT_SHAPE_DECLARATION = /^export\s+(?:interface|type)\s+([A-Za-z0-9_$]*Conformance(?:Result|Report)[A-Za-z0-9_$]*)\b/gm;

/** Directories a source scan has no business entering. `dist`/`build` are artifacts of what is
 *  already being scanned (counting both would double-count every suite); the fixture directories
 *  hold deliberately-broken code that must never reach a real signal. */
const SKIPPED_DIRECTORIES = new Set([
	".git",
	".turbo",
	"__fixtures__",
	"build",
	"coverage",
	"dist",
	"e2e",
	"fixtures",
	"node_modules",
	"target",
	"test",
	"test-fixtures",
	"tests",
]);

const SOURCE_FILE = /\.(?:m|c)?[jt]s$/;
const NON_SOURCE_FILE = /(?:\.d\.[cm]?ts|\.test\.[cm]?[jt]s|\.spec\.[cm]?[jt]s|\.config\.[cm]?[jt]s)$/;

export interface DiscoveredSuite {
	/** `<package>#<runner>`. */
	id: string;
	/**
	 * `runner` — an entry point that can be executed.
	 * `result-shape` — an exported `*ConformanceResult` / `*ConformanceReport` type whose package
	 * exports NO runner. A shape with nothing behind it is not a failure and not a debt; it is a
	 * third state, and `collect.ts` reports it as one.
	 */
	declares: "runner" | "result-shape";
	packageName: string;
	/** Absolute path of the package directory. */
	packageDir: string;
	/** Absolute path of the file that declares the runner. */
	sourceFile: string;
	/** Workspace-relative form of `sourceFile`, for the report. */
	source: string;
	runner: string;
	/** Absolute path of the module a Node `import()` can actually load, or `null` when the
	 *  declaration site does not map onto one. */
	module: string | null;
	/** The package compiles TS to `dist/` (it has a `tsconfig.build.json` — CLAUDE.md §5), so a
	 *  missing module means "not built", not "not there". */
	buildable: boolean;
	/** The declaring module imports a test framework: it REGISTERS a suite rather than returning a
	 *  result, and only a test runner can execute it. */
	registersTestSuite: boolean;
}

/** Walk up from `startDir` to the workspace root — the directory holding `pnpm-workspace.yaml`.
 *  Returns `null` when there is none above `startDir`, which is the honest answer for a process
 *  started outside the repository. */
export function findWorkspaceRoot(startDir: string): string | null {
	let current = path.resolve(startDir);
	for (;;) {
		if (existsFile(path.join(current, "pnpm-workspace.yaml"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function existsFile(target: string): boolean {
	return statSync(target, { throwIfNoEntry: false })?.isFile() ?? false;
}

function existsDirectory(target: string): boolean {
	return statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * The `packages:` globs from `pnpm-workspace.yaml`.
 *
 * Read with a five-line parser rather than a YAML dependency: this package has no runtime
 * dependencies on purpose (it is loaded by the CLI, which pays for every one), and the shape it
 * needs is a flat list of quoted strings under one key. A pattern this parser cannot read is
 * skipped, never guessed at.
 */
export function workspacePackageGlobs(workspaceRoot: string): string[] {
	const file = path.join(workspaceRoot, "pnpm-workspace.yaml");
	if (!existsFile(file)) return [];
	const globs: string[] = [];
	let inPackages = false;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (/^packages:\s*$/.test(line)) {
			inPackages = true;
			continue;
		}
		if (!inPackages) continue;
		const item = /^\s+-\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*$/.exec(line);
		if (item) {
			globs.push(item[1] ?? item[2] ?? item[3] ?? "");
			continue;
		}
		if (/^\s*(?:#.*)?$/.test(line)) continue;
		// A new top-level key ends the list.
		if (/^\S/.test(line)) inPackages = false;
	}
	return globs.filter(Boolean);
}

/** Expand one workspace glob. `*` matches a single path segment — the only wildcard pnpm's
 *  workspace globs use in this repo, and the only one this resolves. */
function expandGlob(workspaceRoot: string, glob: string): string[] {
	let candidates = [workspaceRoot];
	for (const segment of glob.split("/")) {
		if (!segment || segment === ".") continue;
		const next: string[] = [];
		for (const base of candidates) {
			if (segment === "*") {
				let entries: string[];
				try {
					entries = readdirSync(base);
				} catch {
					continue;
				}
				for (const entry of entries) {
					if (entry.startsWith(".")) continue;
					const child = path.join(base, entry);
					if (existsDirectory(child)) next.push(child);
				}
				continue;
			}
			const child = path.join(base, segment);
			if (existsDirectory(child)) next.push(child);
		}
		candidates = next;
	}
	return candidates;
}

export interface WorkspacePackage {
	name: string;
	dir: string;
	/** TS-strict (CLAUDE.md §5): source is `.ts` under `src/`, and `dist/` is the artifact. */
	buildable: boolean;
}

export function workspacePackages(workspaceRoot: string): WorkspacePackage[] {
	const found = new Map<string, WorkspacePackage>();
	for (const glob of workspacePackageGlobs(workspaceRoot)) {
		for (const dir of expandGlob(workspaceRoot, glob)) {
			const manifestPath = path.join(dir, "package.json");
			if (!existsFile(manifestPath)) continue;
			let name: unknown;
			try {
				name = (JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown }).name;
			} catch {
				continue;
			}
			if (typeof name !== "string" || !name) continue;
			found.set(dir, {
				name,
				dir,
				buildable: existsFile(path.join(dir, "tsconfig.build.json")),
			});
		}
	}
	return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function sourceFilesUnder(dir: string): string[] {
	const files: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return files;
	}
	for (const entry of entries) {
		const target = path.join(dir, entry);
		if (existsDirectory(target)) {
			if (SKIPPED_DIRECTORIES.has(entry)) continue;
			files.push(...sourceFilesUnder(target));
			continue;
		}
		if (!SOURCE_FILE.test(entry) || NON_SOURCE_FILE.test(entry)) continue;
		files.push(target);
	}
	return files;
}

/**
 * Where a Node `import()` finds what this declaration compiles to.
 *
 * TS-strict packages emit `src/x.ts` → `dist/x.js` (the convention `tsconfig.build.json`'s
 * `rootDir: src` + `outDir: dist` produces, and the one every package's `exports` map already
 * agrees with). A `.mjs`/`.js` source in a JS-atomic package IS the module.
 */
export function moduleFor(pkg: WorkspacePackage, sourceFile: string): string | null {
	const relative = path.relative(pkg.dir, sourceFile);
	if (/\.(?:m|c)?js$/.test(relative)) return sourceFile;
	// The convention is anchored at the root of whatever COMPILES, which is not always the
	// package: a self-contained vendored capsule (`vendor/<name>/{src,dist}`) carries its own
	// pair. Anchoring at the package's own `src/` returned null for those, so the collector
	// reported a copy it could not load as unhardened debt instead of proving it a duplicate.
	const segments = relative.split(path.sep);
	const srcAt = segments.lastIndexOf("src");
	if (srcAt === -1) return null;
	const emitted = [...segments.slice(0, srcAt), "dist", ...segments.slice(srcAt + 1)];
	emitted[emitted.length - 1] = String(emitted.at(-1)).replace(/\.(?:m|c)?ts$/, ".js");
	return path.join(pkg.dir, ...emitted);
}

export function discoverConformanceSuites(workspaceRoot: string): DiscoveredSuite[] {
	const suites: DiscoveredSuite[] = [];
	for (const pkg of workspacePackages(workspaceRoot)) {
		const runners: DiscoveredSuite[] = [];
		const shapes: DiscoveredSuite[] = [];
		for (const sourceFile of sourceFilesUnder(pkg.dir)) {
			let text: string;
			try {
				// utf8, not a shelled-out grep: see the NUL-byte note in this file's header.
				text = readFileSync(sourceFile, "utf8");
			} catch {
				continue;
			}
			if (!text.includes("Conformance")) continue;
			const registersTestSuite = TEST_FRAMEWORK_IMPORT.test(text);
			const at = (name: string, declares: DiscoveredSuite["declares"]): DiscoveredSuite => ({
				id: `${pkg.name}#${name}`,
				declares,
				packageName: pkg.name,
				packageDir: pkg.dir,
				sourceFile,
				source: path.relative(workspaceRoot, sourceFile),
				runner: name,
				module: moduleFor(pkg, sourceFile),
				buildable: pkg.buildable,
				registersTestSuite,
			});
			for (const match of text.matchAll(RUNNER_DECLARATION)) {
				if (match[1]) runners.push(at(match[1], "runner"));
			}
			for (const match of text.matchAll(RESULT_SHAPE_DECLARATION)) {
				if (match[1]) shapes.push(at(match[1], "result-shape"));
			}
		}
		// A result shape is only its own entry when the package has NO runner: with one, the runner
		// is the suite and the shape is merely what it returns.
		suites.push(...runners, ...(runners.length === 0 ? shapes : []));
	}
	return suites.sort(
		(a, b) => a.packageName.localeCompare(b.packageName) || a.runner.localeCompare(b.runner),
	);
}
