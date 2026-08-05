import { resolvePluginPackage } from "@refarm.dev/barn";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmHome } from "../utils/refarm-home.js";

/**
 * PUT THE SHIPPED RATE CATALOG WHERE THE HOST WILL LOOK FOR IT.
 *
 * The Rust host prices every run from `MODEL_RATE_CATALOG`, a JSON string it puts on the
 * guest's WASI env, and it resolves that string from exactly ONE place: a file named
 * `model-rates.v1.json` in the node's sovereign dir
 * (`packages/tractor/src/host/plugin_host/model_rate_catalog.rs`). It has no compiled-in
 * default. It used to — an `include_str!` of
 * `packages/model-catalog-v1/catalog/model-rates.v1.json` — and that made `refarm-tractor`
 * unpublishable, because the path climbs out of the crate and `cargo package` never copies
 * it. Deleting the embed left the host reading a file nobody wrote. This is who writes it.
 *
 * TypeScript can do this and the host cannot: the artifact lives in an npm package, and
 * resolving an npm package is a thing Node does and a WASM host does not.
 *
 * WHY HERE, on the bundled-artifact pass. `refarm plugin install --bundled` (and its alias
 * `plugin update`) is already the step that resolves shipped npm packages and copies their
 * artifacts into `<REFARM_HOME>`, and `scripts/tractor-start.sh` already runs it before
 * every daemon start. So the catalog rides a path that exists, runs on every start, and
 * lands in the same directory the daemon derives from its `--refarm-dir`. No new command,
 * no new moment.
 *
 * NEVER OVERWRITES. A node that corrected a rate did so by editing this exact file, and it
 * must keep that correction across every restart — so the write is create-if-absent, done
 * with `link(2)` rather than a check-then-write, which would still lose a race with a
 * concurrently starting node.
 *
 * The consequence, stated plainly rather than discovered later: an UPGRADE that ships new
 * rates does not reach a node that already has the file, edited or not. Refreshing it is a
 * deliberate act (delete the file and start again). Making that automatic needs a way to
 * tell "the operator changed this" from "this is last release's copy" — a recorded hash or
 * a `catalogVersion` comparison — and neither exists today.
 */

/** The basename the host reads. MUST equal `CATALOG_FILE_NAME` in
 *  `packages/tractor/src/host/plugin_host/model_rate_catalog.rs` — the two sides agree on
 *  this name and on nothing else. */
export const MODEL_RATE_CATALOG_FILE_NAME = "model-rates.v1.json";

/** The package that OWNS the artifact. Both sides are readers of it; neither authors. */
const MODEL_RATE_CATALOG_PACKAGE = {
	npmPackage: "@refarm.dev/model-catalog-v1",
	workspaceDir: "packages/model-catalog-v1",
} as const;

export type ModelRateCatalogStatus =
	/** No file was there; the shipped artifact is now on disk. */
	| "materialized"
	/** A file was already there and was left EXACTLY as it was. */
	| "kept"
	/** The shipped package could not be resolved — nothing written, and the host will
	 *  inject no catalog, which the guest reads as "prices unknown". */
	| "unresolved"
	/** Resolved but unwritable. Same consequence as `unresolved`, different cause. */
	| "failed";

export interface ModelRateCatalogMaterialization {
	status: ModelRateCatalogStatus;
	/** Where the host will look, whether or not anything was written. */
	path: string;
	message?: string;
}

/** Where the host looks. `resolveRefarmHome()` IS the sovereign dir — the same resolution
 *  `refarm auth enroll` uses for `<REFARM_HOME>/auth-policy.json`, which the daemon derives
 *  from the `--refarm-dir` it is given. */
export function modelRateCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(resolveRefarmHome(env), MODEL_RATE_CATALOG_FILE_NAME);
}

/**
 * Write the shipped catalog into the sovereign dir if — and only if — nothing is there.
 * Idempotent: the second call reports `kept` and touches nothing.
 *
 * Never throws. A node that cannot be given a catalog still runs; the host injects none and
 * the guest falls back to its built-in table, which is "I do not know prices", never "free".
 */
export function materializeDefaultModelRateCatalog(
	env: NodeJS.ProcessEnv = process.env,
): ModelRateCatalogMaterialization {
	const target = modelRateCatalogPath(env);
	if (fs.existsSync(target)) {
		return { status: "kept", path: target };
	}

	const resolution = resolvePluginPackage(MODEL_RATE_CATALOG_PACKAGE, {
		baseUrl: import.meta.url,
	});
	if (!resolution) {
		return {
			status: "unresolved",
			path: target,
			message: `package ${MODEL_RATE_CATALOG_PACKAGE.npmPackage} not found in node_modules or workspace`,
		};
	}

	const source = path.join(resolution.pkgDir, "catalog", MODEL_RATE_CATALOG_FILE_NAME);
	// A sibling of the target, so `link` stays on one filesystem and the pid keeps two
	// nodes starting at once from fighting over the same temp name.
	const staged = `${target}.${process.pid}.tmp`;
	try {
		const bytes = fs.readFileSync(source);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(staged, bytes);
		try {
			// CREATE-IF-ABSENT, atomically. `rename` would clobber a file another process
			// wrote since the `existsSync` above — and clobbering is the one thing this must
			// never do, because the file it would destroy is a node's rate correction.
			fs.linkSync(staged, target);
			return { status: "materialized", path: target };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				return { status: "kept", path: target };
			}
			throw error;
		} finally {
			fs.rmSync(staged, { force: true });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: "failed", path: target, message };
	}
}

/** One line for the human `plugin install` output. Silent on `kept`: "the file you already
 *  had is still the file you have" is not news. */
export function describeModelRateCatalog(
	result: ModelRateCatalogMaterialization,
): string | null {
	switch (result.status) {
		case "materialized":
			return `  ✓ model rate catalog materialized at ${result.path}`;
		case "kept":
			return null;
		case "unresolved":
		case "failed":
			return `  ✗ model rate catalog not materialized (${result.message}) — the runtime will price from the agent's built-in table`;
	}
}
