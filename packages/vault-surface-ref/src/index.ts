import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The host-side loader for the sovereign vault:v1 surface component — the "host
// dispatch" for a WASM vault surface. It instantiates the transpiled component
// (built from TS via componentize-js) with an EMPTY import object: the component
// was built with `--disable all`, so its `ImportObject` is `{}` — it imports
// NOTHING (no wasi:filesystem, no clock, no env). The sandbox is not deny-all
// stubs but the literal ABSENCE of any import: the surface can only see the
// (verb, note, profile) the host hands it and return a result. It cannot touch
// the filesystem or network because there is no import through which to try.
//
// This is the reusable analog a real plugin host will use to run ANY
// `vault-surface` component the same sovereign way. The I/O shapes mirror
// @refarm.dev/vault-contract-v1 exactly (VaultResult/VaultProfile); they are
// declared locally so the loader stays a thin, dependency-light runtime shim.

// The transpiled module uses --instantiation, so the loader supplies core modules.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const bundledPkgDir = fileURLToPath(new URL("../pkg/", import.meta.url));

/** What a vault surface inspects: one note the host has already read. */
export interface SurfaceNote {
	path: string;
	text: string;
}

/** A matcher-is-data rule scoped to one verb (mirrors the WIT `rule`). */
export interface SurfaceRule {
	id: string;
	verb: string;
	/** Opaque JSON the surface interprets (WIT `%match`, camelCased to `match`). */
	match: string;
	severity?: string;
	description?: string;
}

export interface SurfaceProfile {
	name: string;
	rules: SurfaceRule[];
}

/** The `record-json` extract output: a KnowledgeRecord carried as a JSON string. */
export interface SurfaceRecordJson {
	ruleId: string;
	json: string;
}
export interface SurfaceSearchHit {
	path: string;
	ruleId: string;
	locus?: string;
	score?: number;
}
export interface SurfaceOrganizePlan {
	path: string;
	ruleId: string;
	destination: string;
	fileName: string;
}
export interface SurfaceFinding {
	severity: string;
	ruleId: string;
	message: string;
	locus?: string;
}

/** The `run-result` record: exactly one list populated per verb. */
export interface SurfaceResult {
	verb: string;
	records: SurfaceRecordJson[];
	hits: SurfaceSearchHit[];
	plans: SurfaceOrganizePlan[];
	findings: SurfaceFinding[];
}

export interface ReferenceVaultSurface {
	run(
		verb: string,
		note: SurfaceNote,
		profile: SurfaceProfile,
	): SurfaceResult;
}

/**
 * Load and instantiate ANY sandboxed `vault-surface` component from a transpiled
 * pkg dir (jco `--no-wasi-shim --instantiation` output: an entry `.js` glue + a
 * core `.wasm` module), returning its `run` under an EMPTY import table. The same
 * sovereign boundary for the bundled reference surface AND any plugin-contributed
 * one — the host grants NOTHING but the subject, because the component imports
 * nothing.
 */
export async function loadVaultSurfaceComponent(options: {
	/** The transpiled component directory (the plugin's or the bundled pkg/). */
	pkgDir: string;
	/** The entry module file name inside pkgDir (jco names it `<name>.js`). */
	entry: string;
}): Promise<ReferenceVaultSurface> {
	const { pkgDir, entry } = options;
	const getCoreModule = (path: string): WebAssembly.Module =>
		new WebAssembly.Module(readFileSync(join(pkgDir, path)));
	const mod = (await import(pathToFileURL(join(pkgDir, entry)).href)) as Any;
	// The component's ImportObject is `{}` (built with --disable all): it imports
	// nothing, so the host provides nothing. Absence of capability IS the sandbox.
	const root = await mod.instantiate(getCoreModule, {});
	const surface = root.surface as ReferenceVaultSurface;
	return {
		run: (verb, note, profile) => surface.run(verb, note, profile),
	};
}

/**
 * Instantiate the BUNDLED reference surface (this package's own component) under
 * the sovereign boundary. A thin wrapper over {@link loadVaultSurfaceComponent}.
 */
export function createReferenceVaultSurfaceComponent(): Promise<ReferenceVaultSurface> {
	return loadVaultSurfaceComponent({
		pkgDir: bundledPkgDir,
		entry: "vault_surface.js",
	});
}
