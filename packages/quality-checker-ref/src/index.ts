import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The checker's I/O shapes mirror @refarm.dev/quality-contract-v1 exactly
// (QualityFinding/QualityProfile) and the WIT records in
// quality-contract-v1/wit/quality.wit. They are declared locally here so the
// loader stays a thin, dependency-light runtime shim; the runtime conformance is
// what proves parity, not a compile-time coupling. A finding's `ruleId` is the
// kebab-case `rule-id` from WIT, surfaced camelCased by jco.
export interface CheckerFinding {
	severity: string;
	ruleId: string;
	message: string;
	locus?: string;
}
export interface CheckerRule {
	id: string;
	severity: string;
	description: string;
	category?: string;
	/** Opaque JSON string the checker interprets (matcher-is-data). */
	check: string;
}
export interface CheckerProfile {
	name: string;
	rules: CheckerRule[];
}

/**
 * The host-side loader for the sovereign quality-checker component — the
 * "host dispatch" for a WASM checker. It instantiates the transpiled component
 * WITHOUT wiring any real capability: the checker's wasi imports are satisfied by
 * DENY-ALL stubs (no preopened filesystem, every fs/io op traps), so a checker is
 * pure compute that literally cannot reach the filesystem or network. The host
 * enforces the boundary by choosing what to provide — here, nothing but the
 * subject. This is the reusable analog a real plugin host (skill quality gate,
 * etc.) will use to run ANY `quality-checker` component the same sandboxed way.
 */

// The transpiled module uses --instantiation, so the loader supplies imports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const bundledPkgDir = fileURLToPath(new URL("../pkg/", import.meta.url));

/** wasi imports that grant NOTHING: no env, no args, no preopened dirs, and
 * every filesystem/io op throws. The sandbox is the absence of capability. */
function denyAllWasiImports(): Any {
	const noop = () => {};
	const denyingClass = (label: string) =>
		new Proxy(class {}, {
			get() {
				return () => {
					throw new Error(`capability denied: ${label}`);
				};
			},
		});
	const emptyOut = class {
		blockingWriteAndFlush() {}
		write() {}
		checkWrite() {
			return 0n;
		}
	};
	return {
		"wasi:cli/environment": {
			getEnvironment: () => [],
			getArguments: () => [],
			initialCwd: () => undefined,
		},
		"wasi:cli/exit": { exit: noop },
		"wasi:cli/stderr": { getStderr: () => new emptyOut() },
		"wasi:cli/stdin": { getStdin: () => ({}) },
		"wasi:cli/stdout": { getStdout: () => new emptyOut() },
		"wasi:filesystem/preopens": { getDirectories: () => [] },
		"wasi:filesystem/types": {
			Descriptor: denyingClass("filesystem"),
			filesystemErrorCode: () => undefined,
		},
		"wasi:io/error": { Error: class {} },
		"wasi:io/streams": {
			InputStream: denyingClass("io.read"),
			OutputStream: emptyOut,
		},
	};
}

/** What a subject looks like to the reference checker (mirrors the WIT variant). */
export type CheckerSubject = { tag: "text"; val: string } | { tag: "dom"; val: string };

export interface ReferenceChecker {
	/** Inspect a subject against a profile; returns findings (pure compute). */
	check(subject: CheckerSubject, profile: CheckerProfile): CheckerFinding[];
}

/**
 * Load and instantiate ANY sandboxed `quality-checker` component from a transpiled
 * pkg dir (jco `--no-wasi-shim --instantiation` output: an entry `.js` glue + core
 * `.wasm` modules), returning its `check` under the DENY-ALL capability table. The
 * same sovereign boundary for the bundled reference checker AND any
 * plugin-contributed one — the host grants nothing but the subject.
 */
export async function loadCheckerComponent(options: {
	/** The transpiled component directory (the plugin's or the bundled pkg/). */
	pkgDir: string;
	/** The entry module file name inside pkgDir (jco names it `<name>.js`). */
	entry: string;
}): Promise<ReferenceChecker> {
	const { pkgDir, entry } = options;
	const getCoreModule = (path: string): WebAssembly.Module =>
		new WebAssembly.Module(readFileSync(join(pkgDir, path)));
	const mod = (await import(pathToFileURL(join(pkgDir, entry)).href)) as Any;
	const root = await mod.instantiate(getCoreModule, denyAllWasiImports());
	const checker = root.checker as {
		check(subject: CheckerSubject, profile: CheckerProfile): CheckerFinding[];
	};
	return {
		check: (subject, profile) => checker.check(subject, profile),
	};
}

/**
 * Instantiate the BUNDLED reference checker (this package's own component) under
 * the deny-all boundary. A thin wrapper over {@link loadCheckerComponent}.
 */
export function createReferenceChecker(): Promise<ReferenceChecker> {
	return loadCheckerComponent({
		pkgDir: bundledPkgDir,
		entry: "quality_checker_ref.js",
	});
}
